'use strict'

const supabase = require('../supabase')
const v = require('../utils/validation')
const logger = require('../utils/logger')
const { nonAuthentifie, tropDeRequetes } = require('../utils/http')
const { donnees } = require('../utils/db')
const config = require('../config')
const { CompteurFenetre } = require('../utils/limiteur')
const { verrouCompte, cleCompte, cleTelephone } = require('../utils/verrouCompte')
const { auditerRequete } = require('../utils/audit')
const { verifierPINUtilisateur } = require('../algorithms/algo11_hachagePIN')
const { enregistrerAppareil } = require('../algorithms/algo07_detectionFraude')
const {
  genererTokens,
  renouvelerTokens,
  revoquerSession,
  revoquerTousTokens,
  determinerRole
} = require('../algorithms/algo10_zeroTrustJWT')

const QUINZE_MINUTES = 15 * 60 * 1000
const MESSAGE_VERROUILLE = 'Trop de tentatives de connexion : compte temporairement verrouillé'
const MESSAGE_ECHECS_IP = "Trop d'échecs de connexion depuis cette adresse, réessayez plus tard"

// Seuls les ÉCHECS sont comptés par adresse IP : des milliers d'abonnés
// peuvent partager la même IP publique (CGNAT) et se connecter normalement.
const echecsParIP = new CompteurFenetre({ fenetreMs: QUINZE_MINUTES, max: config.limites.echecsConnexionParIP15min })

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

  const ip = req.ip || 'inconnue'
  const echecsIP = echecsParIP.lire(ip)
  if (echecsIP.depasse) throw tropDeRequetes(MESSAGE_ECHECS_IP, echecsIP.reessayerDansSecondes)

  // Verrou partagé avec la vérification du PIN : clé du compte s'il existe,
  // du numéro sinon (comportement identique, aucune énumération).
  const utilisateur = await chargerUtilisateurParTelephone(telephone)
  const cleVerrou = utilisateur ? cleCompte(utilisateur.user_id) : cleTelephone(telephone)
  const verrou = verrouCompte.etat(cleVerrou)
  if (verrou.bloque) throw tropDeRequetes(MESSAGE_VERROUILLE, verrou.reessayerDansSecondes)

  // Compte inconnu ou sans PIN : même message et même coût de calcul.
  const { valide } = await verifierPINUtilisateur(utilisateur, pin)

  if (!valide) {
    echecsParIP.consommer(ip)
    const echec = verrouCompte.enregistrerEchec(cleVerrou)
    const userId = utilisateur ? utilisateur.user_id : null
    logger.info('Échec de connexion', { telephone: logger.masquerTelephone(telephone) })
    void auditerRequete(req, { userId, entite: 'AUTH', action: echec.bloque ? 'COMPTE_VERROUILLE' : 'CONNEXION_ECHOUEE' })
    if (echec.bloque) throw tropDeRequetes(MESSAGE_VERROUILLE, echec.reessayerDansSecondes)
    throw nonAuthentifie('Numéro de téléphone ou PIN incorrect')
  }

  verrouCompte.reinitialiser(cleVerrou)
  verrouCompte.reinitialiser(cleTelephone(telephone))
  void auditerRequete(req, { userId: utilisateur.user_id, entite: 'AUTH', action: 'CONNEXION_REUSSIE' })

  // Appareil enregistré : la règle anti-fraude DEVICE saura s'il est nouveau.
  const appareilConnu = await enregistrerAppareil(utilisateur.user_id, deviceId)
  const tokens = await genererTokens({
    userId: utilisateur.user_id,
    role: determinerRole(utilisateur),
    deviceId,
    appareilConnu
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
  echecsParIP
}
