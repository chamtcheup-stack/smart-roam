'use strict'

const crypto = require('crypto')
const logger = require('../utils/logger')

const cheminSansRequete = (req) => (req.originalUrl || req.url || '').split('?')[0]

// 404 JSON pour toute route non déclarée.
const routeIntrouvable = (req, res) => {
  res.status(404).json({
    erreur: 'Route introuvable',
    methode: req.method,
    chemin: cheminSansRequete(req)
  })
}

// Gestionnaire d'erreurs global : aucune information interne
// (message SQL, stack) n'est renvoyée au client pour les erreurs 5xx.
// eslint-disable-next-line no-unused-vars
const gestionnaireErreurs = (erreur, req, res, next) => {
  if (res.headersSent) return next(erreur)

  // Erreurs du parseur JSON (body-parser)
  if (erreur.type === 'entity.parse.failed') {
    return res.status(400).json({ erreur: 'Corps de requête JSON invalide' })
  }
  if (erreur.type === 'entity.too.large') {
    return res.status(413).json({ erreur: 'Corps de requête trop volumineux' })
  }

  const statut = Number.isInteger(erreur.statut) ? erreur.statut
    : Number.isInteger(erreur.status) ? erreur.status
      : 500

  if (statut < 500 || erreur.expose === true) {
    if (erreur.retryAfter) res.set('Retry-After', String(erreur.retryAfter))
    return res.status(statut).json({
      erreur: erreur.expose === false ? 'Requête refusée' : erreur.message,
      ...erreur.details
    })
  }

  const reference = crypto.randomUUID()
  logger.error(`Erreur interne [${reference}] ${req.method} ${cheminSansRequete(req)}`, erreur)
  return res.status(500).json({ erreur: 'Erreur serveur', reference })
}

module.exports = { routeIntrouvable, gestionnaireErreurs }
