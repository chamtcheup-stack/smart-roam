'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 15 — Attribution d'un numéro virtuel (DID) pour un pays
//
//   1. Numéro persistant déjà détenu par l'utilisateur :
//        PARKED / autre       → remis en attente d'arrivée
//        ACTIVE / en attente  → conservé tel quel
//        SUSPENDED (fraude)   → refus (le support doit lever la suspension)
//   2. Sinon, réservation ATOMIQUE du rang suivant dans un pool actif
//      (compare-and-swap sur allocated_count : deux requêtes simultanées
//      ne peuvent jamais obtenir le même numéro), puis création du numéro.
//   3. À 90 % d'occupation : commande de réapprovisionnement lancée
//      en arrière-plan (algo 19).
// ════════════════════════════════════════════════════════════

const supabase = require('../supabase')
const logger = require('../utils/logger')
const { conflit } = require('../utils/http')
const { donnees, estViolationUnicite, executerSansEchec, ErreurBase } = require('../utils/db')
const { decalerNumero, comparerNumeros } = require('../utils/numeros')
const { JITStockManager } = require('./algo19_jitStockManager')

const SEUIL_REAPPROVISIONNEMENT = 0.90
const STATUT_COMMANDE_REQUISE = 'REORDER_REQUIRED'
const STATUT_COMMANDE_EN_COURS = 'REORDER_PENDING'
const MAX_ESSAIS_RESERVATION = 5
const STATUTS_CONSERVES = new Set(['ACTIVE', 'AWAITING_ARRIVAL'])
const STATUT_SUSPENDU = 'SUSPENDED'

const chercherNumeroPersistant = async (userId, paysISO) => {
  const numeros = donnees(
    await supabase
      .from('virtual_number')
      .select('*')
      .eq('user_id', userId)
      .eq('country_iso', paysISO)
      .order('created_at', { ascending: false })
      .limit(1),
    'recherche du numéro persistant'
  )
  return (numeros && numeros[0]) || null
}

const relirePool = async (poolId) => donnees(
  await supabase.from('did_pool').select('*').eq('pool_id', poolId).maybeSingle(),
  'relecture du pool DID'
)

const chercherPoolDisponible = async (paysISO) => {
  const pools = donnees(
    await supabase.from('did_pool').select('*').eq('country_iso', paysISO).eq('status', 'ACTIVE'),
    'recherche du pool DID'
  )
  return (pools || []).find((pool) => pool.allocated_count < pool.total_numbers) || null
}

// Numéro de rang « rang » dans la plage du pool (largeur et « + » conservés).
// null si la plage est dépassée (range_end) ou le format invalide.
const calculerProchainNumero = (rangeStart, rang, rangeEnd = null) => {
  const numero = decalerNumero(rangeStart, rang)
  if (!numero) return null
  if (rangeEnd && comparerNumeros(numero, rangeEnd) > 0) return null
  return numero
}

const calculerTauxOccupation = (allocatedCount, totalNumbers) =>
  (totalNumbers > 0 ? allocatedCount / totalNumbers : 1)

// ── Procédures ──────────────────────────────────────────────
const reactiverNumeroPersistant = async (numero) => {
  if (numero.status === STATUT_SUSPENDU) {
    throw conflit('Votre numéro virtuel pour ce pays est suspendu par sécurité : contactez le support Orange')
  }
  if (STATUTS_CONSERVES.has(numero.status)) return numero

  const misAJour = donnees(
    await supabase
      .from('virtual_number')
      .update({ status: 'AWAITING_ARRIVAL' })
      .eq('number_id', numero.number_id)
      .select()
      .single(),
    'réactivation du numéro persistant'
  )
  logger.info('Numéro persistant réactivé', { numberId: numero.number_id })
  return misAJour
}

// Réserve un rang par compare-and-swap ; réessaie si un autre processus a modifié le pool.
const reserverRang = async (poolInitial) => {
  let pool = poolInitial
  for (let essai = 1; essai <= MAX_ESSAIS_RESERVATION; essai++) {
    if (!pool || pool.status !== 'ACTIVE' || pool.allocated_count >= pool.total_numbers) return null
    const rang = pool.allocated_count
    const misAJour = donnees(
      await supabase
        .from('did_pool')
        .update({ allocated_count: rang + 1 })
        .eq('pool_id', pool.pool_id)
        .eq('allocated_count', rang)
        .select(),
      'réservation d\'un numéro dans le pool'
    )
    if (Array.isArray(misAJour) && misAJour.length === 1) return { rang, pool: misAJour[0] }
    pool = await relirePool(pool.pool_id)
  }
  throw conflit('Forte demande sur ce pool de numéros : réessayez dans quelques instants')
}

