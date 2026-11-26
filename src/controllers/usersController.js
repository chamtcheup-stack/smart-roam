'use strict'

const supabase = require('../supabase')
const config = require('../config')
const v = require('../utils/validation')
const logger = require('../utils/logger')
const { exigerCodeValide } = require('../utils/otp')
const { requeteInvalide, introuvable, conflit, indisponible } = require('../utils/http')
const {
  donnees,
  estColonneAbsente,
  estViolationUnicite,
  executerSansEchec,
  insererAvecColonnesOptionnelles,
  paginer,
  ErreurBase
} = require('../utils/db')
const { auditerRequete } = require('../utils/audit')
const { genererTokens, determinerRole, revoquerTousTokens } = require('../algorithms/algo10_zeroTrustJWT')
const { resoudreRegionCloud } = require('../algorithms/algo14_cloisonnementSouverainete')
const { synchroniserProfilMiroir } = require('../algorithms/algo18_synchronisationMiroir')

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
  // Preuve de possession du numéro : code SMS (POST /api/auth/otp, motif INSCRIPTION).
  const codeOtp = v.chaine(req.body.otpCode, 'otpCode', { optionnel: true, min: 4, max: 10 }) || null
  if (config.otp.obligatoire && !codeOtp) {
    throw requeteInvalide('Code de vérification SMS requis : demandez-le avec POST /api/auth/otp (motif INSCRIPTION)', {
      champ: 'otpCode',
      code: 'OTP_REQUIS'
    })
  }

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

  // Code consommé seulement une fois les autres contrôles passés.
  if (codeOtp) exigerCodeValide(telephone, 'INSCRIPTION', codeOtp)

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
      kyc_status: user.kyc_status,
      display_name: user.display_name || null,
      role: determinerRole(user)
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
    user: { ...profilPublic(utilisateur), role: determinerRole(utilisateur) }
  })
}

// ════════════════════════════════════════════
// PUT /api/users/:userId
// Nom affiché (profil miroir) : { displayName }. Les profils miroir déjà
// publiés sont resynchronisés (consentements respectés).
// ════════════════════════════════════════════
const REGEX_NOM_AFFICHE = /^\p{L}[\p{L}\p{M}' .-]*$/u

const modifierProfil = async (req, res) => {
  const { userId } = req.params
  const displayName = v.chaine(req.body.displayName, 'displayName', { min: 2, max: 60 })
  if (!REGEX_NOM_AFFICHE.test(displayName)) {
    throw requeteInvalide('displayName : lettres, espaces, apostrophes, points et tirets uniquement', { champ: 'displayName' })
  }
  if (!(await chargerUtilisateurActif(userId))) throw introuvable('Utilisateur introuvable')

  const { data: utilisateur, error } = await supabase
    .from('users')
    .update({ display_name: displayName })
    .eq('user_id', userId)
    .select()
    .single()
  if (error) {
    if (estColonneAbsente(error)) throw indisponible('Nom affiché non pris en charge par la base actuelle (colonne users.display_name absente)')
    throw new ErreurBase('mise à jour du profil', error)
  }

  const numeros = donnees(
    await supabase.from('virtual_number').select('number_id').eq('user_id', userId).not('mirror_display_name', 'is', null),
    'lecture des profils miroir'
  ) || []
  for (const { number_id: numberId } of numeros) {
    try {
      await synchroniserProfilMiroir(userId, numberId)
    } catch (erreur) {
      logger.warn('Resynchronisation du profil miroir impossible', erreur)
    }
  }

  void auditerRequete(req, { userId, entite: 'USER', action: 'PROFIL_MODIFIE' })
  return res.status(200).json({
    message: 'Profil mis à jour',
    user: { ...profilPublic(utilisateur), role: determinerRole(utilisateur) },
    profilsMiroirSynchronises: numeros.length
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
  modifierProfil,
  mettreAJourKYC,
  getMesNumeros,
  supprimerUtilisateur,
  profilPublic
}
