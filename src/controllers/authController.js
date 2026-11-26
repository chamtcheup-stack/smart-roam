'use strict'

const supabase = require('../supabase')
const v = require('../utils/validation')
const logger = require('../utils/logger')
const { nonAuthentifie, tropDeRequetes } = require('../utils/http')
const { donnees } = require('../utils/db')
const { VerrouTentatives } = require('../utils/limiteur')
const { auditerRequete } = require('../utils/audit')
const { verifierPINUtilisateur } = require('../algorithms/algo11_hachagePIN')
const {
  genererTokens,
  renouvelerTokens,
  revoquerSession,
  revoquerTousTokens,
  determinerRole
} = require('../algorithms/algo10_zeroTrustJWT')

const QUINZE_MINUTES = 15 * 60 * 1000
const MESSAGE_VERROUILLE = 'Trop de tentatives de connexion : compte temporairement verrouillé'

// 5 échecs en 15 minutes sur un même numéro → connexion bloquée 15 minutes.
const verrouConnexion = new VerrouTentatives({
  maxEchecs: 5,
  fenetreMs: QUINZE_MINUTES,
  dureeBlocageMs: QUINZE_MINUTES
})

const chargerUtilisateurParTelephone = async (telephone) => {
  const lignes = donnees(
    await supabase.from('users').select('*').in('phone_number', v.variantesTelephone(telephone)).limit(5),
    'recherche du compte'
  )
  return (lignes || []).find((utilisateur) => !utilisateur.deleted_at) || null
}

const chargerUtilisateurActif = async (userId) => {
  const utilisateur = donnees(
    await supabase.from('users').select('*').eq('user_id', userId).maybeSingle(),
    'lecture du compte'
  )
  return utilisateur && !utilisateur.deleted_at ? utilisateur : null
}

const profilPublic = (utilisateur) => ({
  user_id: utilisateur.user_id,
  phone_number: utilisateur.phone_number,
  country_of_residence: utilisateur.country_of_residence,
  kyc_status: utilisateur.kyc_status
})

// ════════════════════════════════════════════
// POST /api/auth/login
// ════════════════════════════════════════════
const connexion = async (req, res) => {
  v.exigerChamps(req.body, ['phoneNumber', 'pin'])
  const telephone = v.telephone(req.body.phoneNumber, 'phoneNumber')
  const pin = v.pin(req.body.pin, 'pin')
  const deviceId = v.chaine(req.body.deviceId, 'deviceId', { optionnel: true, max: 128 }) || null

  const cleVerrou = `tel:${telephone}`
  const verrou = verrouConnexion.etat(cleVerrou)
  if (verrou.bloque) throw tropDeRequetes(MESSAGE_VERROUILLE, verrou.reessayerDansSecondes)

  // Compte inconnu ou sans PIN : même message et même coût de calcul.
  const utilisateur = await chargerUtilisateurParTelephone(telephone)
  const { valide } = await verifierPINUtilisateur(utilisateur, pin)

  if (!valide) {
    const echec = verrouConnexion.enregistrerEchec(cleVerrou)
    const userId = utilisateur ? utilisateur.user_id : null
    logger.info('Échec de connexion', { telephone: logger.masquerTelephone(telephone) })
    void auditerRequete(req, { userId, entite: 'AUTH', action: echec.bloque ? 'COMPTE_VERROUILLE' : 'CONNEXION_ECHOUEE' })
    if (echec.bloque) throw tropDeRequetes(MESSAGE_VERROUILLE, echec.reessayerDansSecondes)
    throw nonAuthentifie('Numéro de téléphone ou PIN incorrect')
  }

  verrouConnexion.reinitialiser(cleVerrou)
  void auditerRequete(req, { userId: utilisateur.user_id, entite: 'AUTH', action: 'CONNEXION_REUSSIE' })
  const tokens = await genererTokens({
    userId: utilisateur.user_id,
    role: determinerRole(utilisateur),
    deviceId
  })

  return res.status(200).json({
    message: 'Connexion réussie',
    user: profilPublic(utilisateur),
    tokens
  })
}

// ════════════════════════════════════════════
// POST /api/auth/refresh
// ════════════════════════════════════════════
const rafraichir = async (req, res) => {
  v.exigerChamps(req.body, ['refreshToken'])
  const refreshToken = v.chaine(req.body.refreshToken, 'refreshToken', { max: 512 })
  const tokens = await renouvelerTokens(refreshToken, chargerUtilisateurActif)
  return res.status(200).json({ message: 'Jetons renouvelés', tokens })
}

// ════════════════════════════════════════════
// POST /api/auth/logout (authentifié)
// ════════════════════════════════════════════
const deconnexion = async (req, res) => {
  const refreshToken = v.chaine(req.body.refreshToken, 'refreshToken', { optionnel: true, max: 512 })
  await revoquerSession({ refreshToken, sessionId: req.auth.sessionId })
  return res.status(200).json({ message: 'Déconnexion effectuée' })
}

// ════════════════════════════════════════════
// POST /api/auth/logout-all (authentifié)
// ════════════════════════════════════════════
const deconnexionGlobale = async (req, res) => {
  await revoquerTousTokens(req.auth.userId)
  void auditerRequete(req, { userId: req.auth.userId, entite: 'AUTH', action: 'SESSIONS_REVOQUEES' })
  return res.status(200).json({ message: 'Toutes les sessions ont été fermées' })
}

module.exports = {
  connexion,
  rafraichir,
  deconnexion,
  deconnexionGlobale,
  chargerUtilisateurActif,
  profilPublic,
  verrouConnexion
}
