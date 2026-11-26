'use strict'

// ════════════════════════════════════════════════════════════
// Configuration centralisée — lecture et validation des variables
// d'environnement (voir .env.example). Aucun autre module ne doit
// lire process.env directement.
// ════════════════════════════════════════════════════════════

// Les tests sont hermétiques : ils ne lisent jamais le fichier .env réel.
if (process.env.NODE_ENV !== 'test') require('dotenv').config({ quiet: true })
const crypto = require('crypto')

const env = process.env
const environnement = env.NODE_ENV || 'development'
const estProduction = environnement === 'production'
const estTest = environnement === 'test'

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
  if (!estTest) {
    avertissements.push('JWT_SECRET absent : secret éphémère généré (les jetons seront invalidés à chaque redémarrage)')
  }
}

if (!env.PIN_PEPPER && estProduction) {
  avertissements.push('PIN_PEPPER absent : les PIN sont hachés sans poivre secret (fortement déconseillé en production)')
}

// ── CORS ────────────────────────────────────────────────────
let corsOrigins = liste(env.CORS_ORIGINS)
if (corsOrigins.length === 0 && !estProduction) {
  corsOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173']
}

const config = Object.freeze({
  environnement,
  estProduction,
  estTest,
  port: entier(env.PORT, 3000),
  logLevel: env.LOG_LEVEL || (estProduction ? 'info' : 'debug'),
  trustProxy: lireTrustProxy(env.TRUST_PROXY),
  corsOrigins,

  supabase: Object.freeze({
    url: env.SUPABASE_URL || '',
    cle: env.SUPABASE_KEY || ''
  }),

  jwt: Object.freeze({
    secret: jwtSecret,
    algorithme: 'HS256',
    emetteur: 'smart-roam-api',
    dureeAccesMinutes: 15,
    dureeAccesSensibleMinutes: 5,
    dureeRefreshMinutes: 7 * 24 * 60
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
  // Taux de référence BCE (appel HTTPS sortant) : désactivé en test.
  tauxBCEActif: env.ECB_RATES_ENABLED !== undefined ? env.ECB_RATES_ENABLED === 'true' : !estTest,
  iccidEmetteur: /^\d{2}$/.test(env.ICCID_ISSUER_ID || '') ? env.ICCID_ISSUER_ID : '01',

  avertissements: Object.freeze(avertissements)
})

module.exports = config
