'use strict'

const supabase = require('../supabase')
const v = require('../utils/validation')
const { requeteInvalide, introuvable, conflit } = require('../utils/http')
const {
  donnees,
  estViolationUnicite,
  executerSansEchec,
  insererAvecColonnesOptionnelles,
  paginer,
  ErreurBase
} = require('../utils/db')
const { auditerRequete } = require('../utils/audit')
const { genererTokens, determinerRole, revoquerTousTokens } = require('../algorithms/algo10_zeroTrustJWT')
const { resoudreRegionCloud } = require('../algorithms/algo14_cloisonnementSouverainete')

const STATUTS_KYC = ['PENDING', 'VERIFIED', 'REJECTED']

// Liste blanche des champs exposés (jamais pin_hash, pin_salt, mfa_secret…).
const CHAMPS_PROFIL = [
  'user_id', 'phone_number', 'country_of_residence', 'kyc_status', 'kyc_verified_at',
  'plan_id', 'data_region', 'residence_status', 'global_identity_status', 'user_origin_type',
  'display_name', 'avatar_url', 'home_orange_affiliate', 'created_at'
]

const profilPublic = (utilisateur) =>
  Object.fromEntries(CHAMPS_PROFIL.filter((champ) => champ in utilisateur).map((champ) => [champ, utilisateur[champ]]))

const chargerUtilisateurActif = async (userId) => {
  const utilisateur = donnees(
    await supabase.from('users').select('*').eq('user_id', userId).maybeSingle(),
    'lecture de l\'utilisateur'
  )
  return utilisateur && !utilisateur.deleted_at ? utilisateur : null
}

// ════════════════════════════════════════════
// POST /api/users/register
// Créer un nouvel utilisateur (public, limité en débit)
// ════════════════════════════════════════════
const inscrireUtilisateur = async (req, res) => {
  v.exigerChamps(req.body, ['phoneNumber', 'countryResidence'])
  const telephone = v.telephone(req.body.phoneNumber, 'phoneNumber')
  const paysResidence = v.paysISO(req.body.countryResidence, 'countryResidence')
  const planId = v.identifiant(req.body.planId, 'planId', { optionnel: true }) || null

  // Le numéro peut être stocké avec ou sans « + » : les deux variantes sont vérifiées.
  const existants = donnees(
    await supabase.from('users').select('user_id').in('phone_number', v.variantesTelephone(telephone)).limit(1),
    'vérification du numéro de téléphone'
  )
  if (existants && existants.length > 0) throw conflit('Ce numéro de téléphone est déjà enregistré')

  const pays = donnees(
    await supabase.from('country').select('*').eq('country_iso', paysResidence).maybeSingle(),
    'lecture du pays de résidence'
  )
  if (!pays) throw requeteInvalide(`Pays introuvable : ${paysResidence}`, { champ: 'countryResidence' })

  // Colonnes descriptives optionnelles : ignorées si absentes du schéma réel
  // (ex. user_origin_type), sans empêcher l'inscription.
  const { data: user, error } = await insererAvecColonnesOptionnelles(supabase, 'users', {
    phone_number: telephone,
    country_of_residence: paysResidence,
    kyc_status: 'PENDING',
    plan_id: planId,
    data_region: pays.data_region || resoudreRegionCloud(paysResidence).region,
    residence_status: 'RESIDENT',
    global_identity_status: 'PENDING_SYNC',
    user_origin_type: 'ORANGE_NATIVE'
  }, ['plan_id', 'residence_status', 'global_identity_status', 'user_origin_type'])

  if (error) {
    // Deux inscriptions simultanées du même numéro : la contrainte d'unicité tranche.
    if (estViolationUnicite(error)) throw conflit('Ce numéro de téléphone est déjà enregistré')
    throw new ErreurBase('création de l\'utilisateur', error)
  }

  // Profil de fraude initial (algo 07) : son absence désactiverait la détection.
  await executerSansEchec(
    supabase.from('fraud_profile').insert([{
      user_id: user.user_id,
      avg_transaction_amount: 0,
      avg_daily_transactions: 0,
      typical_countries: [],
      typical_hours: [],
      anomaly_score: 0,
      total_alerts: 0,
      model_version: '1.0'
    }]),
    'création du profil de fraude'
  )

  // Jetons de session : permettent au titulaire de définir son premier PIN.
  const tokens = await genererTokens({ userId: user.user_id, role: determinerRole(user) })

  return res.status(201).json({
    message: 'Utilisateur créé avec succès',
    user: {
      user_id: user.user_id,
      phone_number: user.phone_number,
      country_of_residence: user.country_of_residence,
      kyc_status: user.kyc_status
    },
    tokens
  })
}

