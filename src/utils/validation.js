'use strict'

// ════════════════════════════════════════════════════════════
// Validation et normalisation des entrées.
// Chaque validateur retourne la valeur normalisée ou lève une
// HttpError 400 explicite. Option { optionnel: true } : retourne
// options.defaut (undefined par défaut) si la valeur est absente.
// ════════════════════════════════════════════════════════════

const { HttpError } = require('./http')

const estAbsent = (valeur) => valeur === undefined || valeur === null ||
  (typeof valeur === 'string' && valeur.trim() === '')

const invalide = (champ, message, details = {}) => new HttpError(400, message, { champ, ...details })

const exigerChamps = (source, champs) => {
  const manquants = champs.filter((champ) => estAbsent(source && source[champ]))
  if (manquants.length > 0) {
    throw new HttpError(400, 'Champs manquants', { requis: champs, manquants })
  }
}

const validateur = (verifier) => (valeur, champ, options = {}) => {
  if (estAbsent(valeur)) {
    if (options.optionnel) return options.defaut
    throw invalide(champ, `Champ obligatoire manquant : ${champ}`)
  }
  return verifier(valeur, champ, options)
}

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REGEX_ENTIER_POSITIF = /^[1-9]\d{0,18}$/

// Identifiant de ligne : UUID ou entier positif (le schéma n'impose pas l'un ou l'autre).
const identifiant = validateur((valeur, champ) => {
  const texte = String(valeur).trim()
  if (REGEX_UUID.test(texte) || REGEX_ENTIER_POSITIF.test(texte)) return texte
  throw invalide(champ, `${champ} doit être un identifiant valide (UUID ou entier positif)`)
})

const paysISO = validateur((valeur, champ) => {
  const texte = typeof valeur === 'string' ? valeur.trim().toUpperCase() : ''
  if (!/^[A-Z]{2}$/.test(texte)) {
    throw invalide(champ, `${champ} doit être un code pays ISO 3166-1 alpha-2 (ex. FR, CM)`)
  }
  return texte
})

const devise = validateur((valeur, champ) => {
  const texte = typeof valeur === 'string' ? valeur.trim().toUpperCase() : ''
  if (!/^[A-Z]{3}$/.test(texte)) {
    throw invalide(champ, `${champ} doit être un code devise ISO 4217 (ex. XAF, EUR)`)
  }
  return texte
})

// Numéro de téléphone normalisé au format E.164 (+ suivi de 7 à 15 chiffres).
const telephone = validateur((valeur, champ) => {
  if (typeof valeur !== 'string' && typeof valeur !== 'number') {
    throw invalide(champ, `${champ} doit être un numéro de téléphone`)
  }
  let texte = String(valeur).replace(/[\s.\-()]/g, '')
  if (texte.startsWith('00')) texte = `+${texte.slice(2)}`
  if (!texte.startsWith('+')) texte = `+${texte}`
  if (!/^\+[1-9]\d{6,14}$/.test(texte)) {
    throw invalide(champ, `${champ} doit être au format international E.164 (ex. +237699123456)`)
  }
  return texte
})

// Variantes de stockage possibles d'un numéro (avec ou sans « + ») pour les recherches.
const variantesTelephone = (numeroE164) => [numeroE164, numeroE164.replace(/^\+/, '')]

const REGEX_DATE_ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/

const date = validateur((valeur, champ) => {
  const texte = typeof valeur === 'string' ? valeur.trim() : ''
  const horodatage = Date.parse(texte)
  if (!REGEX_DATE_ISO.test(texte) || Number.isNaN(horodatage)) {
    throw invalide(champ, `${champ} doit être une date ISO 8601 (AAAA-MM-JJ)`)
  }
  // Refuser les dates normalisées silencieusement (ex. 2025-02-31 → 3 mars).
  if (new Date(`${texte.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== texte.slice(0, 10)) {
    throw invalide(champ, `${champ} n'est pas une date calendaire valide`)
  }
  return texte
})

const nombreDepuis = (valeur) => {
  if (typeof valeur === 'number') return valeur
  if (typeof valeur === 'string' && /^-?\d+(\.\d+)?$/.test(valeur.trim())) return Number(valeur)
  return Number.NaN
}

const montant = validateur((valeur, champ, { max = Number.MAX_SAFE_INTEGER } = {}) => {
  const nombre = nombreDepuis(valeur)
  if (!Number.isFinite(nombre) || nombre <= 0 || nombre > max) {
    throw invalide(champ, `${champ} doit être un nombre strictement positif`)
  }
  return nombre
})

const entier = validateur((valeur, champ, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const nombre = nombreDepuis(valeur)
  if (!Number.isSafeInteger(nombre) || nombre < min || nombre > max) {
    throw invalide(champ, `${champ} doit être un entier compris entre ${min} et ${max}`)
  }
  return nombre
})

const booleen = validateur((valeur, champ) => {
  if (valeur === true || valeur === 'true') return true
  if (valeur === false || valeur === 'false') return false
  throw invalide(champ, `${champ} doit être un booléen (true ou false)`)
})

const enumeration = validateur((valeur, champ, { valeurs, message }) => {
  const texte = typeof valeur === 'string' ? valeur.trim().toUpperCase() : valeur
  if (!valeurs.includes(texte)) {
    throw invalide(champ, message || `${champ} invalide`, { valides: valeurs })
  }
  return texte
})

const chaine = validateur((valeur, champ, { min = 1, max = 255 } = {}) => {
  if (typeof valeur !== 'string') throw invalide(champ, `${champ} doit être une chaîne de caractères`)
  const texte = valeur.trim()
  if (texte.length < min || texte.length > max) {
    throw invalide(champ, `${champ} doit contenir entre ${min} et ${max} caractères`)
  }
  return texte
})

const pin = validateur((valeur, champ) => {
  if (typeof valeur !== 'string' || !/^\d{4}$/.test(valeur)) {
    throw invalide(champ, `${champ} doit être une chaîne de exactement 4 chiffres`)
  }
  return valeur
})

// Pagination des listes : ?limit= (1–200, défaut 50) & ?offset= (défaut 0).
const LIMITE_DEFAUT = 50
const LIMITE_MAX = 200
const pagination = (query = {}) => ({
  limit: entier(query.limit, 'limit', { optionnel: true, defaut: LIMITE_DEFAUT, min: 1, max: LIMITE_MAX }),
  offset: entier(query.offset, 'offset', { optionnel: true, defaut: 0, min: 0, max: 1000000 })
})

module.exports = {
  pagination,
  estAbsent,
  exigerChamps,
  identifiant,
  paysISO,
  devise,
  telephone,
  variantesTelephone,
  date,
  montant,
  entier,
  booleen,
  enumeration,
  chaine,
  pin
}
