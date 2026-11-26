'use strict'

// ════════════════════════════════════════════════════════════
// Vérification du schéma réel de la base face au schéma attendu.
// LECTURE SEULE : uniquement des « SELECT … LIMIT 0 » (aucune ligne lue,
// aucune donnée personnelle récupérée, aucune écriture).
// ════════════════════════════════════════════════════════════

const { estTableAbsente, estColonneAbsente } = require('../utils/db')
const { analyserCleSupabase } = require('../utils/cleSupabase')
const { SCHEMA_ATTENDU } = require('./schemaAttendu')

const CODE_ACCES_REFUSE = '42501'

const sonder = async (client, table, colonnes) => {
  const { error } = await client.from(table).select(colonnes).limit(0)
  return error || null
}

// Colonne attendue : true = indispensable ; texte = optionnelle (impact si absente).
const decrireColonne = (nom, definition) => ({
  nom,
  obligatoire: definition === true,
  impact: typeof definition === 'string' ? definition : null
})

const verifierTable = async (client, { table, colonnes, optionnelle }) => {
  const base = { table, optionnelle: Boolean(optionnelle), repli: optionnelle || null, colonnesManquantes: [] }

  const erreurTable = await sonder(client, table, '*')
  if (erreurTable) {
    if (estTableAbsente(erreurTable)) return { ...base, statut: 'ABSENTE' }
    if (erreurTable.code === CODE_ACCES_REFUSE) return { ...base, statut: 'ACCES_REFUSE' }
    return { ...base, statut: 'ERREUR', erreur: erreurTable.code || erreurTable.message }
  }

  const noms = Object.keys(colonnes)
  const erreurColonnes = await sonder(client, table, noms.join(','))
  if (!erreurColonnes) return { ...base, statut: 'OK' }
  if (!estColonneAbsente(erreurColonnes)) {
    return { ...base, statut: 'ERREUR', erreur: erreurColonnes.code || erreurColonnes.message }
  }

  // Une colonne au moins manque : sondage individuel pour les lister toutes.
  for (const nom of noms) {
    const erreur = await sonder(client, table, nom)
    if (erreur && estColonneAbsente(erreur)) base.colonnesManquantes.push(decrireColonne(nom, colonnes[nom]))
  }
  return { ...base, statut: 'INCOMPLETE' }
}

// Bloquant : table indispensable absente / inaccessible / en erreur, ou colonne
// indispensable absente d'une table présente.
const estBloquant = (resultat) => {
  if (resultat.statut === 'OK') return false
  if (resultat.statut === 'INCOMPLETE') return resultat.colonnesManquantes.some((colonne) => colonne.obligatoire)
  return !resultat.optionnelle || resultat.statut !== 'ABSENTE'
}

const verifierSchema = async (client, schema = SCHEMA_ATTENDU) => {
  const tables = []
  for (const definition of schema) tables.push(await verifierTable(client, definition))
  const bloquants = tables.filter(estBloquant)
  return { conforme: bloquants.length === 0, bloquants: bloquants.map((t) => t.table), tables }
}

module.exports = { verifierSchema, verifierTable, estBloquant, analyserCleSupabase }
