'use strict'

// Le hachage scrypt des PIN s'exécute dans le pool de threads de libuv (4 par
// défaut), partagé avec la résolution DNS des appels Supabase : un afflux de
// connexions ralentirait toute l'API. À définir avant toute opération asynchrone.
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = '16'

const config = require('./src/config')
const logger = require('./src/utils/logger')
const { creerApp } = require('./src/app')
const { demarrerTachesPlanifiees, arreterTachesPlanifiees } = require('./src/taches/planificateur')

const DELAI_ARRET_FORCE_MS = 10000

for (const avertissement of config.avertissements) logger.warn(avertissement)

let serveur = null

const demarrer = async () => {
  // Mode démo : données fictives chargées avant d'accepter la moindre requête.
  if (config.demo) await require('./src/demo/pilotageDemo').initialiserDemo()

  serveur = creerApp().listen(config.port, () => {
    logger.info(`Serveur Smart Roam démarré sur le port ${config.port} (${config.environnement}${config.demo ? ', MODE DÉMO' : ''})`)
    if (config.demo) process.stdout.write(require('./src/demo/banniere').banniereDemo(config.port))
    demarrerTachesPlanifiees()
  })

  serveur.on('error', (erreur) => {
    if (erreur.code === 'EADDRINUSE') {
      logger.error(`Le port ${config.port} est déjà utilisé`)
    } else {
      logger.error('Erreur du serveur HTTP', erreur)
    }
    process.exit(1)
  })
}

// ── Arrêt propre ──────────────────────────────────────────
let arretEnCours = false
const arreter = (signal) => {
  if (arretEnCours) return
  arretEnCours = true
  logger.info(`${signal} reçu : arrêt en cours…`)
  arreterTachesPlanifiees()
  if (!serveur) process.exit(0)
  serveur.close(() => {
    logger.info('Serveur arrêté proprement')
    process.exit(0)
  })
  setTimeout(() => {
    logger.error(`Arrêt forcé après ${DELAI_ARRET_FORCE_MS / 1000} s`)
    process.exit(1)
  }, DELAI_ARRET_FORCE_MS).unref()
}

process.on('SIGTERM', () => arreter('SIGTERM'))
process.on('SIGINT', () => arreter('SIGINT'))
process.on('unhandledRejection', (raison) => {
  logger.error('Promesse rejetée non gérée', raison instanceof Error ? raison : { raison: String(raison) })
})

demarrer().catch((erreur) => {
  logger.error('Démarrage impossible', erreur)
  process.exit(1)
})
