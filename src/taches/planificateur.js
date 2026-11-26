'use strict'

// ════════════════════════════════════════════════════════════
// Tâches planifiées :
//   - JIT Stock Manager (algo 19)      : JIT_INTERVAL_MINUTES (0 = désactivé)
//   - maintenance (voyages, eSIM, …)   : MAINTENANCE_INTERVAL_MINUTES (60 par défaut)
// Une exécution n'en chevauche jamais une autre de la même tâche. En
// multi-instances, les mises à jour conditionnelles (REORDER_PENDING,
// statuts attendus) empêchent les doublons.
// ════════════════════════════════════════════════════════════

const config = require('../config')
const logger = require('../utils/logger')
const { journaliserAudit } = require('../utils/audit')
const { JITStockManager } = require('../algorithms/algo19_jitStockManager')
const { executerMaintenance: maintenance } = require('./maintenance')

const minuteries = new Map()
const enCours = new Set()

// Enveloppe : pas de chevauchement, aucune exception qui remonte.
const sansChevauchement = (nom, tache) => async () => {
  if (enCours.has(nom)) {
    logger.warn(`Tâche « ${nom} » : exécution précédente encore en cours, passage sauté`)
    return null
  }
  enCours.add(nom)
  try {
    return await tache()
  } catch (erreur) {
    logger.error(`Échec de la tâche planifiée « ${nom} »`, erreur)
    return null
  } finally {
    enCours.delete(nom)
  }
}

const executerJIT = sansChevauchement('jit', async () => {
  const rapport = await JITStockManager()
  const commandes = rapport.filter((ligne) => ligne.action === 'COMMANDE_PASSEE').length
  if (commandes > 0) void journaliserAudit({ entite: 'STOCK', action: `JIT_PLANIFIE_${commandes}_COMMANDE(S)` })
  return rapport
})

const executerMaintenance = sansChevauchement('maintenance', () => maintenance())

const planifier = (nom, intervalleMinutes, tache) => {
  if (intervalleMinutes <= 0 || minuteries.has(nom)) return false
  const minuterie = setInterval(tache, intervalleMinutes * 60 * 1000)
  minuterie.unref()
  minuteries.set(nom, minuterie)
  logger.info(`Tâche « ${nom} » planifiée toutes les ${intervalleMinutes} minute(s)`)
  return true
}

const demarrerTachesPlanifiees = () => {
  const jit = planifier('jit', config.jitIntervalleMinutes, executerJIT)
  const entretien = planifier('maintenance', config.maintenanceIntervalleMinutes, executerMaintenance)
  return jit || entretien
}

const arreterTachesPlanifiees = () => {
  for (const minuterie of minuteries.values()) clearInterval(minuterie)
  minuteries.clear()
}

module.exports = { demarrerTachesPlanifiees, arreterTachesPlanifiees, executerJIT, executerMaintenance }
