'use strict'

const supabase = require('../supabase')
const v = require('../utils/validation')
const logger = require('../utils/logger')
const { nonAuthentifie, tropDeRequetes, conflit, requeteInvalide } = require('../utils/http')
const { donnees } = require('../utils/db')
const config = require('../config')
const { CompteurFenetre } = require('../utils/limiteur')
const { verrouCompte, cleCompte, cleTelephone } = require('../utils/verrouCompte')
const { auditerRequete } = require('../utils/audit')
const { MOTIFS, envoyerCode, exigerCodeValide } = require('../utils/otp')
const { verifierPINUtilisateur, sauvegarderHash, estPINTrivial } = require('../algorithms/algo11_hachagePIN')
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

// Rôle et nom affiché : l'application adapte ses écrans (espace support, accueil).
const profilPublic = (utilisateur) => ({
  user_id: utilisateur.user_id,
  phone_number: utilisateur.phone_number,
  country_of_residence: utilisateur.country_of_residence,
  kyc_status: utilisateur.kyc_status,
  display_name: utilisateur.display_name || null,
  role: determinerRole(utilisateur)
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
// POST /api/auth/otp   (public)
// { phoneNumber, motif: INSCRIPTION | PIN_OUBLIE } → code à 6 chiffres par SMS
// ════════════════════════════════════════════
const MESSAGE_CODE_ENVOYE = 'Si ce numéro peut le recevoir, un code de vérification vient d\'être envoyé par SMS'

const demanderCodeOTP = async (req, res) => {
  v.exigerChamps(req.body, ['phoneNumber', 'motif'])
  const telephone = v.telephone(req.body.phoneNumber, 'phoneNumber')
  const motif = v.enumeration(req.body.motif, 'motif', { valeurs: MOTIFS, message: 'Motif invalide' })

  const utilisateur = await chargerUtilisateurParTelephone(telephone)
  // Inscription d'un numéro déjà enregistré : inutile d'envoyer un SMS.
  if (motif === 'INSCRIPTION' && utilisateur) throw conflit('Ce numéro de téléphone est déjà enregistré : connectez-vous')
  // PIN oublié pour un numéro inconnu : même réponse, aucun envoi (pas d'énumération).
  if (motif === 'PIN_OUBLIE' && !utilisateur) {
    return res.status(200).json({ message: MESSAGE_CODE_ENVOYE, expireDansSecondes: 300, renvoiPossibleDansSecondes: 60 })
  }

  const envoi = await envoyerCode(telephone, motif)
  void auditerRequete(req, { userId: utilisateur ? utilisateur.user_id : null, entite: 'AUTH', action: `OTP_ENVOYE_${motif}` })
  return res.status(200).json({ message: MESSAGE_CODE_ENVOYE, ...envoi })
}

// ════════════════════════════════════════════
// POST /api/auth/pin-oublie   (public)
// { phoneNumber, otpCode, nouveauPin } : nouveau PIN après vérification du
// numéro par SMS ; toutes les sessions du compte sont fermées.
// ════════════════════════════════════════════
const reinitialiserPINOublie = async (req, res) => {
  v.exigerChamps(req.body, ['phoneNumber', 'otpCode', 'nouveauPin'])
  const telephone = v.telephone(req.body.phoneNumber, 'phoneNumber')
  const code = v.chaine(req.body.otpCode, 'otpCode', { min: 4, max: 10 })
  const nouveauPin = v.pin(req.body.nouveauPin, 'nouveauPin')
  if (estPINTrivial(nouveauPin)) {
    throw requeteInvalide('PIN trop simple : évitez les chiffres identiques et les suites (ex. 0000, 1234)', { champ: 'nouveauPin' })
  }

  exigerCodeValide(telephone, 'PIN_OUBLIE', code)
  const utilisateur = await chargerUtilisateurParTelephone(telephone)
  if (!utilisateur) throw requeteInvalide('Code expiré ou trop d\'essais : demandez un nouveau code', { champ: 'otpCode' })

  await sauvegarderHash(utilisateur.user_id, nouveauPin)
  await revoquerTousTokens(utilisateur.user_id)
  verrouCompte.reinitialiser(cleCompte(utilisateur.user_id))
  verrouCompte.reinitialiser(cleTelephone(telephone))
  void auditerRequete(req, { userId: utilisateur.user_id, entite: 'SECURITY', action: 'PIN_REINITIALISE_PAR_SMS' })
  return res.status(200).json({ message: 'PIN réinitialisé : connectez-vous avec votre nouveau PIN' })
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
  demanderCodeOTP,
  reinitialiserPINOublie,
  chargerUtilisateurActif,
  profilPublic,
  echecsParIP
}
