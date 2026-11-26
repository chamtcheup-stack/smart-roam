'use strict'

const supabase = require('../supabase')
const v = require('../utils/validation')
const logger = require('../utils/logger')
const { introuvable, requeteInvalide, interdit, conflit, tropDeRequetes } = require('../utils/http')
const { donnees, estTableAbsente, estColonneAbsente, ErreurBase } = require('../utils/db')
const { verrouCompte, cleCompte, cleTelephone } = require('../utils/verrouCompte')
const { auditerRequete } = require('../utils/audit')
const { estPrivilegie } = require('../middlewares/auth')
const {
  sauvegarderHash,
  verifierPIN: verifierPINHash,
  verifierPINUtilisateur,
  estPINTrivial
} = require('../algorithms/algo11_hachagePIN')
const { revoquerTousTokens, genererJetonSensible } = require('../algorithms/algo10_zeroTrustJWT')
const { evaluerRequeteWAF } = require('../algorithms/algo13_detectionWAF')

// Verrou progressif partagé avec la connexion (utils/verrouCompte).
const MESSAGE_VERROUILLE = 'Trop de tentatives : PIN temporairement verrouillé'

const chargerUtilisateurActif = async (userId) => {
  const utilisateur = donnees(
    await supabase.from('users').select('*').eq('user_id', userId).maybeSingle(),
    'lecture du PIN'
  )
  return utilisateur && !utilisateur.deleted_at ? utilisateur : null
}

const verifierNonVerrouille = (userId) => {
  const verrou = verrouCompte.etat(cleCompte(userId))
  if (verrou.bloque) throw tropDeRequetes(MESSAGE_VERROUILLE, verrou.reessayerDansSecondes)
}

// Vérifie un PIN en tenant le compteur d'échecs ; lève 429 au verrouillage.
const controlerPIN = async (req, utilisateur, userId, pin) => {
  const { valide } = await verifierPINUtilisateur(utilisateur, pin)
  if (valide) {
    verrouCompte.reinitialiser(cleCompte(userId))
    return { valide: true, echecsRestants: null }
  }
  const echec = verrouCompte.enregistrerEchec(cleCompte(userId))
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
  // PIN confirmé : jeton d'opération sensible (5 min) pour la session courante,
  // exigé par les conversions et la suppression du compte.
  const reponse = { valide: true, message: 'PIN correct' }
  if (req.auth && req.auth.sessionId && String(req.auth.userId) === String(userId)) {
    reponse.jetonSensible = genererJetonSensible({
      userId,
      role: req.auth.role,
      deviceId: req.auth.deviceId,
      sessionId: req.auth.sessionId,
      appareilConnu: req.auth.appareilConnu
    })
  }
  return res.status(200).json(reponse)
}

// ════════════════════════════════════════════
// POST /api/security/pin/unlock   (ADMIN / SERVICE)
// Lever le verrouillage anti-force brute d'un compte, après vérification
// de l'identité du titulaire par le support.
// ════════════════════════════════════════════
const deverrouillerCompte = async (req, res) => {
  const userId = v.identifiant(req.body.userId, 'userId')
  const utilisateur = await chargerUtilisateurActif(userId)
  if (!utilisateur) throw introuvable('Utilisateur introuvable')

  const etat = verrouCompte.etat(cleCompte(userId))
  verrouCompte.reinitialiser(cleCompte(userId))
  verrouCompte.reinitialiser(cleTelephone(utilisateur.phone_number))
  void auditerRequete(req, { userId, entite: 'SECURITY', action: 'COMPTE_DEVERROUILLE' })

  return res.status(200).json({
    message: etat.bloque ? 'Compte déverrouillé' : "Le compte n'était pas verrouillé (compteurs remis à zéro)",
    etaitVerrouille: etat.bloque
  })
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

// ════════════════════════════════════════════
// GET /api/security/fraud-alerts?userId=   (ADMIN / SERVICE)
// Alertes de fraude, les plus récentes d'abord. Table optionnelle :
// liste vide (disponible: false) si elle n'existe pas.
// ════════════════════════════════════════════
const listerAlertesFraude = async (req, res) => {
  const page = v.pagination(req.query)
  const userId = v.identifiant(req.query.userId, 'userId', { optionnel: true })

  const lire = (trierParDate) => {
    let requete = supabase.from('fraud_alert').select('*', { count: 'exact' })
    if (userId) requete = requete.eq('user_id', userId)
    if (trierParDate) requete = requete.order('created_at', { ascending: false })
    return requete.range(page.offset, page.offset + page.limit - 1)
  }

  let resultat = await lire(true)
  if (resultat.error && estColonneAbsente(resultat.error)) resultat = await lire(false) // sans created_at
  if (resultat.error) {
    if (estTableAbsente(resultat.error)) return res.status(200).json({ alertes: [], total: 0, ...page, disponible: false })
    throw new ErreurBase('lecture des alertes de fraude', resultat.error)
  }
  const alertes = resultat.data || []
  return res.status(200).json({
    alertes,
    total: Number.isInteger(resultat.count) ? resultat.count : page.offset + alertes.length,
    ...page,
    disponible: true
  })
}

// ════════════════════════════════════════════
// PUT /api/security/numbers/:numberId/reactivate   (ADMIN / SERVICE)
// Lever la suspension anti-fraude d'un numéro, après vérification de
// l'identité du titulaire par le support. Statut rétabli selon le voyage :
// actif sur place, en attente avant l'arrivée, en parking sinon.
// ════════════════════════════════════════════
const reactiverNumero = async (req, res) => {
  const numberId = v.identifiant(req.params.numberId, 'numberId')
  const numero = donnees(
    await supabase.from('virtual_number').select('*').eq('number_id', numberId).maybeSingle(),
    'lecture du numéro virtuel'
  )
  if (!numero) throw introuvable('Numéro virtuel introuvable')
  if (numero.status !== 'SUSPENDED') throw conflit('Ce numéro n\'est pas suspendu', { statut: numero.status })

  const voyages = donnees(
    await supabase
      .from('trip_declaration')
      .select('status')
      .eq('user_id', numero.user_id)
      .eq('number_id', numberId)
      .in('status', ['PENDING', 'CONFIRMED'])
      .order('declaration_time', { ascending: false })
      .limit(1),
    'lecture du voyage en cours'
  ) || []
  const voyage = voyages[0]
  const statut = !voyage ? 'PARKED' : (voyage.status === 'CONFIRMED' ? 'ACTIVE' : 'AWAITING_ARRIVAL')

  // Mise à jour conditionnelle : aucun changement concurrent écrasé.
  const lignes = donnees(
    await supabase
      .from('virtual_number')
      .update({ status: statut, suspended_at: null })
      .eq('number_id', numberId)
      .eq('status', 'SUSPENDED')
      .select(),
    'levée de la suspension'
  ) || []
  if (lignes.length === 0) throw conflit('Le numéro a été modifié entre-temps : réessayez')

  void auditerRequete(req, { userId: numero.user_id, entite: 'SECURITY', action: `SUSPENSION_LEVEE_${numberId}_${statut}` })
  logger.info('Suspension anti-fraude levée par le support', { numberId, statut, par: req.auth.role })
  return res.status(200).json({ message: 'Suspension levée', numero: lignes[0] })
}

module.exports = {
  creerPIN,
  verifierPIN,
  deverrouillerCompte,
  analyserRequeteWAF,
  listerAlertesFraude,
  reactiverNumero
}
