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

// Requête abandonnée faute de réponse dans le délai (voir utils/fetchDelai).
const estDelaiDepasse = (erreur) => Boolean(erreur) && /AbortError|TimeoutError|délai/i.test(erreur.message || '')

class ErreurBase extends Error {
  constructor (contexte, erreurSupabase) {
    super(`Erreur base de données : ${contexte}`)
    this.name = 'ErreurBase'
    this.code = erreurSupabase && erreurSupabase.code
    this.cause = erreurSupabase
    // Base trop lente : 503 explicite (le client peut réessayer), sinon 500 générique.
    this.delaiDepasse = estDelaiDepasse(erreurSupabase)
    this.statut = this.delaiDepasse ? 503 : 500
    this.expose = this.delaiDepasse
    if (this.delaiDepasse) {
      this.message = 'Base de données momentanément indisponible, réessayez dans quelques instants'
      this.details = {}
    }
  }
}

// Retourne data, ou lève une ErreurBase (500 générique ou 503 si délai dépassé).
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
// Nom de la colonne absente, extrait du message d'erreur :
//   PostgREST  PGRST204 « Could not find the 'x' column of 't' in the schema cache »
//   PostgreSQL 42703    « column t.x does not exist » / « column "x" of relation "t" does not exist »
const extraireColonneAbsente = (erreur) => {
  const message = (erreur && erreur.message) || ''
  const correspondance = message.match(/'([^']+)' column/) ||
    message.match(/column\s+"?(?:\w+\.)?(\w+)"?\s+(?:of relation\s+"?\w+"?\s+)?does not exist/i)
  return correspondance ? correspondance[1] : null
}

// Colonnes optionnelles constatées absentes, par table : elles ne sont plus
// envoyées (pas de requête vouée à l'échec). Redémarrer après une migration.
const colonnesAbsentesConnues = new Map()

const retirerColonnes = (ligne, colonnes) =>
  Object.fromEntries(Object.entries(ligne).filter(([colonne]) => !colonnes.has(colonne)))

// Insère une ligne en ignorant UNIQUEMENT les colonnes optionnelles absentes du
// schéma réel (les autres valeurs sont conservées). Retourne { data, error } ;
// l'appelant traite les autres erreurs (unicité…). options.retourner = false :
// insertion sans relecture de la ligne.
const insererAvecColonnesOptionnelles = async (client, table, ligne, colonnesOptionnelles = [], { retourner = true } = {}) => {
  if (!colonnesAbsentesConnues.has(table)) colonnesAbsentesConnues.set(table, new Set())
  const absentes = colonnesAbsentesConnues.get(table)
  let courante = retirerColonnes(ligne, absentes)
  let repliGlobalFait = false

  for (let essai = 0; essai <= colonnesOptionnelles.length + 1; essai++) {
    const requete = client.from(table).insert([courante])
    const resultat = retourner ? await requete.select().single() : await requete
    if (!resultat.error || !estColonneAbsente(resultat.error)) return resultat

    const colonne = extraireColonneAbsente(resultat.error)
    if (colonne && colonnesOptionnelles.includes(colonne) && colonne in courante) {
      absentes.add(colonne)
      logger.warn(`Table ${table} : colonne optionnelle « ${colonne} » absente du schéma, ignorée`)
      courante = retirerColonnes(courante, new Set([colonne]))
      continue
    }
    // Message non reconnu : repli unique sans aucune colonne optionnelle.
    if (!colonne && !repliGlobalFait && colonnesOptionnelles.some((nom) => nom in courante)) {
      repliGlobalFait = true
      logger.warn(`Table ${table} : colonne absente non identifiée, insertion sans les colonnes optionnelles`)
      courante = retirerColonnes(courante, new Set(colonnesOptionnelles))
      continue
    }
    return resultat // colonne indispensable absente : erreur remontée à l'appelant
  }
  return { data: null, error: { code: 'PGRST204', message: `Insertion impossible dans ${table} : colonnes absentes` } }
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
  estDelaiDepasse,
  donnees,
  estTableAbsente,
  estColonneAbsente,
  estViolationUnicite,
  estIncompatibiliteSchema,
  insererAvecColonnesOptionnelles,
  extraireColonneAbsente,
  paginer,
  executerSansEchec
}
