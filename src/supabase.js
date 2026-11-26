'use strict'

const config = require('./config')

// Client serveur : aucune session utilisateur à persister ni à rafraîchir,
// délai maximal sur chaque requête (SUPABASE_TIMEOUT_MS).
const creerClientSupabase = () => {
  const { createClient } = require('@supabase/supabase-js')
  const { creerFetchAvecDelai } = require('./utils/fetchDelai')
  const { url, cle, delaiMs } = config.supabase

  if (!url || !cle) {
    throw new Error('Configuration Supabase manquante : définissez SUPABASE_URL et SUPABASE_KEY (voir .env.example), ou lancez le mode démo (npm run demo:serveur)')
  }
  try {
    new URL(url)
  } catch {
    throw new Error('SUPABASE_URL invalide : une URL complète est attendue (ex. https://votre-projet.supabase.co)')
  }

  return createClient(url, cle, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      fetch: creerFetchAvecDelai(delaiMs)
    }
  })
}

// Mode démo : base en mémoire (données fictives), aucune connexion à Supabase.
module.exports = config.demo ? require('./demo/baseDemo') : creerClientSupabase()
