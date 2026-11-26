'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 13 — Pare-feu applicatif (WAF)
//
// Règles évaluées dans l'ordre (la première déclenchée l'emporte) :
//   1. liste noire  : IP bloquée temporairement (blocage qui expire)
//   2. rate limit   : plus de 100 requêtes dans la seconde courante
//   3. injection    : motifs SQL / XSS dans l'URL ou le corps
//   4. spike        : trafic de la minute ≥ 10 × la moyenne mobile de l'IP
//   5. réputation   : IP déjà bloquée plusieurs fois en 24 h → CAPTCHA
//
// État en mémoire (un processus) : aucune écriture en base par requête,
// seuls les blocages sont audités. En cas d'erreur interne, la requête
// est autorisée (fail-open) pour préserver la disponibilité.
// ════════════════════════════════════════════════════════════

const config = require('../config')
const logger = require('../utils/logger')
const { journaliserAudit } = require('../utils/audit')

// Réglable (WAF_MAX_REQUETES_SECONDE) : une IP d'opérateur mobile (CGNAT)
// peut regrouper des milliers d'abonnés.
const MAX_REQUETES_PAR_SECONDE = config.limites.wafRequetesParSeconde
const DUREE_BLOCAGE_COURT = 60 // secondes
const DUREE_BLOCAGE_LONG = 3600 // secondes (injections)
const SEUIL_REPUTATION_BAS = 0.30
const SEUIL_SPIKE = 10.0
const MIN_REQUETES_SPIKE = 60 // par minute : pas de spike à très faible trafic
const PENALITE_REPUTATION_PAR_BLOCAGE = 0.25
const FENETRE_REPUTATION_MS = 24 * 60 * 60 * 1000
const INACTIVITE_PURGE_MS = 10 * 60 * 1000
const TAILLE_MAX_ANALYSE = 20000 // caractères analysés au maximum
const INTERVALLE_AUDIT_CAPTCHA_MS = 60 * 1000

const DECISION_AUTORISER = 'ALLOW'
const DECISION_BLOQUER = 'BLOCK'
const DECISION_CAPTCHA = 'CAPTCHA'

// Motifs bornés (pas de backtracking catastrophique sur des entrées hostiles).
const PATTERNS_SQL = [
  /\bdrop\s+table\b/i,
  /\bselect\s+\*\s+from\b/i,
  /\bunion\s+(?:all\s+)?select\b/i,
  /\binsert\s+into\b/i,
  /\bdelete\s+from\b/i,
  /\b(?:or|and)\s+(\d+)\s*=\s*\1\b/i,
  /'\s*(?:or|and)\s*'/i,
  /'\s*;?\s*--/,
  /\/\*[\s\S]{0,200}?\*\//,
  /\bxp_cmdshell\b/i,
  /;\s*(?:drop|delete|update|insert|alter|truncate|exec)\b/i,
  /\b(?:pg_)?sleep\s*\(\s*\d+\s*\)/i
]

