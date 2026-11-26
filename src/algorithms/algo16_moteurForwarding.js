'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 16 — Moteur de règles de renvoi d'appel (forwarding)
//
// Pour un appel entrant sur un numéro virtuel (DID) :
//   1. DID inconnu ou inactif           → REJECT
//   2. règles actives du numéro appelé (ou globales, number_id NULL),
//      par priorité croissante ; la première dont la condition est
//      remplie s'applique
//   3. aucune règle applicable          → RING (sonnerie directe)
// Le moteur retourne la commande SIP que la plateforme de téléphonie
// exécute (302 vers la destination, 486 pour un rejet).
// ════════════════════════════════════════════════════════════

const supabase = require('../supabase')
const logger = require('../utils/logger')
const { donnees } = require('../utils/db')
const { journaliserAudit } = require('../utils/audit')
const { variantesTelephone } = require('../utils/validation')

const ACTION_FORWARD = 'FORWARD'
const ACTION_VOICEMAIL = 'VOICEMAIL'
const ACTION_REJECT = 'REJECT'
const ACTION_RING = 'RING'
const ACTIONS = Object.freeze([ACTION_FORWARD, ACTION_VOICEMAIL, ACTION_REJECT, ACTION_RING])

const CONDITION_ALWAYS = 'ALWAYS'
const CONDITION_BUSY = 'BUSY'
const CONDITION_NO_ANSWER = 'NO_ANSWER'
const CONDITION_NEVER = 'NEVER'
const CONDITIONS = Object.freeze([CONDITION_ALWAYS, CONDITION_BUSY, CONDITION_NO_ANSWER, CONDITION_NEVER])

const STATUT_LIBRE = 'LIBRE'
const STATUT_OCCUPE = 'OCCUPE'
const STATUT_SANS_REPONSE = 'SANS_REPONSE'
const STATUTS_LIGNE = Object.freeze([STATUT_LIBRE, STATUT_OCCUPE, STATUT_SANS_REPONSE])

const TTL_CACHE_REGLES_MS = 5 * 60 * 1000
const CODE_SIP_REJECT = '486 Busy Here'
const CODE_SIP_FORWARD = '302 Moved Temporarily'

// ── Cache des règles (par utilisateur, invalidé à chaque modification) ──
const cacheRegles = new Map() // userId → { regles, expiration }

const invaliderCacheRegles = (userId) => cacheRegles.delete(String(userId))

const lireCacheRegles = (userId) => {
  const entree = cacheRegles.get(String(userId))
  if (!entree || entree.expiration <= Date.now()) {
    cacheRegles.delete(String(userId))
    return null
  }
  return entree.regles
}

const ecrireCacheRegles = (userId, regles) => {
  cacheRegles.set(String(userId), { regles, expiration: Date.now() + TTL_CACHE_REGLES_MS })
}

// Accepte les variantes usuelles : OCCUPE / BUSY, SANS_REPONSE / Sans_Reponse / NO_ANSWER.
const normaliserStatutLigne = (statut) => {
  const texte = String(statut || STATUT_LIBRE).trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (texte === 'BUSY' || texte === 'OCCUPÉ') return STATUT_OCCUPE
  if (texte === 'NO_ANSWER' || texte === 'SANS_RÉPONSE') return STATUT_SANS_REPONSE
  return STATUTS_LIGNE.includes(texte) ? texte : STATUT_LIBRE
}

// ── Lectures ────────────────────────────────────────────────
const resoudreNumeroAppele = async (numeroAppele) => {
  const numeros = donnees(
    await supabase
      .from('virtual_number')
      .select('number_id, user_id, did_number, status')
      .in('did_number', variantesTelephone(numeroAppele))
      .eq('status', 'ACTIVE')
      .limit(1),
    'résolution du numéro appelé'
  )
  return (numeros && numeros[0]) || null
}

const chargerReglesUtilisateur = async (userId) => {
  const enCache = lireCacheRegles(userId)
  if (enCache) return enCache
  const regles = donnees(
    await supabase
      .from('forwarding_rule')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('priority', { ascending: true }),
    'chargement des règles de forwarding'
  ) || []
  ecrireCacheRegles(userId, regles)
  return regles
}

