'use strict'

// ════════════════════════════════════════════════════════════
// Contexte de la requête HTTP en cours (identifiant de requête),
// propagé à travers les appels asynchrones : chaque ligne de journal
// émise pendant le traitement d'une requête porte son identifiant.
// ════════════════════════════════════════════════════════════

const { AsyncLocalStorage } = require('async_hooks')

const stockage = new AsyncLocalStorage()

const executerDansContexte = (contexte, fonction) => stockage.run(contexte, fonction)

const contexteCourant = () => stockage.getStore() || null

module.exports = { executerDansContexte, contexteCourant }
