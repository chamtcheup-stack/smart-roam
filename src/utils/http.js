'use strict'

// ════════════════════════════════════════════════════════════
// Erreurs HTTP métier : levées par les contrôleurs et converties
// en réponse JSON { erreur, ...details } par le gestionnaire global.
// ════════════════════════════════════════════════════════════

class HttpError extends Error {
  constructor (statut, message, details = {}, { expose = statut < 500 } = {}) {
    super(message)
    this.name = 'HttpError'
    this.statut = statut
    this.details = details
    this.expose = expose
  }
}

const requeteInvalide = (message, details) => new HttpError(400, message, details)
const nonAuthentifie = (message = 'Authentification requise', details) => new HttpError(401, message, details)
const interdit = (message = 'Accès refusé', details) => new HttpError(403, message, details)
const introuvable = (message = 'Ressource introuvable', details) => new HttpError(404, message, details)
const conflit = (message, details) => new HttpError(409, message, details)
const indisponible = (message, details) => new HttpError(503, message, details, { expose: true })

const tropDeRequetes = (message, retryAfterSecondes) => {
  const erreur = new HttpError(429, message, { reessayerDansSecondes: retryAfterSecondes })
  erreur.retryAfter = retryAfterSecondes
  return erreur
}

module.exports = {
  HttpError,
  requeteInvalide,
  nonAuthentifie,
  interdit,
  introuvable,
  conflit,
  indisponible,
  tropDeRequetes
}
