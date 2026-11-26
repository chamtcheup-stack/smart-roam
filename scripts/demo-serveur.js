'use strict'

// ════════════════════════════════════════════════════════════
// Serveur de démonstration : l'API complète sur des données fictives en
// mémoire, joignable par l'application mobile sur le réseau local.
//   npm run demo:serveur        (port 3000, ou PORT)
// Aucune connexion à Supabase : SUPABASE_URL / SUPABASE_KEY sont ignorées.
// Jamais en production (refusé par la configuration).
// ════════════════════════════════════════════════════════════

process.env.DEMO_MODE = 'true'
if (process.env.NODE_ENV !== 'test') process.env.NODE_ENV = 'development'
if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'info'

require('../server')