// Rend un rang réservé mais inutilisé (seulement si personne n'a réservé depuis).
const libererRang = (pool, rang) => executerSansEchec(
  supabase.from('did_pool').update({ allocated_count: rang }).eq('pool_id', pool.pool_id).eq('allocated_count', rang + 1),
  'libération d\'un rang réservé'
)

const creerNouveauNumero = (userId, didNumber, paysISO, poolId) => supabase
  .from('virtual_number')
  .insert([{
    user_id: userId,
    did_number: didNumber,
    country_iso: paysISO,
    did_pool_id: poolId,
    status: 'AWAITING_ARRIVAL', // activated_at sera renseigné à l'arrivée (algo 01)
    is_permanent_owner: true
  }])
  .select()
  .single()

// Seuil de 90 % franchi : le pool est signalé (REORDER_REQUIRED = commande à
// passer) puis le JIT Stock Manager (algo 19) passe la commande au partenaire
// en arrière-plan (marquage atomique REORDER_PENDING : aucune double commande ;
// en cas d'échec, nouvel essai au prochain passage planifié). La déclaration
// du voyage n'attend pas la réponse du partenaire.
const reapprovisionnementsEnCours = new Set()

const declencherReapprovisionnement = async (pool) => {
  if (pool.reorder_status === STATUT_COMMANDE_EN_COURS) return
  if (pool.reorder_status !== STATUT_COMMANDE_REQUISE) {
    await executerSansEchec(
      supabase
        .from('did_pool')
        .update({ reorder_status: STATUT_COMMANDE_REQUISE })
        .eq('pool_id', pool.pool_id)
        .or(`reorder_status.is.null,reorder_status.neq.${STATUT_COMMANDE_EN_COURS}`),
      'signalement du stock critique'
    )
  }
  logger.warn('Stock DID critique : réapprovisionnement lancé', { poolId: pool.pool_id, paysISO: pool.country_iso })
  const analyse = JITStockManager({ paysISO: pool.country_iso })
    .catch((erreur) => logger.error('Réapprovisionnement automatique impossible', erreur))
    .finally(() => reapprovisionnementsEnCours.delete(analyse))
  reapprovisionnementsEnCours.add(analyse)
}

// Attend la fin des commandes lancées en arrière-plan (tests, arrêt propre).
const attendreReapprovisionnements = () => Promise.allSettled(reapprovisionnementsEnCours)

// ── Traitement principal ────────────────────────────────────
const attribuerNumeroDID = async (userId, paysISO) => {
  const numeroExistant = await chercherNumeroPersistant(userId, paysISO)
  if (numeroExistant) return reactiverNumeroPersistant(numeroExistant)

  let pool = await chercherPoolDisponible(paysISO)
  for (let essai = 1; pool && essai <= MAX_ESSAIS_RESERVATION; essai++) {
    const reservation = await reserverRang(pool)
    if (!reservation) break

    const didNumber = calculerProchainNumero(reservation.pool.range_start, reservation.rang, reservation.pool.range_end)
    if (!didNumber) {
      await libererRang(reservation.pool, reservation.rang)
      logger.error('Plage DID incohérente (range_start / range_end / total_numbers)', { poolId: reservation.pool.pool_id })
      return null
    }

    const { data, error } = await creerNouveauNumero(userId, didNumber, paysISO, reservation.pool.pool_id)
    if (!error) {
      if (calculerTauxOccupation(reservation.pool.allocated_count, reservation.pool.total_numbers) >= SEUIL_REAPPROVISIONNEMENT) {
        await declencherReapprovisionnement(reservation.pool)
      }
      return data
    }
    if (!estViolationUnicite(error)) {
      await libererRang(reservation.pool, reservation.rang)
      throw new ErreurBase('création du numéro virtuel', error)
    }
    // Numéro déjà présent (donnée historique) : rang suivant.
    logger.warn('Numéro DID déjà existant : passage au rang suivant', { poolId: reservation.pool.pool_id })
    pool = reservation.pool
  }

  logger.warn('Aucun numéro disponible', { paysISO })
  return null
}

module.exports = {
  STATUT_COMMANDE_REQUISE,
  attendreReapprovisionnements,
  attribuerNumeroDID,
  calculerProchainNumero,
  calculerTauxOccupation,
  chercherPoolDisponible,
  chercherNumeroPersistant,
  reserverRang
}
