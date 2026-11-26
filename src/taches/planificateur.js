'use strict'

// ════════════════════════════════════════════════════════════
// Tâches planifiées : JIT Stock Manager (algo 19) toutes les
// JIT_INTERVAL_MINUTES minutes (0 = désactivé). Une exécution n'en
// chevauche jamais une autre ; en multi-instances, le marquage atomique
// REORDER_PENDING empêche les doubles commandes.
// ════════════════════════════════════════════════════════════

const config = require('../config')
const logger = require('../utils/logger')
const { journaliserAudit } = require('../utils/audit')
const { JITStockManager } = require('../algorithms/algo19_jitStockManager')

let minuterie = null
let executionEnCours = false

const executerJIT = async () => {
  if (executionEnCours) {
    logger.warn('JIT Stock Manager : exécution précédente encore en cours, passage sauté')
    return null
  }
  executionEnCours = true
  try {
    const rapport = await JITStockManager()
    const commandes = rapport.filter((ligne) => ligne.action === 'COMMANDE_PASSEE').length
    if (commandes > 0) void journaliserAudit({ entite: 'STOCK', action: `JIT_PLANIFIE_${commandes}_COMMANDE(S)` })
    return rapport
  } catch (erreur) {
    logger.error('Échec de l\'exécution planifiée du JIT Stock Manager', erreur)
    return null
  } finally {
    executionEnCours = false
  }
}

const demarrerTachesPlanifiees = () => {
  if (config.jitIntervalleMinutes <= 0 || minuterie) return false
  minuterie = setInterval(executerJIT, config.jitIntervalleMinutes * 60 * 1000)
  minuterie.unref()
  logger.info(`JIT Stock Manager planifié toutes les ${config.jitIntervalleMinutes} minute(s)`)
  return true
}

const arreterTachesPlanifiees = () => {
  if (minuterie) clearInterval(minuterie)
  minuterie = null
}

module.exports = { demarrerTachesPlanifiees, arreterTachesPlanifiees, executerJIT }
