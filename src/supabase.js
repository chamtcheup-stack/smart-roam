'use strict'

const { createClient } = require('@supabase/supabase-js')
const config = require('./config')
const { creerFetchAvecDelai } = require('./utils/fetchDelai')

const { url, cle, delaiMs } = config.supabase

if (!url || !cle) {
  throw new Error('Configuration Supabase manquante : définissez SUPABASE_URL et SUPABASE_KEY (voir .env.example)')
}

try {
  new URL(url)
} catch {
  throw new Error('SUPABASE_URL invalide : une URL complète est attendue (ex. https://votre-projet.supabase.co)')
}

// Client serveur : aucune session utilisateur à persister ni à rafraîchir,
// délai maximal sur chaque requête (SUPABASE_TIMEOUT_MS).
const supabase = createClient(url, cle, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  },
  global: {
    fetch: creerFetchAvecDelai(delaiMs)
  }
})

module.exports = supabase