// ════════════════════════════════════════════
// GET /api/users/:userId
// ════════════════════════════════════════════
const getUtilisateur = async (req, res) => {
  const utilisateur = await chargerUtilisateurActif(req.params.userId)
  if (!utilisateur) throw introuvable('Utilisateur introuvable')

  return res.status(200).json({
    message: 'Utilisateur trouvé',
    user: profilPublic(utilisateur)
  })
}

// ════════════════════════════════════════════
// PUT /api/users/:userId/kyc   (ADMIN / SERVICE)
// ════════════════════════════════════════════
const mettreAJourKYC = async (req, res) => {
  const { userId } = req.params
  const kycStatus = v.enumeration(req.body.kycStatus, 'kycStatus', { valeurs: STATUTS_KYC, message: 'Statut KYC invalide' })

  if (!(await chargerUtilisateurActif(userId))) throw introuvable('Utilisateur introuvable')

  const utilisateur = donnees(
    await supabase
      .from('users')
      .update({
        kyc_status: kycStatus,
        kyc_verified_at: kycStatus === 'VERIFIED' ? new Date().toISOString() : null
      })
      .eq('user_id', userId)
      .select()
      .single(),
    'mise à jour du statut KYC'
  )
  void auditerRequete(req, { userId, entite: 'USER', action: `KYC_${kycStatus}` })

  return res.status(200).json({
    message: 'Statut KYC mis à jour',
    user_id: userId,
    kyc_status: utilisateur.kyc_status
  })
}

// ════════════════════════════════════════════
// GET /api/users/:userId/numbers
// ════════════════════════════════════════════
const getMesNumeros = async (req, res) => {
  const page = v.pagination(req.query)
  const { lignes, total } = await paginer(
    supabase
      .from('virtual_number')
      .select('*', { count: 'exact' })
      .eq('user_id', req.params.userId)
      .order('created_at', { ascending: false }),
    page,
    'lecture des numéros virtuels'
  )

  return res.status(200).json({
    message: 'Numéros virtuels récupérés',
    numeros: lignes,
    total,
    ...page
  })
}

// ════════════════════════════════════════════
// DELETE /api/users/:userId  (suppression logique)
// ════════════════════════════════════════════
const supprimerUtilisateur = async (req, res) => {
  const { userId } = req.params
  if (!(await chargerUtilisateurActif(userId))) throw introuvable('Utilisateur introuvable')

  donnees(
    await supabase.from('users').update({ deleted_at: new Date().toISOString() }).eq('user_id', userId),
    'suppression de l\'utilisateur'
  )

  // Plus aucun appel routé vers un compte supprimé.
  await executerSansEchec(
    supabase.from('virtual_number').update({ status: 'PARKED' }).eq('user_id', userId).in('status', ['ACTIVE', 'AWAITING_ARRIVAL']),
    'mise en parking des numéros du compte supprimé'
  )

  // Toutes les sessions du compte sont révoquées immédiatement.
  await revoquerTousTokens(userId)
  void auditerRequete(req, { userId, entite: 'USER', action: 'COMPTE_SUPPRIME' })

  return res.status(200).json({ message: 'Utilisateur supprimé avec succès' })
}

module.exports = {
  inscrireUtilisateur,
  getUtilisateur,
  mettreAJourKYC,
  getMesNumeros,
  supprimerUtilisateur,
  profilPublic
}
