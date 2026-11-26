'use strict'

// ════════════════════════════════════════════════════════════
// Traçage : identifiant de requête (en-tête X-Request-Id, repris s'il est
// fourni par un proxy, généré sinon), propagé dans les journaux, et une
// ligne de journal d'accès par requête (méthode, chemin, statut, durée).
// Ni l'IP ni la chaîne de requête ne sont journalisées ici.
// ════════════════════════════════════════════════════════════

const crypto = require('crypto')
const logger = require('../utils/logger')
const { executerDansContexte } = require('../utils/contexteRequete')

const REGEX_ID = /^[A-Za-z0-9_.:-]{8,128}$/
const CHEMINS_SUPERVISION = new Set(['/api/health', '/api/ready'])

const tracage = (req, res, next) => {
  const recu = req.get('x-request-id')
  const requestId = recu && REGEX_ID.test(recu) ? recu : crypto.randomUUID()
  req.id = requestId
  res.set('X-Request-Id', requestId)

  const debut = process.hrtime.bigint()
  res.on('finish', () => {
    const chemin = (req.originalUrl || req.url || '').split('?')[0]
    const dureeMs = Number(process.hrtime.bigint() - debut) / 1e6
    const niveau = CHEMINS_SUPERVISION.has(chemin) ? 'debug' : 'info'
    executerDansContexte({ requestId }, () => {
      logger[niveau](`${req.method} ${chemin} ${res.statusCode} ${dureeMs.toFixed(1)} ms`)
    })
  })

  executerDansContexte({ requestId }, next)
}

module.exports = { tracage }
