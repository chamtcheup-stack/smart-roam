'use strict'

// ════════════════════════════════════════════════════════════
// Aides Supabase : distinguer « introuvable » d'une vraie panne,
// ne jamais exposer le message SQL au client, tolérer les tables
// optionnelles absentes.
// ════════════════════════════════════════════════════════════

const logger = require('./logger')

const CODES_TABLE_ABSENTE = new Set(['PGRST205', '42P01'])
const CODES_COLONNE_ABSENTE = new Set(['PGRST204', '42703'])
const CODE_VIOLATION_UNICITE = '23505'

class ErreurBase extends Error {
  constructor (contexte, erreurSupabase) {
    super(`Erreur base de données : ${contexte}`)
    this.name = 'ErreurBase'
    this.statut = 500
    this.expose = false
    this.code = erreurSupabase && erreurSupabase.code
    this.cause = erreurSupabase
  }
}

// Retourne data, ou lève une ErreurBase (500 générique côté client).
const donnees = (resultat, contexte) => {
  if (resultat.error) throw new ErreurBase(contexte, resultat.error)
  return resultat.data
}

const estTableAbsente = (erreur) => Boolean(erreur) && (
  CODES_TABLE_ABSENTE.has(erreur.code) ||
  /does not exist|could not find the table/i.test(erreur.message || '')
)

const estColonneAbsente = (erreur) => Boolean(erreur) && (
  CODES_COLONNE_ABSENTE.has(erreur.code) ||
  /could not find the .* column|column .* does not exist/i.test(erreur.message || '')
)

const estViolationUnicite = (erreur) => Boolean(erreur) && erreur.code === CODE_VIOLATION_UNICITE

// Table/colonne absente, contrainte NOT NULL ou clé étrangère, type ou droits
// incompatibles : le schéma réel ne correspond pas à celui attendu.
const CODES_INCOMPATIBILITE = new Set(['23502', '23503', '22P02', '42501'])
const estIncompatibiliteSchema = (erreur) => Boolean(erreur) && (
  estTableAbsente(erreur) || estColonneAbsente(erreur) || CODES_INCOMPATIBILITE.has(erreur.code)
)

// Insère une ligne et la retourne ; si une colonne optionnelle n'existe pas
// dans le schéma réel, réessaie sans les colonnes optionnelles.
// Retourne { data, error } (l'appelant traite les violations d'unicité).
const insererAvecColonnesOptionnelles = async (client, table, ligne, colonnesOptionnelles = []) => {
  const resultat = await client.from(table).insert([ligne]).select().single()
  if (!resultat.error || !estColonneAbsente(resultat.error) || colonnesOptionnelles.length === 0) return resultat
  const reduite = Object.fromEntries(Object.entries(ligne).filter(([colonne]) => !colonnesOptionnelles.includes(colonne)))
  logger.warn(`Table ${table} : colonnes optionnelles absentes, insertion réduite`, { colonnes: colonnesOptionnelles })
  return client.from(table).insert([reduite]).select().single()
}

// Exécute une requête de liste créée avec select(..., { count: 'exact' })
// sur la page demandée : { lignes, total }.
const paginer = async (requete, { limit, offset }, contexte) => {
  const { data, error, count } = await requete.range(offset, offset + limit - 1)
  if (error) throw new ErreurBase(contexte, error)
  const lignes = data || []
  return { lignes, total: Number.isInteger(count) ? count : offset + lignes.length }
}

// Opération secondaire (audit, cache…) : ne doit jamais faire échouer la requête.
const executerSansEchec = async (requete, contexte) => {
  try {
    const { error } = await requete
    if (error) {
      logger.warn(`Opération secondaire échouée : ${contexte}`, { code: error.code, message: error.message })
      return false
    }
    return true
  } catch (erreur) {
    logger.warn(`Opération secondaire échouée : ${contexte}`, erreur)
    return false
  }
}

module.exports = {
  ErreurBase,
  donnees,
  estTableAbsente,
  estColonneAbsente,
  estViolationUnicite,
  estIncompatibiliteSchema,
  insererAvecColonnesOptionnelles,
  paginer,
  executerSansEchec
}
