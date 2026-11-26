'use strict'

// ════════════════════════════════════════════════════════════
// Base de données en mémoire imitant le client Supabase (sous-ensemble
// de PostgREST) : tables, filtres, insert/update/delete/upsert,
// single/maybeSingle, count/head, order/limit/range, or().
//
// Utilisée par le MODE DÉMO (aucune base réelle) et par les tests.
// Fidélité au schéma (facultative) : une colonne inconnue est refusée
// avec les codes d'erreur de PostgREST (42703 / PGRST204).
// ════════════════════════════════════════════════════════════

const crypto = require('crypto')

const CLES_PRIMAIRES = Object.freeze({
  users: 'user_id',
  virtual_number: 'number_id',
  forwarding_rule: 'rule_id',
  trip_declaration: 'declaration_id',
  did_pool: 'pool_id',
  esim_profile: 'esim_id',
  currency_transaction: 'transaction_id',
  currency_exchange_corridor: 'corridor_id',
  data_sovereignty_consent: 'consent_id',
  fraud_profile: 'profile_id',
  fraud_alert: 'alert_id',
  travel_history: 'history_id',
  audit_log: 'log_id',
  session: 'session_id',
  mvno_partner: 'partner_id',
  device: 'device_id_pk',
  country: 'country_iso'
})

const estDateISO = (valeur) => typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valeur) && !Number.isNaN(Date.parse(valeur))

const normaliser = (valeur) => {
  if (valeur instanceof Date) return valeur.getTime()
  if (estDateISO(valeur)) return Date.parse(valeur)
  if (typeof valeur === 'number') return valeur
  if (typeof valeur === 'string' && valeur.trim() !== '' && !Number.isNaN(Number(valeur))) return Number(valeur)
  return valeur
}

const estNul = (valeur) => valeur === null || valeur === undefined

const egal = (a, b) => {
  if (estNul(a) || estNul(b)) return estNul(a) && estNul(b)
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b)
  return String(a) === String(b) || normaliser(a) === normaliser(b)
}

const comparer = (a, b) => {
  const na = normaliser(a)
  const nb = normaliser(b)
  if (na === nb) return 0
  if (estNul(na)) return -1
  if (estNul(nb)) return 1
  return na < nb ? -1 : 1
}

const vers = (valeur) => (valeur instanceof Date ? valeur.toISOString() : valeur)

