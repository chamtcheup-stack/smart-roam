'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 01 — Fusion multi-signaux (géofencing d'arrivée / de retour)
//
// À partir des signaux envoyés par l'application (MCC/MNC, Cell-ID,
// Wi-Fi, IP), scorés par l'algo 08 :
//   - arrivée dans le pays déclaré (score ≥ 70)  → numéro virtuel activé
//   - retour dans le pays d'origine (score ≥ 70) → mode parking
//   - score intermédiaire (50–69)                → attente d'un signal
//   - autre pays                                  → escale ignorée
// Le voyage actif est la dernière déclaration PENDING (arrivée attendue)
// ou CONFIRMED (voyageur sur place, retour attendu).
// ════════════════════════════════════════════════════════════

const supabase = require('../supabase')
const logger = require('../utils/logger')
const { donnees, executerSansEchec } = require('../utils/db')
const { journaliserAudit } = require('../utils/audit')
const {
  SEUIL_HAUTE,
  SEUIL_MOYENNE,
  normaliserSignaux,
  calculerScore,
  determinerPaysCandidat
} = require('./algo08_scoringConfiance')

const DUREE_ATTENTE_SECONDES = 5

const lireVoyageActif = async (userId) => donnees(
  await supabase
    .from('trip_declaration')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['PENDING', 'CONFIRMED'])
    .order('declaration_time', { ascending: false })
    .limit(1)
    .maybeSingle(),
  'lecture du voyage actif'
)

const lirePaysOrigine = async (userId) => {
  const utilisateur = donnees(
    await supabase.from('users').select('country_of_residence').eq('user_id', userId).maybeSingle(),
    'lecture du pays d\'origine'
  )
  return utilisateur ? utilisateur.country_of_residence : null
}

// ── Procédures ──────────────────────────────────────────────
const activerNumeroVirtuel = async (userId, paysDestination) => {
  const maintenant = new Date().toISOString()

  donnees(
    await supabase
      .from('trip_declaration')
      .update({ status: 'CONFIRMED', arrival_confirmed_at: maintenant })
      .eq('user_id', userId)
      .eq('destination_country', paysDestination)
      .eq('status', 'PENDING'),
    'confirmation de l\'arrivée'
  )

  const numeros = donnees(
    await supabase
      .from('virtual_number')
      .update({ status: 'ACTIVE', activated_at: maintenant })
      .eq('user_id', userId)
      .eq('country_iso', paysDestination)
      .eq('status', 'AWAITING_ARRIVAL')
      .select('number_id'),
    'activation du numéro virtuel'
  )

  // Historique : date d'arrivée réelle (alimente la prédiction, algo 06).
  await executerSansEchec(
    supabase
      .from('travel_history')
      .update({ arrival_detected_at: maintenant, detection_method: 'AUTO' })
      .eq('user_id', userId)
      .eq('country_iso', paysDestination)
      .is('arrival_detected_at', null),
    'historique d\'arrivée'
  )

  logger.info('Arrivée confirmée : numéro virtuel activé', { userId, paysDestination, numeros: (numeros || []).length })
  return (numeros || []).length
}

const activerModeParking = async (userId, paysOrigine) => {
  const maintenant = new Date().toISOString()

  const numeros = donnees(
    await supabase
      .from('virtual_number')
      .update({ status: 'PARKED' })
      .eq('user_id', userId)
      .eq('status', 'ACTIVE')
      .neq('country_iso', paysOrigine)
      .select('number_id'),
    'mise en parking des numéros'
  )

  donnees(
    await supabase
      .from('trip_declaration')
      .update({ status: 'COMPLETED', return_confirmed_at: maintenant })
      .eq('user_id', userId)
      .eq('status', 'CONFIRMED'),
    'clôture du voyage'
  )

  logger.info('Retour détecté : mode parking activé', { userId, numeros: (numeros || []).length })
  return (numeros || []).length
}

// ── Traitement principal ────────────────────────────────────
const fusionMultiSignaux = async (userId, signaux) => {
  const voyage = await lireVoyageActif(userId)
  if (!voyage) {
    return { decision: 'SURVEILLANCE', raison: 'AUCUN_VOYAGE_ACTIF', scoreConfiance: 0 }
  }

  const paysDestination = voyage.destination_country
  const paysOrigine = await lirePaysOrigine(userId)
  const signauxNormalises = normaliserSignaux(signaux)
  const paysDetecte = determinerPaysCandidat(signauxNormalises)

  const scoreDestination = calculerScore(signauxNormalises, paysDestination)
  const scoreOrigine = paysOrigine ? calculerScore(signauxNormalises, paysOrigine) : { scoreFinal: 0 }
  const enVoyage = voyage.status === 'CONFIRMED'

  const contexte = { paysDestination, paysOrigine, paysDetecte, statutVoyage: voyage.status }
  const journaliser = (decision, score) => void journaliserAudit({
    userId,
    entite: 'GEOFENCING',
    action: `${decision}_SCORE_${score}_PAYS_${paysDetecte || 'INCONNU'}`
  })

  // 1. Arrivée dans le pays déclaré
  if (!enVoyage && paysDetecte === paysDestination && scoreDestination.scoreFinal >= SEUIL_HAUTE) {
    const numerosActives = await activerNumeroVirtuel(userId, paysDestination)
    journaliser('ARRIVEE_CONFIRMEE', scoreDestination.scoreFinal)
    return { decision: 'ARRIVEE_CONFIRMEE', scoreConfiance: scoreDestination.scoreFinal, numerosActives, ...contexte }
  }

  // 2. Retour dans le pays d'origine
  if (enVoyage && paysOrigine && paysDetecte === paysOrigine && scoreOrigine.scoreFinal >= SEUIL_HAUTE) {
    const numerosParkes = await activerModeParking(userId, paysOrigine)
    journaliser('RETOUR_DETECTE', scoreOrigine.scoreFinal)
    return { decision: 'RETOUR_DETECTE', scoreConfiance: scoreOrigine.scoreFinal, numerosParkes, ...contexte }
  }

  // Voyageur déjà arrivé qui renvoie des signaux depuis la destination
  if (enVoyage && paysDetecte === paysDestination && scoreDestination.scoreFinal >= SEUIL_HAUTE) {
    return { decision: 'DEJA_SUR_PLACE', scoreConfiance: scoreDestination.scoreFinal, ...contexte }
  }

  const scorePertinent = Math.max(scoreDestination.scoreFinal, scoreOrigine.scoreFinal)

  // 3. Score intermédiaire : le client renvoie ses signaux quelques secondes plus tard
  if (scorePertinent >= SEUIL_MOYENNE && scorePertinent < SEUIL_HAUTE) {
    return { decision: 'ATTENTE_SIGNAL_SUPPLEMENTAIRE', scoreConfiance: scorePertinent, reessayerDansSecondes: DUREE_ATTENTE_SECONDES, ...contexte }
  }

  // 4. Pays sans rapport avec le voyage (escale probable)
  if (paysDetecte && paysDetecte !== paysDestination && paysDetecte !== paysOrigine) {
    logger.debug('Signal ignoré : pays non pertinent (escale probable)', { userId, paysDetecte })
    return { decision: 'ESCALE_IGNOREE', scoreConfiance: scorePertinent, ...contexte }
  }

  // 5. Score trop faible
  return { decision: 'SCORE_INSUFFISANT', scoreConfiance: scorePertinent, ...contexte }
}

module.exports = {
  fusionMultiSignaux,
  lireVoyageActif,
  activerNumeroVirtuel,
  activerModeParking
}
