'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 03 — Reconnaissance des SSID Wi-Fi d'aéroports
// Un SSID d'aéroport connu renforce la confiance de détection
// d'arrivée (bonus exact / approché par distance de Levenshtein).
// ════════════════════════════════════════════════════════════

const logger = require('../utils/logger')

const DISTANCE_MAX_FUZZY = 2 // distance maximale acceptée
const BONUS_MATCH_EXACT = 30 // bonus de confiance (match exact)
const BONUS_MATCH_FUZZY = 15 // bonus de confiance (match approché)
const LONGUEUR_MIN_SSID = 3
const LONGUEUR_MAX_SSID = 32 // 802.11 : 32 octets maximum
const SSIDS_NON_ANALYSABLES = new Set(['<HIDDEN>', 'HIDDEN'])

const BASE_SSIDS = Object.freeze([
  // AFRIQUE
  { ssid: 'AEROPORT_YDE_WIFI', iata: 'YDE', pays: 'CM' },
  { ssid: 'NSI_AIRPORT_FREE', iata: 'YDE', pays: 'CM' },
  { ssid: 'DLA_AIRPORT_WIFI', iata: 'DLA', pays: 'CM' },
  { ssid: 'ABIDJAN_AIRPORT', iata: 'ABJ', pays: 'CI' },
  { ssid: 'DAKAR_AIRPORT_WIFI', iata: 'DSS', pays: 'SN' },
  { ssid: 'LEOPOLD_WIFI', iata: 'DSS', pays: 'SN' },
  { ssid: 'BAMAKO_AIRPORT', iata: 'BKO', pays: 'ML' },
  { ssid: 'OUAGA_AERO_WIFI', iata: 'OUA', pays: 'BF' },
  { ssid: 'CONAKRY_AIRPORT', iata: 'CKY', pays: 'GN' },
  // EUROPE
  { ssid: 'CDG_WIFI', iata: 'CDG', pays: 'FR' },
  { ssid: 'PARIS_AIRPORT_FREE', iata: 'CDG', pays: 'FR' },
  { ssid: 'ORLY_AIRPORT_WIFI', iata: 'ORY', pays: 'FR' },
  { ssid: 'BRUSSELS_AIRPORT', iata: 'BRU', pays: 'BE' },
  { ssid: 'BRU_FREE_WIFI', iata: 'BRU', pays: 'BE' },
  { ssid: 'MADRID_BARAJAS_WIFI', iata: 'MAD', pays: 'ES' },
  { ssid: 'WARSAW_CHOPIN_WIFI', iata: 'WAW', pays: 'PL' },
  { ssid: 'BUCHAREST_AIRPORT', iata: 'OTP', pays: 'RO' },
  // MOYEN-ORIENT
  { ssid: 'AMMAN_AIRPORT_WIFI', iata: 'AMM', pays: 'JO' },
  { ssid: 'CAIRO_AIRPORT_FREE', iata: 'CAI', pays: 'EG' },
  // AMÉRIQUE
  { ssid: 'JFK_AIRPORT_WIFI', iata: 'JFK', pays: 'US' },
  { ssid: 'PEARSON_WIFI', iata: 'YYZ', pays: 'CA' }
].map((entree) => Object.freeze(entree)))

// Majuscules, espaces de début/fin supprimés, tirets et espaces → « _ ».
const normaliserSSID = (ssid) => String(ssid).trim().toUpperCase().replace(/[\s-]+/g, '_')

const BASE_NORMALISEE = BASE_SSIDS.map((entree) => ({ ...entree, ssidNormalise: normaliserSSID(entree.ssid) }))

const verifierSSIDValide = (ssid) => {
  if (typeof ssid !== 'string') return false
  const texte = ssid.trim()
  return texte.length >= LONGUEUR_MIN_SSID &&
    texte.length <= LONGUEUR_MAX_SSID &&
    !SSIDS_NON_ANALYSABLES.has(texte.toUpperCase())
}

// Distance de Levenshtein (insertion, suppression, substitution) en O(n·m)
// avec deux lignes de matrice seulement.
const calculerDistanceLevenshtein = (chaine1, chaine2) => {
  if (chaine1 === chaine2) return 0
  if (chaine1.length === 0) return chaine2.length
  if (chaine2.length === 0) return chaine1.length

  let lignePrecedente = Array.from({ length: chaine2.length + 1 }, (_, j) => j)
  for (let i = 1; i <= chaine1.length; i++) {
    const ligneCourante = [i]
    for (let j = 1; j <= chaine2.length; j++) {
      const coutSubstitution = chaine1[i - 1] === chaine2[j - 1] ? 0 : 1
      ligneCourante[j] = Math.min(
        lignePrecedente[j] + 1, // suppression
        ligneCourante[j - 1] + 1, // insertion
        lignePrecedente[j - 1] + coutSubstitution // substitution
      )
    }
    lignePrecedente = ligneCourante
  }
  return lignePrecedente[chaine2.length]
}

const rechercherMatchExact = (ssidNormalise, base = BASE_NORMALISEE) =>
  base.find((entree) => entree.ssidNormalise === ssidNormalise) || null

const rechercherMatchFuzzy = (ssidNormalise, base = BASE_NORMALISEE) => {
  let meilleure = null
  let distanceMin = DISTANCE_MAX_FUZZY + 1

  for (const entree of base) {
    // Une différence de longueur > distance max rend le match impossible.
    if (Math.abs(entree.ssidNormalise.length - ssidNormalise.length) > DISTANCE_MAX_FUZZY) continue
    const distance = calculerDistanceLevenshtein(ssidNormalise, entree.ssidNormalise)
    if (distance < distanceMin) {
      distanceMin = distance
      meilleure = entree
    }
  }
  return meilleure ? { entree: meilleure, distance: distanceMin } : null
}

const determinerBonusConfiance = (typeMatch) => {
  if (typeMatch === 'EXACT') return BONUS_MATCH_EXACT
  if (typeMatch === 'FUZZY') return BONUS_MATCH_FUZZY
  return 0
}

const resultatAucunMatch = (ssidValide) => ({
  matchTrouve: false,
  ssidValide,
  codeIATA: null,
  paysISO: null,
  bonusConfiance: 0,
  typeMatch: 'AUCUN'
})

const resultatMatch = (entree, typeMatch, distance = 0) => {
  const bonusConfiance = determinerBonusConfiance(typeMatch)
  logger.debug('Aéroport reconnu par SSID', { iata: entree.iata, pays: entree.pays, typeMatch, bonusConfiance })
  return {
    matchTrouve: true,
    ssidValide: true,
    codeIATA: entree.iata,
    paysISO: entree.pays,
    bonusConfiance,
    typeMatch,
    distance
  }
}

// ── Traitement principal ────────────────────────────────────
const reconnaissanceSSID = (ssidActuel) => {
  if (!verifierSSIDValide(ssidActuel)) return resultatAucunMatch(false)

  const ssidNormalise = normaliserSSID(ssidActuel)

  const exact = rechercherMatchExact(ssidNormalise)
  if (exact) return resultatMatch(exact, 'EXACT')

  const approche = rechercherMatchFuzzy(ssidNormalise)
  if (approche) return resultatMatch(approche.entree, 'FUZZY', approche.distance)

  return resultatAucunMatch(true)
}

module.exports = {
  reconnaissanceSSID,
  calculerDistanceLevenshtein,
  normaliserSSID,
  verifierSSIDValide,
  determinerBonusConfiance,
  rechercherMatchExact,
  rechercherMatchFuzzy,
  BASE_SSIDS
}