// schemas (facultatif) : { table: [colonnes] } → une colonne inconnue renvoie
// l'erreur PostgreSQL 42703 (lecture, filtre) ou PGRST204 (écriture).
// contraintesUniques : { table: [colonnes] } → violation = erreur 23505.
// journaliser : conserve la trace des requêtes (tests) ; désactivé en démo
// (un serveur de démonstration ne doit pas accumuler de mémoire).
const creerBaseMemoire = (tablesInitiales = {}, { contraintesUniques = {}, schemas = {}, journaliser = true } = {}) => {
  const tables = {}
  const erreursForcees = new Map()
  const journal = []

  const table = (nom) => {
    if (!tables[nom]) tables[nom] = []
    return tables[nom]
  }
  for (const [nom, lignes] of Object.entries(tablesInitiales)) tables[nom] = lignes.map((ligne) => ({ ...ligne }))

  const filtreDepuisExpression = (expression) => {
    // Format PostgREST simple : "col.op.valeur" (op : eq, neq, gt, gte, lt, lte, is)
    const [colonne, operateur, ...reste] = expression.split('.')
    const valeur = reste.join('.')
    const v = valeur === 'null' ? null : valeur
    switch (operateur) {
      case 'eq': return (l) => egal(l[colonne], v)
      case 'neq': return (l) => !egal(l[colonne], v)
      case 'gt': return (l) => l[colonne] != null && comparer(l[colonne], v) > 0
      case 'gte': return (l) => l[colonne] != null && comparer(l[colonne], v) >= 0
      case 'lt': return (l) => l[colonne] != null && comparer(l[colonne], v) < 0
      case 'lte': return (l) => l[colonne] != null && comparer(l[colonne], v) <= 0
      case 'is': return (l) => (v === null ? l[colonne] == null : String(l[colonne]) === v)
      default: throw new Error(`Opérateur or() non supporté : ${operateur}`)
    }
  }

  class Requete {
    constructor (nomTable) {
      this.nomTable = nomTable
      this.operation = 'select'
      this.filtres = []
      this.optionsSelect = {}
      this.retourLignes = false
      this.unique = null
      this.ordres = []
      this.limite = null
      this.plage = null
      this.valeurs = null
      this.optionsUpsert = {}
      this.colonnesUtilisees = new Set() // filtres et tris
    }

    select (colonnes = '*', options = {}) {
      if (this.operation === 'select') {
        this.optionsSelect = options
        this.colonnesDemandees = colonnes
      } else {
        this.retourLignes = true
      }
      return this
    }

    insert (lignes) { this.operation = 'insert'; this.valeurs = Array.isArray(lignes) ? lignes : [lignes]; return this }
    upsert (lignes, options = {}) { this.operation = 'upsert'; this.valeurs = Array.isArray(lignes) ? lignes : [lignes]; this.optionsUpsert = options; return this }
    update (patch) { this.operation = 'update'; this.valeurs = patch; return this }
    delete () { this.operation = 'delete'; return this }

    eq (c, v) { this.colonnesUtilisees.add(c); this.filtres.push((l) => egal(l[c], v)); return this }
    neq (c, v) { this.colonnesUtilisees.add(c); this.filtres.push((l) => !egal(l[c], v)); return this }
    gt (c, v) { this.colonnesUtilisees.add(c); this.filtres.push((l) => l[c] != null && comparer(l[c], vers(v)) > 0); return this }
    gte (c, v) { this.colonnesUtilisees.add(c); this.filtres.push((l) => l[c] != null && comparer(l[c], vers(v)) >= 0); return this }
    lt (c, v) { this.colonnesUtilisees.add(c); this.filtres.push((l) => l[c] != null && comparer(l[c], vers(v)) < 0); return this }
    lte (c, v) { this.colonnesUtilisees.add(c); this.filtres.push((l) => l[c] != null && comparer(l[c], vers(v)) <= 0); return this }
    in (c, valeurs) { this.colonnesUtilisees.add(c); this.filtres.push((l) => valeurs.some((v) => egal(l[c], v))); return this }
    is (c, v) { this.colonnesUtilisees.add(c); this.filtres.push((l) => (v === null ? l[c] == null : l[c] === v)); return this }
    not (c, operateur, v) {
      this.colonnesUtilisees.add(c)
      if (operateur === 'is') this.filtres.push((l) => !(v === null ? l[c] == null : l[c] === v))
      else if (operateur === 'eq') this.filtres.push((l) => !egal(l[c], v))
      else if (operateur === 'in') {
        const valeurs = String(v).replace(/^\(|\)$/g, '').split(',').map((x) => x.trim().replace(/^"|"$/g, ''))
        this.filtres.push((l) => !valeurs.some((x) => egal(l[c], x)))
      } else throw new Error(`not(${operateur}) non supporté`)
      return this
    }

    like (c, motif) { return this.ilike(c, motif, false) }
    ilike (c, motif, insensible = true) {
      this.colonnesUtilisees.add(c)
      const regex = new RegExp(`^${String(motif).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, insensible ? 'i' : '')
      this.filtres.push((l) => l[c] != null && regex.test(String(l[c])))
      return this
    }

    or (expression) {
      for (const partie of expression.split(',')) this.colonnesUtilisees.add(partie.split('.')[0])
      const sousFiltres = expression.split(',').map(filtreDepuisExpression)
      this.filtres.push((l) => sousFiltres.some((f) => f(l)))
      return this
    }

    // Comme PostgreSQL : NULL en dernier en ordre croissant, en premier en décroissant.
    order (c, { ascending = true, nullsFirst } = {}) {
      this.colonnesUtilisees.add(c)
      this.ordres.push({ c, ascending, nullsFirst: nullsFirst === undefined ? !ascending : Boolean(nullsFirst) })
      return this
    }

    limit (n) { this.limite = n; return this }
    range (debut, fin) { this.plage = [debut, fin]; return this }
    single () { this.unique = 'single'; return this }
    maybeSingle () { this.unique = 'maybe'; return this }
    retry () { return this } // compatibilité postgrest-js (aucune nouvelle tentative en mémoire)

    // Requête « thenable » comme celles de postgrest-js : await supabase.from(…)…
    // eslint-disable-next-line unicorn/no-thenable
    then (resolve, reject) {
      try {
        resolve(this.executer())
      } catch (erreur) {
        reject(erreur)
      }
    }

    correspondances () {
      return table(this.nomTable).filter((ligne) => this.filtres.every((f) => f(ligne)))
    }

    finaliser (lignes, count) {
      if (this.unique === 'single') {
        if (lignes.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, count }
        return { data: { ...lignes[0] }, error: null, count }
      }
      if (this.unique === 'maybe') {
        if (lignes.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' }, count }
        return { data: lignes[0] ? { ...lignes[0] } : null, error: null, count }
      }
      return { data: lignes.map((l) => ({ ...l })), error: null, count }
    }

    verifierUnicite (ligne, ignorer) {
      for (const colonne of contraintesUniques[this.nomTable] || []) {
        const doublon = table(this.nomTable).find((autre) => autre !== ignorer && ligne[colonne] != null && egal(autre[colonne], ligne[colonne]))
        if (doublon) return { code: '23505', message: `duplicate key value violates unique constraint (${colonne})=(${ligne[colonne]})` }
      }
      return null
    }

    // Erreur PostgREST pour une colonne inconnue du schéma déclaré (si déclaré).
    verifierColonnes () {
      const connues = schemas[this.nomTable]
      if (!connues) return null
      const inconnue = [...this.colonnesUtilisees].find((c) => !connues.includes(c))
      if (inconnue) return { code: '42703', message: `column ${this.nomTable}.${inconnue} does not exist` }
      const ecrites = this.operation === 'update'
        ? Object.keys(this.valeurs || {})
        : (this.operation === 'insert' || this.operation === 'upsert') ? this.valeurs.flatMap((ligne) => Object.keys(ligne)) : []
      const absente = ecrites.find((c) => !connues.includes(c))
      if (absente) return { code: 'PGRST204', message: `Could not find the '${absente}' column of '${this.nomTable}' in the schema cache` }
      return null
    }

    trier (lignes) {
      let triees = lignes
      for (const { c, ascending, nullsFirst } of [...this.ordres].reverse()) {
        triees = [...triees].sort((a, b) => {
          const nulA = estNul(a[c])
          const nulB = estNul(b[c])
          if (nulA || nulB) {
            if (nulA && nulB) return 0
            return (nulA ? -1 : 1) * (nullsFirst ? 1 : -1)
          }
          return comparer(a[c], b[c]) * (ascending ? 1 : -1)
        })
      }
      return triees
    }

    executer () {
      if (journaliser) journal.push({ table: this.nomTable, operation: this.operation })
      const forcee = erreursForcees.get(this.nomTable)
      const erreurSchema = !forcee && this.verifierColonnes()
      if (erreurSchema) return { data: null, error: erreurSchema, count: null }
      if (forcee && (!forcee.operations || forcee.operations.includes(this.operation))) {
        return { data: null, error: { ...forcee.erreur }, count: null }
      }

      const cle = CLES_PRIMAIRES[this.nomTable] || 'id'

      if (this.operation === 'select') {
        const connues = schemas[this.nomTable]
        if (connues && this.colonnesDemandees && this.colonnesDemandees !== '*') {
          const inconnue = this.colonnesDemandees.split(',').map((c) => c.trim()).find((c) => c && !connues.includes(c))
          if (inconnue) return { data: null, error: { code: '42703', message: `column ${this.nomTable}.${inconnue} does not exist` }, count: null }
        }
        let lignes = this.trier(this.correspondances())
        const count = this.optionsSelect.count ? lignes.length : null
        if (this.plage) lignes = lignes.slice(this.plage[0], this.plage[1] + 1)
        if (this.limite !== null) lignes = lignes.slice(0, this.limite)
        if (this.optionsSelect.head) return { data: null, error: null, count }
        return this.finaliser(lignes, count)
      }

      if (this.operation === 'insert' || this.operation === 'upsert') {
        const resultats = []
        for (const brute of this.valeurs) {
          const ligne = Object.fromEntries(Object.entries(brute).map(([k, v]) => [k, vers(v)]))
          if (this.operation === 'upsert') {
            const colonnes = (this.optionsUpsert.onConflict || cle).split(',').map((c) => c.trim())
            const existante = table(this.nomTable).find((l) => colonnes.every((c) => egal(l[c], ligne[c])))
            if (existante) {
              Object.assign(existante, ligne)
              resultats.push(existante)
              continue
            }
          }
          if (ligne[cle] === undefined) ligne[cle] = crypto.randomUUID()
          const avecDate = !schemas[this.nomTable] || schemas[this.nomTable].includes('created_at')
          if (avecDate && ligne.created_at === undefined) ligne.created_at = new Date().toISOString()
          const erreur = this.verifierUnicite(ligne)
          if (erreur) return { data: null, error: erreur, count: null }
          table(this.nomTable).push(ligne)
          resultats.push(ligne)
        }
        return this.retourLignes ? this.finaliser(resultats, null) : { data: null, error: null, count: null }
      }

      if (this.operation === 'update') {
        const lignes = this.correspondances()
        const patch = Object.fromEntries(Object.entries(this.valeurs).map(([k, v]) => [k, vers(v)]))
        for (const ligne of lignes) {
          const erreur = this.verifierUnicite({ ...ligne, ...patch }, ligne)
          if (erreur) return { data: null, error: erreur, count: null }
        }
        for (const ligne of lignes) Object.assign(ligne, patch)
        return this.retourLignes ? this.finaliser(lignes, null) : { data: null, error: null, count: null }
      }

      if (this.operation === 'delete') {
        const lignes = this.correspondances()
        tables[this.nomTable] = table(this.nomTable).filter((l) => !lignes.includes(l))
        return this.retourLignes ? this.finaliser(lignes, null) : { data: null, error: null, count: null }
      }

      throw new Error(`Opération inconnue : ${this.operation}`)
    }
  }

  return {
    from: (nomTable) => new Requete(nomTable),
    tables,
    journal,
    table,
    forcerErreur: (nomTable, erreur, operations = null) => erreursForcees.set(nomTable, { erreur, operations }),
    retirerErreur: (nomTable) => erreursForcees.delete(nomTable),
    // Remplace tout le contenu de la base (copie profonde) : isolation entre tests,
    // réinitialisation du mode démo.
    reinitialiser: (nouvellesTables = {}) => {
      for (const nom of Object.keys(tables)) delete tables[nom]
      for (const [nom, lignes] of Object.entries(structuredClone(nouvellesTables))) tables[nom] = lignes
      erreursForcees.clear()
      journal.length = 0
    }
  }
}

module.exports = { creerBaseMemoire, CLES_PRIMAIRES }
