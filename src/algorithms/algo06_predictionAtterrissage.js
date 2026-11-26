'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 06 — Prédiction de destination avant l'atterrissage
//
// Sur les 24 derniers mois d'historique (minimum 3 voyages), pour chaque
// destination hors pays d'origine :
//   probabilité = 50 % fréquence + 30 % saisonnalité (mois ± 1, circulaire)
//               + 20 % jour de la semaine
// Suggestion proposée si probabilité ≥ 60 %. Le client confirme (déclaration)
// ou refuse (enregistrerSuggestionRefusee) : pas d'interaction bloquante.
// ════════════════════════════════════════════════════════════

const supabase = require('../supabase')
const { donnees } = require('../utils/db')
const { journaliserAudit } = require('../utils/audit')

const SEUIL_SUGGESTION = 0.60
const MOIS_HISTORIQUE = 24
const MINIMUM_VOYAGES = 3
const POIDS_FREQUENCE = 0.50
const POIDS_SAISON = 0.30
const POIDS_JOUR_SEMAINE = 0.20

const dateVoyage = (voyage) => voyage.arrival_detected_at || voyage.declaration_time || voyage.created_at || null

const extraireMois = (date) => new Date(date).getUTCMonth() + 1 // 1 (janvier) à 12 (décembre)

const extraireJourSemaine = (date) => {
  const jour = new Date(date).getUTCDay()
  return jour === 0 ? 7 : jour // 1 (lundi) à 7 (dimanche)
}

// Distance circulaire entre deux mois : décembre et janvier sont voisins.
const ecartMois = (mois1, mois2) => {
  const ecart = Math.abs(mois1 - mois2)
  return Math.min(ecart, 12 - ecart)
}

// Voyages des nbMois derniers mois : arrivée détectée OU déclaration manuelle.
const recupererHistoriqueVoyage = async (userId, nbMois = MOIS_HISTORIQUE, maintenant = new Date()) => {
  const dateLimite = new Date(maintenant)
  dateLimite.setUTCMonth(dateLimite.getUTCMonth() - nbMois)
  const limiteISO = dateLimite.toISOString()

  const voyages = donnees(
    await supabase
      .from('travel_history')
      .select('*')
      .eq('user_id', userId)
      .or(`arrival_detected_at.gte.${limiteISO},declaration_time.gte.${limiteISO}`)
      .order('arrival_detected_at', { ascending: false }),
    'lecture de l\'historique de voyage'
  )
  return (voyages || []).filter((voyage) => voyage.country_iso && dateVoyage(voyage))
}

const compterVoyagesParDestination = (historique, paysISO) =>
  historique.filter((voyage) => voyage.country_iso === paysISO).length

const calculerScoreFrequence = (nbVoyagesPays, nbVoyagesTotal) =>
  (nbVoyagesTotal === 0 ? 0 : nbVoyagesPays / nbVoyagesTotal)

const calculerScoreSaison = (historique, paysISO, moisActuel) => {
  const voyagesPays = historique.filter((voyage) => voyage.country_iso === paysISO)
  if (voyagesPays.length === 0) return 0
  const similaires = voyagesPays.filter((voyage) => ecartMois(extraireMois(dateVoyage(voyage)), moisActuel) <= 1).length
  return similaires / voyagesPays.length
}

const calculerScoreJourSemaine = (historique, paysISO, jourSemaine) => {
  const voyagesPays = historique.filter((voyage) => voyage.country_iso === paysISO)
  if (voyagesPays.length === 0) return 0
  const similaires = voyagesPays.filter((voyage) => extraireJourSemaine(dateVoyage(voyage)) === jourSemaine).length
  return similaires / voyagesPays.length
}

const calculerProbabiliteFinale = (scoreFrequence, scoreSaison, scoreJourSemaine) =>
  Math.min(1, scoreFrequence * POIDS_FREQUENCE + scoreSaison * POIDS_SAISON + scoreJourSemaine * POIDS_JOUR_SEMAINE)

const extraireDestinationsUniques = (historique) => [...new Set(historique.map((voyage) => voyage.country_iso))]

const trouverMeilleureDestination = (destinationsScorees) => destinationsScorees.reduce(
  (meilleure, courante) => (meilleure === null || courante.probabilite > meilleure.probabilite ? courante : meilleure),
  null
)

// Calcul pur (testable sans base).
const scorerDestinations = (historique, paysOrigine, maintenant = new Date()) => {
  const moisActuel = extraireMois(maintenant)
  const jourSemaine = extraireJourSemaine(maintenant)
  const nombreVoyages = historique.length

  return extraireDestinationsUniques(historique)
    .filter((paysISO) => paysISO !== paysOrigine)
    .map((paysISO) => {
      const scoreFrequence = calculerScoreFrequence(compterVoyagesParDestination(historique, paysISO), nombreVoyages)
      const scoreSaison = calculerScoreSaison(historique, paysISO, moisActuel)
      const scoreJourSemaine = calculerScoreJourSemaine(historique, paysISO, jourSemaine)
      return {
        pays: paysISO,
        nbVoyages: compterVoyagesParDestination(historique, paysISO),
        scoreFrequence,
        scoreSaison,
        scoreJourSemaine,
        probabilite: calculerProbabiliteFinale(scoreFrequence, scoreSaison, scoreJourSemaine)
      }
    })
    .sort((a, b) => b.probabilite - a.probabilite)
}

const enregistrerSuggestionRefusee = async (userId, paysISO) => journaliserAudit({
  userId,
  entite: 'PREDICTION',
  action: `SUGGESTION_REFUSEE_${paysISO}`,
  acteur: 'USER'
})

// ── Traitement principal ────────────────────────────────────
const predictionPreAtterrissage = async (userId, { paysOrigine = null, maintenant = new Date() } = {}) => {
  const historique = await recupererHistoriqueVoyage(userId, MOIS_HISTORIQUE, maintenant)

  if (historique.length < MINIMUM_VOYAGES) {
    return { suggestion: null, raison: 'HISTORIQUE_INSUFFISANT', totalVoyages: historique.length, minimumRequis: MINIMUM_VOYAGES }
  }

  const destinationsScorees = scorerDestinations(historique, paysOrigine, maintenant)
  const meilleure = trouverMeilleureDestination(destinationsScorees)

  if (!meilleure) {
    return { suggestion: null, raison: 'AUCUNE_DESTINATION', totalVoyages: historique.length, destinationsScorees }
  }
  if (meilleure.probabilite < SEUIL_SUGGESTION) {
    return { suggestion: null, raison: 'PROBABILITE_INSUFFISANTE', meilleure, totalVoyages: historique.length, destinationsScorees }
  }
  return { suggestion: meilleure, raison: 'SUGGESTION', totalVoyages: historique.length, destinationsScorees }
}

module.exports = {
  SEUIL_SUGGESTION,
  MINIMUM_VOYAGES,
  ecartMois,
  extraireMois,
  extraireJourSemaine,
  calculerScoreFrequence,
  calculerScoreSaison,
  calculerScoreJourSemaine,
  calculerProbabiliteFinale,
  scorerDestinations,
  recupererHistoriqueVoyage,
  enregistrerSuggestionRefusee,
  predictionPreAtterrissage
}
