'use strict'

const supabase = require('../supabase')
const v = require('../utils/validation')
const { introuvable } = require('../utils/http')
const { donnees, executerSansEchec, paginer } = require('../utils/db')
const { auditerRequete } = require('../utils/audit')
const {
  NOM_PAR_DEFAUT,
  DUREE_CONSENTEMENT_JOURS,
  synchroniserProfilMiroir
} = require('../algorithms/algo18_synchronisationMiroir')

const TYPES_DONNEES = ['PROFILE', 'LOCATION', 'TRANSACTION', 'AVATAR']
const COLONNES_MIROIR = 'number_id, did_number, country_iso, status, mirror_display_name, mirror_avatar_url, mirror_synced_at'

// ════════════════════════════════════════════
// POST /api/mirror/sync
// ════════════════════════════════════════════
const synchroniserMiroir = async (req, res) => {
  v.exigerChamps(req.body, ['userId', 'numberId'])
  const userId = v.identifiant(req.body.userId, 'userId')
  const numberId = v.identifiant(req.body.numberId, 'numberId')

  const resultat = await synchroniserProfilMiroir(userId, numberId)
  if (resultat.statut === 'NUMERO_INTROUVABLE') throw introuvable('Numéro virtuel introuvable')
  if (resultat.statut === 'PROFIL_INTROUVABLE') throw introuvable('Utilisateur introuvable')

  return res.status(200).json({
    message: resultat.statut === 'SYNCHRONISE_PARTIEL'
      ? 'Profil miroir synchronisé partiellement (partage de photo interdit dans ce pays)'
      : 'Profil miroir synchronisé avec succès',
    numero: resultat.numero,
    profilMiroir: resultat.profilMiroir,
    nomAutorise: resultat.nomAutorise,
    avatarAutorise: resultat.avatarAutorise,
    badgeKYC: resultat.profilMiroir.kyc_badge
  })
}

// ════════════════════════════════════════════
// GET /api/mirror/:userId
// ════════════════════════════════════════════
const getProfilMiroir = async (req, res) => {
  const page = v.pagination(req.query)
  const { lignes, total } = await paginer(
    supabase
      .from('virtual_number')
      .select(COLONNES_MIROIR, { count: 'exact' })
      .eq('user_id', req.params.userId)
      .not('mirror_display_name', 'is', null)
      .order('mirror_synced_at', { ascending: false }),
    page,
    'lecture des profils miroir'
  )

  return res.status(200).json({
    message: 'Profils miroir récupérés',
    profils: lignes,
    total,
    ...page
  })
}

// ════════════════════════════════════════════
// POST /api/mirror/consent
// Accorder (isGranted absent ou true) ou retirer (false) un consentement.
// ════════════════════════════════════════════
const gererConsentement = async (req, res) => {
  v.exigerChamps(req.body, ['userId', 'paysDestination', 'dataType'])
  const userId = v.identifiant(req.body.userId, 'userId')
  const paysDestination = v.paysISO(req.body.paysDestination, 'paysDestination')
  const dataType = v.enumeration(req.body.dataType, 'dataType', { valeurs: TYPES_DONNEES, message: 'Type de donnée invalide' })
  const isGranted = v.booleen(req.body.isGranted, 'isGranted', { optionnel: true, defaut: true })

  const maintenant = new Date()
  const champs = {
    is_granted: isGranted,
    granted_at: maintenant.toISOString(),
    expires_at: new Date(maintenant.getTime() + DUREE_CONSENTEMENT_JOURS * 24 * 60 * 60 * 1000).toISOString(),
    legal_basis: 'RGPD_CONSENT'
  }

  // Mise à jour de l'enregistrement existant, sinon création (aucun doublon).
  const misAJour = donnees(
    await supabase
      .from('data_sovereignty_consent')
      .update(champs)
      .eq('user_id', userId)
      .eq('destination_country', paysDestination)
      .eq('data_type', dataType)
      .select(),
    'mise à jour du consentement'
  ) || []

  const consentement = misAJour[0] || donnees(
    await supabase
      .from('data_sovereignty_consent')
      .insert([{ user_id: userId, destination_country: paysDestination, data_type: dataType, ...champs }])
      .select()
      .single(),
    'création du consentement'
  )

  // Retrait du consentement : les données déjà publiées dans ce pays sont retirées.
  if (!isGranted && (dataType === 'PROFILE' || dataType === 'AVATAR')) {
    const retrait = dataType === 'PROFILE' ? { mirror_display_name: NOM_PAR_DEFAUT } : { mirror_avatar_url: null }
    await executerSansEchec(
      supabase.from('virtual_number').update(retrait).eq('user_id', userId).eq('country_iso', paysDestination),
      'retrait des données du profil miroir'
    )
  }

  // Traçabilité RGPD des décisions de consentement.
  void auditerRequete(req, {
    userId,
    entite: 'CONSENT',
    action: `CONSENTEMENT_${isGranted ? 'ACCORDE' : 'RETIRE'}_${dataType}_${paysDestination}`
  })

  return res.status(200).json({
    message: isGranted ? 'Consentement accordé' : 'Consentement retiré',
    consentement
  })
}

// ════════════════════════════════════════════
// GET /api/mirror/consents/:userId
// Consentements de partage (écran « Confidentialité ») avec leur état
// calculé : ACCORDE, REFUSE ou EXPIRE.
// ════════════════════════════════════════════
const etatConsentement = (consentement, maintenant) => {
  if (!consentement.is_granted) return 'REFUSE'
  if (consentement.expires_at && Date.parse(consentement.expires_at) <= maintenant) return 'EXPIRE'
  return 'ACCORDE'
}

const getConsentements = async (req, res) => {
  const page = v.pagination(req.query)
  const { lignes, total } = await paginer(
    supabase
      .from('data_sovereignty_consent')
      .select('*', { count: 'exact' })
      .eq('user_id', req.params.userId)
      .order('granted_at', { ascending: false }),
    page,
    'lecture des consentements'
  )
  const maintenant = Date.now()
  return res.status(200).json({
    consentements: lignes.map((consentement) => ({ ...consentement, etat: etatConsentement(consentement, maintenant) })),
    total,
    ...page
  })
}

module.exports = {
  synchroniserMiroir,
  getProfilMiroir,
  gererConsentement,
  getConsentements
}
