'use strict'

// ════════════════════════════════════════════════════════════
// Idempotence des opérations sensibles (en-tête « Idempotency-Key »).
// Un double clic ou une nouvelle tentative réseau avec la même clé
// renvoie la réponse déjà produite au lieu de rejouer l'opération
// (ex. une seconde transaction de change).
//   - même clé, même corps, terminé → réponse rejouée (Idempotent-Replayed: true)
//   - même clé, même corps, en cours → 409
//   - même clé, corps différent      → 422
// Seules les réponses réussies sont mémorisées (24 h, en mémoire).
// ════════════════════════════════════════════════════════════

const crypto = require('crypto')
const { HttpError, requeteInvalide, conflit } = require('../utils/http')

const DUREE_CONSERVATION_MS = 24 * 60 * 60 * 1000
const REGEX_CLE = /^[A-Za-z0-9_\-:.]{8,128}$/

const entrees = new Map()

const nettoyer = (maintenant = Date.now()) => {
  for (const [cle, entree] of entrees) if (entree.expiration <= maintenant) entrees.delete(cle)
}
setInterval(nettoyer, 10 * 60 * 1000).unref()

const empreinteRequete = (req) => crypto
  .createHash('sha256')
  .update(`${req.method} ${req.baseUrl}${req.path} ${JSON.stringify(req.body || {})}`)
  .digest('hex')

const idempotence = ({ obligatoire = false } = {}) => (req, res, next) => {
  const cle = req.get('idempotency-key')
  if (!cle) {
    if (obligatoire) throw requeteInvalide('En-tête Idempotency-Key obligatoire pour cette opération')
    return next()
  }
  if (!REGEX_CLE.test(cle)) {
    throw requeteInvalide('Idempotency-Key invalide : 8 à 128 caractères parmi A-Z a-z 0-9 _ - : .')
  }

  const portee = `${(req.auth && (req.auth.userId || req.auth.role)) || 'anonyme'}:${cle}`
  const empreinte = empreinteRequete(req)
  const existante = entrees.get(portee)

  if (existante && existante.expiration > Date.now()) {
    if (existante.empreinte !== empreinte) {
      throw new HttpError(422, 'Clé d\'idempotence déjà utilisée pour une requête différente')
    }
    if (existante.etat === 'EN_COURS') throw conflit('Requête identique déjà en cours de traitement')
    res.set('Idempotent-Replayed', 'true')
    return res.status(existante.statut).json(existante.corps)
  }

  entrees.set(portee, { empreinte, etat: 'EN_COURS', expiration: Date.now() + DUREE_CONSERVATION_MS })

  const jsonOriginal = res.json.bind(res)
  res.json = (corps) => {
    if (res.statusCode < 400) {
      entrees.set(portee, { empreinte, etat: 'TERMINE', statut: res.statusCode, corps, expiration: Date.now() + DUREE_CONSERVATION_MS })
    } else {
      entrees.delete(portee) // échec : le client peut réessayer avec la même clé
    }
    return jsonOriginal(corps)
  }
  res.on('close', () => {
    const entree = entrees.get(portee)
    if (entree && entree.etat === 'EN_COURS') entrees.delete(portee)
  })
  return next()
}

module.exports = { idempotence, reinitialiserIdempotence: () => entrees.clear() }
