'use strict'

// ════════════════════════════════════════════════════════════
// Pilotage du mode démo : chargement des données fictives,
// réinitialisation complète (base + états en mémoire : verrous,
// limiteurs, WAF, idempotence, caches, sessions), résumé de l'état,
// entretien de la mémoire d'un serveur de démonstration de longue durée.
// ════════════════════════════════════════════════════════════

const base = require('./baseDemo')
const logger = require('../utils/logger')
const { construireDonneesDemo, ID } = require('./donneesDemo')
const { reinitialiserLimiteurs } = require('../utils/limiteur')
const { reinitialiserOTP } = require('../utils/otp')
const { reinitialiserIdempotence } = require('../middlewares/idempotence')
const { reinitialiserEtatWAF } = require('../algorithms/algo13_detectionWAF')
const { reinitialiserCacheCellID, detecterChangementCellID } = require('../algorithms/algo02_detectionCellID')
const { viderCacheRegles } = require('../algorithms/algo16_moteurForwarding')
const { viderCachesTaux } = require('../algorithms/algo17_conversionDevises')
const { reinitialiserEtatSessions } = require('../algorithms/algo10_zeroTrustJWT')
const { reinitialiserSuggestionsRefusees } = require('../algorithms/algo06_predictionAtterrissage')

const TAILLE_MAX_JOURNAUX = 5000
const INTERVALLE_ENTRETIEN_MS = 10 * 60 * 1000
const TABLES_JOURNAUX = ['audit_log', 'fraud_alert', 'travel_history', 'currency_transaction']

let chargee = false
let minuterieEntretien = null
let derniereReinitialisation = null

// Dernière antenne relais connue de chaque voyageur (comme un vrai téléphone) :
// dès la première arrivée simulée, le changement de cellule est détecté.
const ANTENNES_HABITUELLES = Object.freeze([
  [ID.awa, '624-02-1001-55501'], // Douala
  [ID.moussa, '206-10-2002-66602'] // Bruxelles
])

const chargerDonnees = async () => {
  base.reinitialiser(await construireDonneesDemo())
  reinitialiserCacheCellID()
  for (const [userId, cellule] of ANTENNES_HABITUELLES) detecterChangementCellID(userId, cellule)
  derniereReinitialisation = new Date().toISOString()
}

// Une démonstration peut tourner des jours : les journaux sont bornés.
const entretenir = () => {
  for (const table of TABLES_JOURNAUX) {
    const lignes = base.tables[table]
    if (Array.isArray(lignes) && lignes.length > TAILLE_MAX_JOURNAUX) lignes.splice(0, lignes.length - TAILLE_MAX_JOURNAUX)
  }
}

// Chargement initial (idempotent), avant l'ouverture du serveur.
const initialiserDemo = async () => {
  if (chargee) return false
  await chargerDonnees()
  chargee = true
  if (!minuterieEntretien) {
    minuterieEntretien = setInterval(entretenir, INTERVALLE_ENTRETIEN_MS)
    minuterieEntretien.unref()
  }
  return true
}

// Remet la démo dans son état initial. Tous les jetons déjà émis deviennent
// invalides : chaque appareil doit se reconnecter.
const reinitialiserDemo = async () => {
  await chargerDonnees()
  chargee = true
  reinitialiserLimiteurs()
  reinitialiserOTP()
  reinitialiserIdempotence()
  reinitialiserEtatWAF()
  viderCacheRegles()
  viderCachesTaux()
  reinitialiserSuggestionsRefusees()
  reinitialiserEtatSessions()
  logger.info('Mode démo réinitialisé : données fictives rechargées')
  return { reinitialiseeLe: derniereReinitialisation }
}

const compterPar = (lignes, colonne) => lignes.reduce((total, ligne) => {
  const cle = ligne[colonne] || 'INCONNU'
  total[cle] = (total[cle] || 0) + 1
  return total
}, {})

// Vue d'ensemble pour le panneau démo de l'application et le scénario.
const etatDemo = () => {
  const table = (nom) => base.tables[nom] || []
  return {
    reinitialiseeLe: derniereReinitialisation,
    utilisateurs: table('users').filter((utilisateur) => !utilisateur.deleted_at).length,
    voyages: compterPar(table('trip_declaration'), 'status'),
    numeros: compterPar(table('virtual_number'), 'status'),
    esimActives: table('esim_profile').filter((esim) => esim.status === 'ACTIVE').length,
    transactions: table('currency_transaction').length,
    alertesFraude: table('fraud_alert').length,
    stocks: table('did_pool').map((pool) => ({
      pays: pool.country_iso,
      occupation: `${((100 * pool.allocated_count) / pool.total_numbers).toFixed(1)} %`,
      disponibles: pool.total_numbers - pool.allocated_count,
      reapprovisionnement: pool.reorder_status || null
    })),
    evenementsAudit: table('audit_log').length,
    derniersEvenements: table('audit_log').slice(-10).reverse().map((ligne) => ({
      entite: ligne.entity_type,
      action: ligne.action,
      acteur: ligne.actor_type,
      le: ligne.created_at || null
    }))
  }
}

module.exports = { initialiserDemo, reinitialiserDemo, etatDemo, entretenir }
