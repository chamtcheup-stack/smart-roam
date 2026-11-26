'use strict'

// ════════════════════════════════════════════════════════════
// Configuration centralisée — lecture et validation des variables
// d'environnement (voir .env.example). Aucun autre module ne doit
// lire process.env directement.
// ════════════════════════════════════════════════════════════

// Les tests sont hermétiques : ils ne lisent jamais le fichier .env réel.
if (process.env.NODE_ENV !== 'test') require('dotenv').config({ quiet: true })
const crypto = require('crypto')
const { analyserCleSupabase, MESSAGE_CLE_PUBLIQUE } = require('./utils/cleSupabase')

const env = process.env
const environnement = env.NODE_ENV || 'development'
const estProduction = environnement === 'production'
const estTest = environnement === 'test'

// Mode démo : base en mémoire et données fictives, aucune connexion à Supabase
// ni appel sortant. Interdit en production (comptes et PIN de démo publics).
const modeDemo = env.DEMO_MODE === 'true'
if (modeDemo && estProduction) {
  throw new Error('DEMO_MODE=true est interdit en production : le mode démo expose des comptes fictifs et leurs PIN')
}

const avertissements = []

const liste = (valeur) => (valeur || '')
  .split(',')
  .map((element) => element.trim())
  .filter(Boolean)

const entier = (valeur, defaut) => {
  const nombre = Number.parseInt(valeur, 10)
  return Number.isFinite(nombre) ? nombre : defaut
}

const lireTrustProxy = (valeur) => {
  if (valeur === undefined || valeur === '' || valeur === 'false') return false
  if (valeur === 'true') return true
  if (/^\d+$/.test(valeur)) return Number(valeur)
  return valeur
}

// ── Secret JWT ──────────────────────────────────────────────
let jwtSecret = env.JWT_SECRET
if (!jwtSecret || jwtSecret.length < 32) {
  if (estProduction) {
    throw new Error('JWT_SECRET manquant ou trop court (32 caractères minimum) : obligatoire en production')
  }
  jwtSecret = crypto.randomBytes(48).toString('hex')
  if (!estTest && !modeDemo) {
    avertissements.push('JWT_SECRET absent : secret éphémère généré (les jetons seront invalidés à chaque redémarrage)')
  }
}

// Clé Supabase publique utilisée côté serveur : mauvaise configuration grave.
if (!modeDemo && analyserCleSupabase(env.SUPABASE_KEY).adapteeAuServeur === false) {
  avertissements.push(MESSAGE_CLE_PUBLIQUE)
}

if (!env.PIN_PEPPER && estProduction) {
  avertissements.push('PIN_PEPPER absent : les PIN sont hachés sans poivre secret (fortement déconseillé en production)')
}

// ── Vérification du numéro par SMS (OTP) ────────────────────
// demo : code renvoyé dans la réponse (mode démo uniquement) ; console : code
// journalisé (développement uniquement) ; aucun : pas d'envoi tant qu'un
// fournisseur SMS réel n'est pas branché (src/utils/otp.js).
const FOURNISSEURS_OTP = ['aucun', 'console', 'demo']
const fournisseurOtp = env.OTP_PROVIDER || (modeDemo ? 'demo' : estProduction ? 'aucun' : 'console')
if (!FOURNISSEURS_OTP.includes(fournisseurOtp)) {
  throw new Error(`OTP_PROVIDER invalide : ${fournisseurOtp} (valeurs : ${FOURNISSEURS_OTP.join(', ')})`)
}
if (fournisseurOtp === 'demo' && !modeDemo) {
  throw new Error('OTP_PROVIDER=demo est réservé au mode démo : les codes seraient renvoyés dans les réponses')
}
if (fournisseurOtp === 'console' && estProduction) {
  throw new Error('OTP_PROVIDER=console est interdit en production : les codes seraient écrits dans les journaux')
}
// Code SMS exigé à l'inscription : par défaut en production et en démo.
const otpObligatoire = env.OTP_REQUIRED !== undefined ? env.OTP_REQUIRED === 'true' : (estProduction || modeDemo)
if (estProduction && otpObligatoire && fournisseurOtp === 'aucun') {
  avertissements.push('Aucun fournisseur SMS (OTP_PROVIDER) : inscriptions et « PIN oublié » sont impossibles tant qu\'il n\'est pas branché')
}
if (estProduction && !otpObligatoire) {
  avertissements.push('OTP_REQUIRED=false : inscription sans vérification du numéro, un tiers peut créer un compte au nom d\'un numéro qu\'il ne possède pas')
}

