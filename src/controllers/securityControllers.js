'use strict'

const supabase = require('../supabase')
const v = require('../utils/validation')
const logger = require('../utils/logger')
const { introuvable, requeteInvalide, interdit, tropDeRequetes } = require('../utils/http')
const { donnees } = require('../utils/db')
const { VerrouTentatives } = require('../utils/limiteur')
const { auditerRequete } = require('../utils/audit')
const { estPrivilegie } = require('../middlewares/auth')
const {
  sauvegarderHash,
  verifierPIN: verifierPINHash,
  verifierPINUtilisateur,
  estPINTrivial
} = require('../algorithms/algo11_hachagePIN')
const { revoquerTousTokens } = require('../algorithms/algo10_zeroTrustJWT')
const { evaluerRequeteWAF } = require('../algorithms/algo13_detectionWAF')

const QUINZE_MINUTES = 15 * 60 * 1000

// 5 échecs en 15 minutes → PIN verrouillé 15 minutes pour ce compte.
const verrouPIN = new VerrouTentatives({
  maxEchecs: 5,
  fenetreMs: QUINZE_MINUTES,
  dureeBlocageMs: QUINZE_MINUTES
})

const MESSAGE_VERROUILLE = 'Trop de tentatives : PIN temporairement verrouillé'

const chargerUtilisateurActif = async (userId) => {
  const utilisateur = donnees(
    await supabase.from('users').select('*').eq('user_id', userId).maybeSingle(),
    'lecture du PIN'
  )
  return utilisateur && !utilisateur.deleted_at ? utilisateur : null
}

const verifierNonVerrouille = (userId) => {
  const verrou = verrouPIN.etat(userId)
  if (verrou.bloque) throw tropDeRequetes(MESSAGE_VERROUILLE, verrou.reessayerDansSecondes)
}

// Vérifie un PIN en tenant le compteur d'échecs ; lève 429 au verrouillage.
const controlerPIN = async (req, utilisateur, userId, pin) => {
  const { valide } = await verifierPINUtilisateur(utilisateur, pin)
  if (valide) {
    verrouPIN.reinitialiser(userId)
    return { valide: true, echecsRestants: null }
  }
  const echec = verrouPIN.enregistrerEchec(userId)
  if (echec.bloque) {
    void auditerRequete(req, { userId, entite: 'SECURITY', action: 'PIN_VERROUILLE' })
    throw tropDeRequetes(MESSAGE_VERROUILLE, echec.reessayerDansSecondes)
  }
  return { valide: false, echecsRestants: echec.echecsRestants }
}

// ════════════════════════════════════════════
// POST /api/security/pin/create
// Création du premier PIN, ou changement (ancienPin obligatoire).
// Un administrateur / service peut réinitialiser le PIN d'un compte.
// ════════════════════════════════════════════
const creerPIN = async (req, res) => {
  v.exigerChamps(req.body, ['userId', 'pin'])
  const userId = v.identifiant(req.body.userId, 'userId')
  const pin = v.pin(req.body.pin, 'pin')

  if (estPINTrivial(pin)) {
    throw requeteInvalide('PIN trop simple : évitez les chiffres identiques et les suites (ex. 0000, 1234)')
  }

  const utilisateur = await chargerUtilisateurActif(userId)
  if (!utilisateur) throw introuvable('Utilisateur introuvable')

  const changement = Boolean(utilisateur.pin_hash)
  const reinitialisationPrivilegiee = changement && estPrivilegie(req.auth)

  if (changement && !reinitialisationPrivilegiee) {
    const ancienPin = v.pin(req.body.ancienPin, 'ancienPin')
    verifierNonVerrouille(userId)
    const controle = await controlerPIN(req, utilisateur, userId, ancienPin)
    if (!controle.valide) {
      throw interdit('Ancien PIN incorrect', { tentativesRestantes: controle.echecsRestants })
    }
    const identique = await verifierPINHash(pin, utilisateur.pin_hash, utilisateur.pin_salt)
    if (identique.valide) throw requeteInvalide('Le nouveau PIN doit être différent de l\'ancien')
  }

  await sauvegarderHash(userId, pin)
  void auditerRequete(req, {
    userId,
    entite: 'SECURITY',
    action: !changement ? 'PIN_CREE' : (reinitialisationPrivilegiee ? 'PIN_REINITIALISE' : 'PIN_MODIFIE')
  })

  if (changement) {
    // Un PIN modifié invalide toutes les sessions existantes du compte.
    await revoquerTousTokens(userId)
    logger.info(reinitialisationPrivilegiee ? 'PIN réinitialisé par un compte privilégié' : 'PIN modifié par son titulaire', {
      userId,
      par: req.auth.role
    })
    return res.status(200).json({ message: 'PIN modifié avec succès : veuillez vous reconnecter' })
  }

  return res.status(200).json({ message: 'PIN créé avec succès' })
}

// ════════════════════════════════════════════
// POST /api/security/pin/verify
// ════════════════════════════════════════════
const verifierPIN = async (req, res) => {
  v.exigerChamps(req.body, ['userId', 'pin'])
  const userId = v.identifiant(req.body.userId, 'userId')
  const pin = v.pin(req.body.pin, 'pin')

  verifierNonVerrouille(userId)

  // Compte inconnu, supprimé ou sans PIN : même réponse et même coût
  // de calcul qu'un PIN faux (aucune énumération possible).
  const utilisateur = await chargerUtilisateurActif(userId)
  const controle = await controlerPIN(req, utilisateur, userId, pin)

  if (!controle.valide) {
    return res.status(200).json({
      valide: false,
      message: 'PIN incorrect',
      tentativesRestantes: controle.echecsRestants
    })
  }
  return res.status(200).json({ valide: true, message: 'PIN correct' })
}

// ════════════════════════════════════════════
// POST /api/security/waf/analyze  (ADMIN / SERVICE)
// Simulation sans effet : { ip?, url?, payload? }
// ════════════════════════════════════════════
const analyserRequeteWAF = async (req, res) => {
  const ip = v.chaine(req.body.ip, 'ip', { optionnel: true, max: 64 }) || req.ip
  const url = v.chaine(req.body.url, 'url', { optionnel: true, max: 2048 }) || '/'
  const brut = req.body.payload
  const payload = typeof brut === 'string' ? { valeur: brut } : (brut && typeof brut === 'object' ? brut : {})

  const resultat = await evaluerRequeteWAF({ ip, originalUrl: url, body: payload }, { simulation: true })

  return res.status(200).json({
    message: 'Analyse WAF terminée (simulation sans effet)',
    decision: resultat.decision,
    raison: resultat.raison || 'REQUETE_NORMALE'
  })
}

module.exports = {
  creerPIN,
  verifierPIN,
  analyserRequeteWAF,
  verrouPIN
}
