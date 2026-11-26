'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 18 — Synchronisation du profil miroir d'un numéro virtuel
//
// Le profil affiché aux correspondants du pays de destination
// (nom, avatar, badge KYC, filiale d'origine) respecte le consentement :
//   - nom    : consentement PROFILE ; à défaut d'enregistrement, base
//              contractuelle (affichage nécessaire au service, 30 jours) ;
//              un refus explicite de l'utilisateur est toujours respecté ;
//   - avatar : consentement AVATAR explicite, jamais dans les pays qui
//              interdisent le partage de photos.
// Le numéro de téléphone réel n'est JAMAIS utilisé comme nom affiché.
// ════════════════════════════════════════════════════════════

const supabase = require('../supabase')
const logger = require('../utils/logger')
const { donnees } = require('../utils/db')

const TYPE_PROFIL = 'PROFILE'
const TYPE_AVATAR = 'AVATAR'
const BADGE_VERIFIE = 'KYC_VERIFIE'
const BADGE_AUCUN = 'AUCUN'
const NOM_PAR_DEFAUT = 'Utilisateur Orange'
const DUREE_CONSENTEMENT_JOURS = 30
const PAYS_INTERDITS_PHOTO = Object.freeze(['SA', 'IR', 'KP'])

const CONSENTEMENT_ACCORDE = 'ACCORDE'
const CONSENTEMENT_REFUSE = 'REFUSE'
const CONSENTEMENT_EXPIRE = 'EXPIRE'
const CONSENTEMENT_ABSENT = 'ABSENT'

const ajouterJours = (date, jours) => new Date(date.getTime() + jours * 24 * 60 * 60 * 1000)

// ── Lectures ────────────────────────────────────────────────
const recupererProfilOrigine = async (userId) => {
  const profil = donnees(
    await supabase.from('users').select('*').eq('user_id', userId).maybeSingle(),
    'lecture du profil d\'origine'
  )
  return profil && !profil.deleted_at ? profil : null
}

const recupererNumero = async (numberId) => donnees(
  await supabase.from('virtual_number').select('*').eq('number_id', numberId).maybeSingle(),
  'lecture du numéro virtuel'
)

// État du dernier consentement enregistré pour (utilisateur, pays, type).
const lireConsentement = async (userId, paysDestination, typeDonnee, maintenant = new Date()) => {
  const lignes = donnees(
    await supabase
      .from('data_sovereignty_consent')
      .select('*')
      .eq('user_id', userId)
      .eq('destination_country', paysDestination)
      .eq('data_type', typeDonnee)
      .order('granted_at', { ascending: false })
      .limit(1),
    'lecture du consentement'
  )
  const consentement = lignes && lignes[0]
  if (!consentement) return CONSENTEMENT_ABSENT
  if (!consentement.is_granted) return CONSENTEMENT_REFUSE
  if (consentement.expires_at && Date.parse(consentement.expires_at) <= maintenant.getTime()) return CONSENTEMENT_EXPIRE
  return CONSENTEMENT_ACCORDE
}

const verifierPaysInterditPhoto = (paysDestination) => PAYS_INTERDITS_PHOTO.includes(paysDestination)

const determinerBadgeKYC = (profilOrigine) => (profilOrigine.kyc_status === 'VERIFIED' ? BADGE_VERIFIE : BADGE_AUCUN)

// Nom affichable : jamais le numéro de téléphone.
const nomAffichable = (profil) => {
  const nom = profil.display_name || profil.full_name || [profil.first_name, profil.last_name].filter(Boolean).join(' ')
  return typeof nom === 'string' && nom.trim() ? nom.trim().slice(0, 100) : null
}

const construireProfilMiroir = (profilOrigine, nomAutorise, avatarAutorise, badge) => ({
  display_name: (nomAutorise && nomAffichable(profilOrigine)) || NOM_PAR_DEFAUT,
  avatar_url: avatarAutorise ? (profilOrigine.avatar_url || null) : null,
  kyc_badge: badge,
  home_affiliate: profilOrigine.home_orange_affiliate || null
})

// ── Procédures ──────────────────────────────────────────────
const enregistrerConsentementDefaut = async (userId, paysDestination, maintenant = new Date()) => {
  donnees(
    await supabase.from('data_sovereignty_consent').insert([{
      user_id: userId,
      destination_country: paysDestination,
      data_type: TYPE_PROFIL,
      is_granted: true,
      granted_at: maintenant.toISOString(),
      expires_at: ajouterJours(maintenant, DUREE_CONSENTEMENT_JOURS).toISOString(),
      legal_basis: 'CONTRACTUAL'
    }]),
    'enregistrement du consentement par défaut'
  )
  logger.info('Base contractuelle enregistrée pour l\'affichage du nom', { userId, paysDestination, jours: DUREE_CONSENTEMENT_JOURS })
}

const enregistrerProfilMiroir = async (numberId, profilMiroir) => donnees(
  await supabase
    .from('virtual_number')
    .update({
      mirror_display_name: profilMiroir.display_name,
      mirror_avatar_url: profilMiroir.avatar_url,
      mirror_synced_at: new Date().toISOString()
    })
    .eq('number_id', numberId)
    .select()
    .single(),
  'enregistrement du profil miroir'
)

// ── Traitement principal ────────────────────────────────────
const synchroniserProfilMiroir = async (userId, numberId, { maintenant = new Date() } = {}) => {
  const numero = await recupererNumero(numberId)
  if (!numero || String(numero.user_id) !== String(userId)) return { statut: 'NUMERO_INTROUVABLE' }

  const profilOrigine = await recupererProfilOrigine(userId)
  if (!profilOrigine) return { statut: 'PROFIL_INTROUVABLE' }

  const paysDestination = numero.country_iso

  let etatNom = await lireConsentement(userId, paysDestination, TYPE_PROFIL, maintenant)
  if (etatNom === CONSENTEMENT_ABSENT || etatNom === CONSENTEMENT_EXPIRE) {
    await enregistrerConsentementDefaut(userId, paysDestination, maintenant)
    etatNom = CONSENTEMENT_ACCORDE
  }
  const nomAutorise = etatNom === CONSENTEMENT_ACCORDE

  let avatarAutorise = (await lireConsentement(userId, paysDestination, TYPE_AVATAR, maintenant)) === CONSENTEMENT_ACCORDE
  let partiel = false
  if (avatarAutorise && verifierPaysInterditPhoto(paysDestination)) {
    avatarAutorise = false
    partiel = true
    logger.info('Synchronisation partielle : partage de photo interdit dans le pays', { userId, paysDestination })
  }

  const badge = determinerBadgeKYC(profilOrigine)
  const profilMiroir = construireProfilMiroir(profilOrigine, nomAutorise, avatarAutorise, badge)
  const numeroMisAJour = await enregistrerProfilMiroir(numberId, profilMiroir)

  logger.info('Profil miroir synchronisé', { userId, numberId, badge })
  return {
    statut: partiel ? 'SYNCHRONISE_PARTIEL' : 'SYNCHRONISE',
    nomAutorise,
    avatarAutorise,
    profilMiroir,
    numero: numeroMisAJour
  }
}

module.exports = {
  NOM_PAR_DEFAUT,
  DUREE_CONSENTEMENT_JOURS,
  CONSENTEMENT_ACCORDE,
  CONSENTEMENT_REFUSE,
  lireConsentement,
  verifierPaysInterditPhoto,
  determinerBadgeKYC,
  nomAffichable,
  construireProfilMiroir,
  synchroniserProfilMiroir
}