const PATTERNS_XSS = [
  /<\s*script\b/i,
  /<\s*\/\s*script\s*>/i,
  /\bjavascript\s*:/i,
  /\bon(?:error|load|click|mouseover|focus|blur|submit|change|input)\s*=/i,
  /\balert\s*\(/i,
  /document\s*\.\s*cookie/i,
  /\beval\s*\(/i,
  /<\s*iframe\b/i,
  /<\s*(?:img|svg|body|object|embed)\b[^>]{0,200}\bon\w+\s*=/i
]

// ── État par adresse IP ─────────────────────────────────────
const etatsIP = new Map()

const obtenirEtat = (adresseIP, maintenant) => {
  let etat = etatsIP.get(adresseIP)
  if (!etat) {
    etat = {
      seconde: 0,
      compteSeconde: 0,
      minute: 0,
      compteMinute: 0,
      baselineMinute: 0,
      bloqueJusqua: 0,
      raisonBlocage: null,
      blocages: [],
      dernierAuditCaptcha: 0,
      derniereActivite: maintenant
    }
    etatsIP.set(adresseIP, etat)
  }
  return etat
}

const etatVide = () => ({ compteSeconde: 0, compteMinute: 0, baselineMinute: 0, bloqueJusqua: 0, blocages: [] })

const nettoyerEtats = (maintenant = Date.now()) => {
  for (const [adresseIP, etat] of etatsIP) {
    etat.blocages = etat.blocages.filter((horodatage) => maintenant - horodatage < FENETRE_REPUTATION_MS)
    const inactif = maintenant - etat.derniereActivite > INACTIVITE_PURGE_MS
    if (inactif && etat.bloqueJusqua <= maintenant && etat.blocages.length === 0) etatsIP.delete(adresseIP)
  }
}
setInterval(nettoyerEtats, 60 * 1000).unref()

// Compteurs à la seconde et à la minute + moyenne mobile (EWMA) par minute.
const enregistrerRequete = (etat, maintenant) => {
  const seconde = Math.floor(maintenant / 1000)
  if (etat.seconde !== seconde) {
    etat.seconde = seconde
    etat.compteSeconde = 0
  }
  etat.compteSeconde += 1

  const minute = Math.floor(maintenant / 60000)
  if (etat.minute !== minute) {
    if (etat.minute !== 0) {
      const ecart = minute - etat.minute
      etat.baselineMinute = etat.baselineMinute === 0
        ? etat.compteMinute
        : 0.8 * etat.baselineMinute + 0.2 * etat.compteMinute
      if (ecart > 1) etat.baselineMinute *= 0.8 ** (ecart - 1)
    }
    etat.minute = minute
    etat.compteMinute = 0
  }
  etat.compteMinute += 1
  etat.derniereActivite = maintenant
}

const calculerReputation = (etat, maintenant) => {
  const blocagesRecents = etat.blocages.filter((horodatage) => maintenant - horodatage < FENETRE_REPUTATION_MS).length
  return Math.max(0, 1 - PENALITE_REPUTATION_PAR_BLOCAGE * blocagesRecents)
}

// ── Détection ───────────────────────────────────────────────
const detecterInjectionSQL = (payload) => typeof payload === 'string' && PATTERNS_SQL.some((motif) => motif.test(payload))
const detecterInjectionXSS = (payload) => typeof payload === 'string' && PATTERNS_XSS.some((motif) => motif.test(payload))

const NON_DECLENCHEE = Object.freeze({ declenchee: false, decision: null, raison: null })

const evaluerRegleListeNoire = (etat, maintenant) => {
  if (etat.bloqueJusqua > maintenant) {
    return {
      declenchee: true,
      decision: DECISION_BLOQUER,
      raison: 'IP_EN_LISTE_NOIRE',
      reessayerDansSecondes: Math.ceil((etat.bloqueJusqua - maintenant) / 1000)
    }
  }
  return NON_DECLENCHEE
}

const evaluerRegleRateLimit = (compteurRequetes) => (compteurRequetes > MAX_REQUETES_PAR_SECONDE
  ? { declenchee: true, decision: DECISION_BLOQUER, raison: 'RATE_LIMIT_DEPASSE' }
  : NON_DECLENCHEE)

const evaluerRegleInjection = (payload) => {
  if (detecterInjectionSQL(payload)) return { declenchee: true, decision: DECISION_BLOQUER, raison: 'INJECTION_SQL_DETECTEE' }
  if (detecterInjectionXSS(payload)) return { declenchee: true, decision: DECISION_BLOQUER, raison: 'INJECTION_XSS_DETECTEE' }
  return NON_DECLENCHEE
}

const evaluerRegleSpike = (baselineTrafic, traficActuel) => {
  if (baselineTrafic >= 1 && traficActuel >= MIN_REQUETES_SPIKE) {
    const ratio = traficActuel / baselineTrafic
    if (ratio >= SEUIL_SPIKE) {
      return { declenchee: true, decision: DECISION_BLOQUER, raison: `SPIKE_TRAFIC_X${Math.round(ratio)}` }
    }
  }
  return NON_DECLENCHEE
}

const evaluerRegleReputation = (scoreReputation) => (scoreReputation < SEUIL_REPUTATION_BAS
  ? { declenchee: true, decision: DECISION_CAPTCHA, raison: 'REPUTATION_IP_FAIBLE' }
  : NON_DECLENCHEE)

// URL (décodée) + corps JSON, tronqués à TAILLE_MAX_ANALYSE caractères.
const extrairePayload = (requete) => {
  let url = String(requete.originalUrl || requete.url || '')
  try {
    url = decodeURIComponent(url)
  } catch {
    // URL mal encodée : analysée telle quelle
  }
  let corps = ''
  if (requete.body && typeof requete.body === 'object' && Object.keys(requete.body).length > 0) {
    try {
      corps = JSON.stringify(requete.body)
    } catch {
      corps = ''
    }
  }
  return `${url} ${corps}`.slice(0, TAILLE_MAX_ANALYSE)
}

const evaluerRegles = (etat, payload, maintenant, analyserContenu) => {
  const regles = [
    () => evaluerRegleListeNoire(etat, maintenant),
    () => evaluerRegleRateLimit(etat.compteSeconde),
    () => (analyserContenu ? evaluerRegleInjection(payload) : NON_DECLENCHEE),
    () => evaluerRegleSpike(etat.baselineMinute, etat.compteMinute),
    () => evaluerRegleReputation(calculerReputation(etat, maintenant))
  ]
  for (const regle of regles) {
    const resultat = regle()
    if (resultat.declenchee) return resultat
  }
  return null
}

// ── Procédures ──────────────────────────────────────────────
const bloquerIPTemporairement = (adresseIP, etat, dureeSecondes, raison, maintenant) => {
  etat.bloqueJusqua = maintenant + dureeSecondes * 1000
  etat.raisonBlocage = raison
  etat.blocages.push(maintenant)
  logger.warn('WAF : IP bloquée', { ip: adresseIP, dureeSecondes, raison })
}

const notifierEquipeOrange = (raison, adresseIP) => {
  logger.error('ALERTE WAF — équipe sécurité Orange', { raison, ip: adresseIP })
}

const appliquerDecision = (adresseIP, etat, regle, urlCible, maintenant) => {
  if (regle.decision === DECISION_BLOQUER && regle.raison !== 'IP_EN_LISTE_NOIRE') {
    const injection = regle.raison.startsWith('INJECTION')
    const duree = injection ? DUREE_BLOCAGE_LONG : DUREE_BLOCAGE_COURT
    bloquerIPTemporairement(adresseIP, etat, duree, regle.raison, maintenant)
    regle.reessayerDansSecondes = duree
    if (injection) notifierEquipeOrange(regle.raison, adresseIP)
    void journaliserAudit({ entite: 'WAF', action: `${regle.decision}_${regle.raison}`, extra: { ip_address: adresseIP } })
  } else if (regle.decision === DECISION_CAPTCHA && maintenant - etat.dernierAuditCaptcha > INTERVALLE_AUDIT_CAPTCHA_MS) {
    etat.dernierAuditCaptcha = maintenant
    void journaliserAudit({ entite: 'WAF', action: `${regle.decision}_${regle.raison}`, extra: { ip_address: adresseIP } })
  }
  logger.debug('WAF : requête refusée', { ip: adresseIP, url: urlCible, decision: regle.decision, raison: regle.raison })
}

// ── Algorithme principal ────────────────────────────────────
// options.simulation : évalue sans modifier l'état (compteurs, blocages).
// options.analyserContenu : désactive la règle d'injection (ex. endpoint d'analyse).
const evaluerRequeteWAF = async (requete, { simulation = false, analyserContenu = true } = {}) => {
  const maintenant = Date.now()
  try {
    const adresseIP = requete.ip || 'inconnue'
    const payload = extrairePayload(requete)
    const etat = simulation ? (etatsIP.get(adresseIP) || etatVide()) : obtenirEtat(adresseIP, maintenant)

    if (!simulation) enregistrerRequete(etat, maintenant)

    const regle = evaluerRegles(etat, payload, maintenant, analyserContenu)
    if (!regle) return { decision: DECISION_AUTORISER, raison: 'REQUETE_NORMALE' }

    const resultat = { ...regle }
    if (!simulation) appliquerDecision(adresseIP, etat, resultat, (requete.originalUrl || requete.url || '/').split('?')[0], maintenant)
    return {
      decision: resultat.decision,
      raison: resultat.raison,
      reessayerDansSecondes: resultat.reessayerDansSecondes
    }
  } catch (erreur) {
    logger.error('Erreur WAF : requête autorisée par défaut (fail-open)', erreur)
    return { decision: DECISION_AUTORISER, raison: 'ERREUR_WAF' }
  }
}

// Middleware Express. cheminsSansAnalyseContenu : chemins dont le corps
// contient légitimement des motifs suspects (ex. endpoint d'analyse WAF).
const creerMiddlewareWAF = ({ cheminsSansAnalyseContenu = [] } = {}) => async (req, res, next) => {
  const chemin = (req.originalUrl || req.url || '').split('?')[0]
  const resultat = await evaluerRequeteWAF(req, { analyserContenu: !cheminsSansAnalyseContenu.includes(chemin) })
  if (resultat.decision === DECISION_AUTORISER) return next()

  if (resultat.reessayerDansSecondes) res.set('Retry-After', String(resultat.reessayerDansSecondes))
  const statut = resultat.raison === 'RATE_LIMIT_DEPASSE' || resultat.raison.startsWith('SPIKE') ? 429 : 403
  return res.status(statut).json({
    erreur: 'Requête refusée par le pare-feu applicatif',
    decision: resultat.decision,
    raison: resultat.raison
  })
}

const reinitialiserEtatWAF = () => etatsIP.clear()

module.exports = {
  DECISION_AUTORISER,
  DECISION_BLOQUER,
  DECISION_CAPTCHA,
  evaluerRequeteWAF,
  creerMiddlewareWAF,
  detecterInjectionSQL,
  detecterInjectionXSS,
  evaluerRegleRateLimit,
  evaluerRegleInjection,
  evaluerRegleListeNoire,
  evaluerRegleSpike,
  evaluerRegleReputation,
  calculerReputation,
  enregistrerRequete,
  reinitialiserEtatWAF
}