// Règles du numéro appelé + règles globales (number_id absent).
const filtrerReglesDuNumero = (regles, numberId) =>
  regles.filter((regle) => regle.number_id === null || regle.number_id === undefined || String(regle.number_id) === String(numberId))

// ── Évaluation ──────────────────────────────────────────────
const evaluerCondition = (regle, statutLigne) => {
  switch (regle.trigger_condition) {
    case CONDITION_ALWAYS: return true
    case CONDITION_BUSY: return statutLigne === STATUT_OCCUPE
    case CONDITION_NO_ANSWER: return statutLigne === STATUT_SANS_REPONSE
    default: return false // NEVER ou condition inconnue
  }
}

const memeNumero = (a, b) => Boolean(a) && Boolean(b) && String(a).replace(/^\+/, '') === String(b).replace(/^\+/, '')

// Destination de la règle, ou undefined si la règle est inapplicable
// (FORWARD sans cible, ou renvoi vers le numéro appelé lui-même = boucle).
const determinerDestination = (regle, userId, numeroAppele) => {
  switch (regle.action) {
    case ACTION_FORWARD:
      if (!regle.target_number || memeNumero(regle.target_number, numeroAppele)) return undefined
      return regle.target_number
    case ACTION_VOICEMAIL: return `VOICEMAIL_${userId}`
    case ACTION_REJECT: return null
    case ACTION_RING: return numeroAppele
    default: return undefined
  }
}

const codeSIP = (action) => (action === ACTION_REJECT ? CODE_SIP_REJECT : CODE_SIP_FORWARD)

// Pur : choisit la règle et la destination (testable sans base).
const choisirRegle = (regles, { statutLigne, userId, numeroAppele }) => {
  for (const regle of regles) {
    if (!evaluerCondition(regle, statutLigne)) continue
    const destination = determinerDestination(regle, userId, numeroAppele)
    if (destination === undefined) {
      logger.warn('Règle de forwarding inapplicable ignorée', { ruleId: regle.rule_id, action: regle.action })
      continue
    }
    return { regle, action: regle.action, destination }
  }
  return null
}

const journaliserDecision = (userId, action, destination) => {
  void journaliserAudit({
    userId,
    entite: 'FORWARDING_RULE',
    action: `APPEL_${action}_VERS_${destination ? logger.masquerTelephone(destination) : 'AUCUNE'}`
  })
}

// ── Traitement principal ────────────────────────────────────
const moteurRegleForwarding = async (numeroAppele, numeroAppelant, statutLigneBrut) => {
  const statutLigne = normaliserStatutLigne(statutLigneBrut)
  const numero = await resoudreNumeroAppele(numeroAppele)

  if (!numero) {
    logger.info('Numéro DID inconnu ou inactif : appel rejeté', { numeroAppele: logger.masquerTelephone(numeroAppele) })
    return { decision: ACTION_REJECT, destination: null, codeSIP: CODE_SIP_REJECT, raison: 'NUMERO_INCONNU_OU_INACTIF' }
  }

  const regles = filtrerReglesDuNumero(await chargerReglesUtilisateur(numero.user_id), numero.number_id)
  const choix = choisirRegle(regles, { statutLigne, userId: numero.user_id, numeroAppele: numero.did_number })

  const action = choix ? choix.action : ACTION_RING
  const destination = choix ? choix.destination : numero.did_number
  journaliserDecision(numero.user_id, action, destination)

  return {
    decision: action,
    destination,
    codeSIP: codeSIP(action),
    raison: choix ? 'REGLE_APPLIQUEE' : (regles.length === 0 ? 'AUCUNE_REGLE' : 'AUCUNE_REGLE_APPLICABLE'),
    regle: choix ? choix.regle : null,
    statutLigne,
    userId: numero.user_id,
    numberId: numero.number_id
  }
}

module.exports = {
  ACTIONS,
  CONDITIONS,
  STATUTS_LIGNE,
  ACTION_FORWARD,
  CODE_SIP_FORWARD,
  CODE_SIP_REJECT,
  normaliserStatutLigne,
  memeNumero,
  evaluerCondition,
  determinerDestination,
  filtrerReglesDuNumero,
  choisirRegle,
  invaliderCacheRegles,
  moteurRegleForwarding
}
