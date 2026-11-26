'use strict'

// ════════════════════════════════════════════════════════════
// Construction de l'application Express (sans écoute réseau),
// réutilisable par server.js et par les tests.
// ════════════════════════════════════════════════════════════

const express = require('express')
const cors = require('cors')
const config = require('./config')
const supabase = require('./supabase')
const { routeIntrouvable, gestionnaireErreurs } = require('./middlewares/erreurs')
const { enTetesSecurite, optionsCors, assainirReponses } = require('./middlewares/securite')
const { creerMiddlewareWAF } = require('./algorithms/algo13_detectionWAF')

const DELAI_VERIFICATION_BASE_MS = 3000

const verifierBase = async () => {
  const requete = supabase.from('country').select('country_iso', { head: true, count: 'exact' }).limit(1)
  const delai = new Promise((resolve) => {
    setTimeout(() => resolve({ error: { message: 'délai dépassé' } }), DELAI_VERIFICATION_BASE_MS).unref()
  })
  try {
    const { error } = await Promise.race([requete, delai])
    return !error
  } catch {
    return false
  }
}

const creerApp = () => {
  const app = express()

  // Derrière un reverse proxy, req.ip doit refléter l'IP réelle du client.
  app.set('trust proxy', config.trustProxy)
  app.disable('x-powered-by')

  app.use(enTetesSecurite)
  app.use(cors(optionsCors))
  app.use(assainirReponses)
  app.use(express.json({ limit: '100kb' }))

  // Express 5 : req.body vaut undefined quand aucun corps n'est envoyé.
  app.use((req, res, next) => {
    if (req.body === undefined || req.body === null) req.body = {}
    next()
  })

  // Pare-feu applicatif (algo 13) sur toutes les requêtes.
  app.use(creerMiddlewareWAF({ cheminsSansAnalyseContenu: ['/api/security/waf/analyze'] }))

  // ── Supervision ──────────────────────────────────────────
  app.get('/', (req, res) => {
    res.json({ message: 'Serveur Smart Roam opérationnel' })
  })

  // Liveness : le processus répond.
  app.get('/api/health', (req, res) => {
    res.json({ statut: 'ok', uptimeSecondes: Math.round(process.uptime()) })
  })

  // Readiness : la base de données est joignable.
  app.get('/api/ready', async (req, res) => {
    const baseOk = await verifierBase()
    res.status(baseOk ? 200 : 503).json({
      statut: baseOk ? 'ok' : 'indisponible',
      base: baseOk ? 'ok' : 'injoignable'
    })
  })

  // ── Routes métier ────────────────────────────────────────
  const routesGeolocalisation = require('./routes/geolocalisation')

  app.use('/api/auth', require('./routes/auth'))
  app.use('/api/users', require('./routes/users'))
  app.use('/api/forwarding', require('./routes/forwarding'))
  app.use('/api/mirror', require('./routes/mirror'))
  app.use('/api/prediction', require('./routes/prediction'))
  app.use('/api/stock', require('./routes/stock'))
  app.use('/api/esim', require('./routes/esim'))
  app.use('/api/geolocalisation', routesGeolocalisation)
  app.use('/api/geolocation', routesGeolocalisation) // alias documenté dans le contrôleur
  app.use('/api/security', require('./routes/security'))
  app.use('/api/currency', require('./routes/currency'))
  app.use('/api/declarations', require('./routes/declarations'))

  app.use(routeIntrouvable)
  app.use(gestionnaireErreurs)

  return app
}

module.exports = { creerApp }