// ── CORS ────────────────────────────────────────────────────
let corsOrigins = liste(env.CORS_ORIGINS)
if (corsOrigins.length === 0 && !estProduction) {
  // Vite (5173) et Expo web (8081). Les applications mobiles natives n'envoient
  // pas d'en-tête Origin : elles ne sont pas concernées par CORS.
  corsOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8081', 'http://127.0.0.1:8081']
}

const config = Object.freeze({
  environnement,
  estProduction,
  estTest,
  demo: modeDemo,
  port: entier(env.PORT, 3000),
  logLevel: env.LOG_LEVEL || (estProduction ? 'info' : 'debug'),
  // texte (lisible) ou json (une ligne JSON par évènement, pour un outil de supervision)
  logFormat: env.LOG_FORMAT === 'json' ? 'json' : 'texte',
  trustProxy: lireTrustProxy(env.TRUST_PROXY),
  corsOrigins,

  supabase: Object.freeze({
    url: env.SUPABASE_URL || '',
    cle: env.SUPABASE_KEY || '',
    // Délai maximal d'une requête vers Supabase (une base lente ne bloque plus l'API).
    delaiMs: Math.max(500, entier(env.SUPABASE_TIMEOUT_MS, 8000))
  }),

  // Limitations par adresse IP. Les opérateurs mobiles partagent une même IP
  // publique entre des milliers d'abonnés (CGNAT) : seuils volontairement
  // élevés, la protection fine se fait par compte (verrou progressif).
  limites: Object.freeze({
    connexionsParIP15min: Math.max(1, entier(env.LIMITE_CONNEXIONS_IP_15MIN, 300)),
    echecsConnexionParIP15min: Math.max(1, entier(env.LIMITE_ECHECS_CONNEXION_IP_15MIN, 100)),
    inscriptionsParIPHeure: Math.max(1, entier(env.LIMITE_INSCRIPTIONS_IP_HEURE, 100)),
    wafRequetesParSeconde: Math.max(1, entier(env.WAF_MAX_REQUETES_SECONDE, 100))
  }),

  jwt: Object.freeze({
    secret: jwtSecret,
    algorithme: 'HS256',
    emetteur: 'smart-roam-api',
    dureeAccesMinutes: 15,
    dureeAccesSensibleMinutes: 5,
    dureeRefreshMinutes: 7 * 24 * 60
  }),

  otp: Object.freeze({
    fournisseur: fournisseurOtp,
    obligatoire: otpObligatoire
  }),

  cleServiceApi: env.SERVICE_API_KEY || null,
  adminUserIds: Object.freeze(liste(env.ADMIN_USER_IDS)),
  pinPepper: env.PIN_PEPPER || null,

  chiffrement: Object.freeze({
    cles: env.ENCRYPTION_KEYS || ''
  }),

  pinning: Object.freeze({
    empreintes: Object.freeze(liste(env.PARTNER_TLS_PINS)),
    expiration: env.PARTNER_TLS_PINS_EXPIRES_AT || null
  }),

  jitIntervalleMinutes: Math.max(0, entier(env.JIT_INTERVAL_MINUTES, 0)),
  // Clôture des voyages échus, expiration des forfaits eSIM, purge des sessions.
  maintenanceIntervalleMinutes: Math.max(0, entier(env.MAINTENANCE_INTERVAL_MINUTES, estTest ? 0 : 60)),
  // Taux de référence BCE (appel HTTPS sortant) : désactivé en test et en démo.
  tauxBCEActif: env.ECB_RATES_ENABLED !== undefined ? env.ECB_RATES_ENABLED === 'true' : !(estTest || modeDemo),
  iccidEmetteur: /^\d{2}$/.test(env.ICCID_ISSUER_ID || '') ? env.ICCID_ISSUER_ID : '01',

  avertissements: Object.freeze(avertissements)
})

module.exports = config
