'use strict'

const supabase = require('../supabase')
const v = require('../utils/validation')
const { introuvable } = require('../utils/http')
const { donnees, paginer } = require('../utils/db')
const {
  predictionPreAtterrissage,
  enregistrerSuggestionRefusee
} = require('../algorithms/algo06_predictionAtterrissage')

const enPourcentage = (probabilite) => `${(probabilite * 100).toFixed(1)}%`

const MESSAGES_SANS_SUGGESTION = {
  HISTORIQUE_INSUFFISANT: 'Historique insuffisant pour prédire',
  PROBABILITE_INSUFFISANTE: 'Probabilité insuffisante pour suggérer',
  AUCUNE_DESTINATION: 'Aucune destination à suggérer'
}

// ════════════════════════════════════════════
// POST /api/prediction/suggest
// Suggérer une destination selon l'historique (algo 06)
// ════════════════════════════════════════════
const suggererDestination = async (req, res) => {
  const userId = v.identifiant(req.body.userId, 'userId')

  const utilisateur = donnees(
    await supabase.from('users').select('country_of_residence, deleted_at').eq('user_id', userId).maybeSingle(),
    'lecture du pays de résidence'
  )
  if (!utilisateur || utilisateur.deleted_at) throw introuvable('Utilisateur introuvable')

  const resultat = await predictionPreAtterrissage(userId, { paysOrigine: utilisateur.country_of_residence })

  if (!resultat.suggestion) {
    return res.status(200).json({
      message: MESSAGES_SANS_SUGGESTION[resultat.raison],
      suggestion: null,
      totalVoyages: resultat.totalVoyages,
      ...(resultat.minimumRequis ? { minimumRequis: resultat.minimumRequis } : {}),
      ...(resultat.meilleure ? { probabilite: enPourcentage(resultat.meilleure.probabilite) } : {})
    })
  }

  const { suggestion } = resultat
  const pays = donnees(
    await supabase.from('country').select('name_fr').eq('country_iso', suggestion.pays).maybeSingle(),
    'lecture du nom du pays'
  )

  return res.status(200).json({
    message: 'Destination suggérée',
    suggestion: {
      paysISO: suggestion.pays,
      nomPays: pays && pays.name_fr ? pays.name_fr : suggestion.pays,
      probabilite: enPourcentage(suggestion.probabilite),
      probabiliteValeur: Number(suggestion.probabilite.toFixed(4)),
      nbVoyages: suggestion.nbVoyages,
      scores: {
        frequence: Number(suggestion.scoreFrequence.toFixed(3)),
        saison: Number(suggestion.scoreSaison.toFixed(3)),
        jourSemaine: Number(suggestion.scoreJourSemaine.toFixed(3))
      }
    },
    totalVoyages: resultat.totalVoyages,
    instruction: 'Confirmez avec POST /api/declarations/new ou refusez avec POST /api/prediction/feedback'
  })
}

// ════════════════════════════════════════════
// GET /api/prediction/history/:userId
// ════════════════════════════════════════════
const getHistoriqueVoyages = async (req, res) => {
  const page = v.pagination(req.query)
  const { lignes, total } = await paginer(
    supabase
      .from('travel_history')
      .select('*', { count: 'exact' })
      .eq('user_id', req.params.userId)
      .order('arrival_detected_at', { ascending: false }),
    page,
    'lecture de l\'historique de voyage'
  )

  return res.status(200).json({ historique: lignes, total, ...page })
}

// ════════════════════════════════════════════
// POST /api/prediction/feedback
// Réponse de l'utilisateur à une suggestion : { paysISO, acceptee }
// ════════════════════════════════════════════
const enregistrerRetourSuggestion = async (req, res) => {
  v.exigerChamps(req.body, ['userId', 'paysISO', 'acceptee'])
  const userId = v.identifiant(req.body.userId, 'userId')
  const paysISO = v.paysISO(req.body.paysISO, 'paysISO')
  const acceptee = v.booleen(req.body.acceptee, 'acceptee')

  if (!acceptee) await enregistrerSuggestionRefusee(userId, paysISO)

  return res.status(200).json({
    message: acceptee
      ? 'Suggestion acceptée : confirmez votre voyage avec POST /api/declarations/new'
      : 'Suggestion refusée : elle sera prise en compte pour les prochaines prédictions',
    paysISO,
    acceptee
  })
}

module.exports = {
  suggererDestination,
  getHistoriqueVoyages,
  enregistrerRetourSuggestion
}
