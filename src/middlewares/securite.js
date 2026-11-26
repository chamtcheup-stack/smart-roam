'use strict'

// ════════════════════════════════════════════════════════════
// Durcissement HTTP : en-têtes de sécurité, CORS restreint,
// et filet de sécurité contre la fuite de détails d'erreur.
// ════════════════════════════════════════════════════════════

const crypto = require('crypto')
const config = require('../config')
const logger = require('../utils/logger')

// En-têtes adaptés à une API JSON (aucun contenu actif servi).
const enTetesSecurite = (req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
    'Cache-Control': 'no-store'
  })
  if (config.estProduction) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
}

// Origines autorisées : CORS_ORIGINS (localhost:5173 par défaut en développement).
// Les clients non navigateur (application mobile, serveurs) n'envoient pas d'Origin.
const optionsCors = {
  origin: (origine, rappel) => rappel(null, !origine || config.corsOrigins.includes(origine)),
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'Idempotency-Key'],
  exposedHeaders: ['Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining'],
  maxAge: 600
}

// Toute réponse 5xx est expurgée des champs internes (detail, stack) :
// ils sont journalisés côté serveur et remplacés par une référence.
const assainirReponses = (req, res, next) => {
  const jsonOriginal = res.json.bind(res)
  res.json = (corps) => {
    const aExpurger = res.statusCode >= 500 && corps && typeof corps === 'object' &&
      !Array.isArray(corps) && ('detail' in corps || 'stack' in corps)
    if (!aExpurger) return jsonOriginal(corps)

    const { detail, stack: _stack, ...reste } = corps
    const reference = reste.reference || crypto.randomUUID()
    logger.error(`Détail d'erreur retiré de la réponse [${reference}] ${req.method} ${(req.originalUrl || '').split('?')[0]}`, {
      detail: logger.masquerTexte(typeof detail === 'string' ? detail : JSON.stringify(detail))
    })
    return jsonOriginal({ ...reste, reference })
  }
  next()
}

module.exports = { enTetesSecurite, optionsCors, assainirReponses }
