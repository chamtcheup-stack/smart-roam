'use strict'

// ════════════════════════════════════════════════════════════
// Contexte commun des tests : variables d'environnement de test,
// base Supabase simulée en mémoire (aucun accès réseau ni à la vraie
// base), démarrage de l'application sur un port éphémère.
// À appeler AVANT tout require de src/.
// ════════════════════════════════════════════════════════════

const path = require('path')
const { creerFauxSupabase, installerFauxSupabase } = require('./fauxSupabase')

const RACINE = path.resolve(__dirname, '..', '..')
const CLE_SERVICE = 'cle-service-de-test-suffisamment-longue'
const ADMIN_ID = 'a0000000-0000-4000-8000-0000000000ad'

const preparer = ({ tables = {}, contraintesUniques = {}, schemas = {}, env = {} } = {}) => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SUPABASE_URL: 'http://127.0.0.1:9',
    SUPABASE_KEY: 'cle-de-test',
    JWT_SECRET: 'secret-jwt-de-test-'.padEnd(64, 'x'),
    SERVICE_API_KEY: CLE_SERVICE,
    ADMIN_USER_IDS: ADMIN_ID,
    PIN_PEPPER: 'poivre-de-test',
    ...env
  })
  const faux = installerFauxSupabase(RACINE, creerFauxSupabase(tables, { contraintesUniques, schemas }))
  const requerir = (cheminRelatif) => require(path.join(RACINE, cheminRelatif))
  return { faux, requerir }
}

// Mode démo réel (src/demo/baseDemo.js) : aucune injection de faux client.
const preparerDemo = ({ env = {} } = {}) => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DEMO_MODE: 'true',
    LOG_LEVEL: 'silent',
    JWT_SECRET: 'secret-jwt-de-test-'.padEnd(64, 'x'),
    ...env
  })
  const requerir = (cheminRelatif) => require(path.join(RACINE, cheminRelatif))
  return { requerir }
}

// Démarre l'application et fournit un client HTTP JSON minimal.
const demarrerApp = async (requerir) => {
  const { creerApp } = requerir('src/app')
  const serveur = creerApp().listen(0)
  await new Promise((resolve) => serveur.once('listening', resolve))
  const base = `http://127.0.0.1:${serveur.address().port}`

  const appel = async (methode, chemin, { corps, jeton, cle, entetes = {}, brut } = {}) => {
    const reponse = await fetch(base + chemin, {
      method: methode,
      headers: {
        'content-type': 'application/json',
        ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
        ...(cle ? { 'x-api-key': cle } : {}),
        ...entetes
      },
      ...(brut !== undefined ? { body: brut } : corps ? { body: JSON.stringify(corps) } : {})
    })
    let json = null
    try {
      json = await reponse.json()
    } catch {
      json = null
    }
    return { statut: reponse.status, json, entetes: reponse.headers }
  }

  const arreter = () => new Promise((resolve) => {
    serveur.closeAllConnections()
    serveur.close(() => resolve())
  })

  return { appel, arreter, base }
}

module.exports = { RACINE, CLE_SERVICE, ADMIN_ID, preparer, preparerDemo, demarrerApp }
