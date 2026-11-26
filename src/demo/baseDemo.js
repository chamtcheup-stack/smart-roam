'use strict'

// ════════════════════════════════════════════════════════════
// Base de données du mode démo : en mémoire, fidèle au schéma attendu
// (une colonne inconnue est refusée comme par PostgREST) et aux
// contraintes d'unicité recommandées. Remplie par pilotageDemo.js.
// Ne dépend d'aucun autre module applicatif (chargée par src/supabase.js).
// ════════════════════════════════════════════════════════════

const { creerBaseMemoire, CLES_PRIMAIRES } = require('./baseMemoire')
const { SCHEMA_ATTENDU } = require('../outils/schemaAttendu')

// Colonnes attendues + clé primaire + date de création (présente dans toute table réelle).
const schemas = Object.fromEntries(SCHEMA_ATTENDU.map(({ table, colonnes }) => [
  table,
  [...new Set([...Object.keys(colonnes), CLES_PRIMAIRES[table], 'created_at'].filter(Boolean))]
]))

const contraintesUniques = {
  users: ['phone_number'],
  virtual_number: ['did_number'],
  esim_profile: ['iccid'],
  session: ['refresh_token_hash']
}

module.exports = creerBaseMemoire({}, { schemas, contraintesUniques, journaliser: false })
