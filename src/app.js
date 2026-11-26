'use strict'

// ════════════════════════════════════════════════════════════
// Construction de l'application Express (sans écoute réseau),
// réutilisable par server.js et par les tests.
// ════════════════════════════════════════════════════════════

const path = require('path')
const express = require('express')
const cors = require('cors')
const config = require('./config')
const supabase = require('./supabase')
const { routeIntrouvable, gestionnaireErreurs } = require('./middlewares/erreurs')
const { enTetesSecurite, optionsCors, assainirReponses } = require('./middlewares/securite')
const { tracage } = require('./middlewares/tracage')
const { creerMiddlewareWAF } = require('./algorithms/algo13_detectionWAF')

const DELAI_VERIFICATION_BASE_MS = 3000
const CHEMIN_SPEC_OPENAPI = path.join(__dirname, '..', 'docs', 'openapi.yaml')

// Montage des routeurs métier (réutilisé par le test de cohérence OpenAPI).
const MONTAGES = Object.freeze([
  ['/api/auth', './routes/auth'],
  ['/api/users', './routes/users'],
  ['/api/forwarding', './routes/forwarding'],
  ['/api/mirror', './routes/mirror'],
  ['/api/prediction', './routes/prediction'],
  ['/api/stock', './routes/stock'],
  ['/api/esim', './routes/esim'],
  ['/api/geolocalisation', './routes/geolocalisation'],
  ['/api/security', './routes/security'],
  ['/api/currency', './routes/currency'],
  ['/api/declarations', './routes/declarations']
])
const ALIAS = Object.freeze([['/api/geolocation', './routes/geolocalisation']]) // alias documenté dans le contrôleur

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

  // Identifiant de requête et journal d'accès, avant tout le reste.
  app.use(tracage)

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

  // Spécification OpenAPI (hors production) : docs/openapi.yaml.
  if (!config.estProduction) {
    app.get('/api/docs/openapi.yaml', (req, res) => {
      res.type('application/yaml').sendFile(CHEMIN_SPEC_OPENAPI)
    })
  }

  // ── Routes métier ────────────────────────────────────────
  for (const [prefixe, module] of [...MONTAGES, ...ALIAS]) app.use(prefixe, require(module))

  app.use(routeIntrouvable)
  app.use(gestionnaireErreurs)

  return app
}

module.exports = { creerApp, MONTAGES }
