'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 19 — JIT Stock Manager (réapprovisionnement des pools DID)
//
// Pour chaque pool actif : réapprovisionnement si occupation ≥ 90 %
// OU épuisement prévu sous 7 jours (rythme des 30 derniers jours).
// Quantité = 30 jours de besoin × 1,5 (minimum 10 000 numéros), commandée
// au meilleur partenaire MVNO. Le marquage REORDER_PENDING est atomique
// (pas de double commande) et annulé si la commande échoue.
// ════════════════════════════════════════════════════════════

const supabase = require('../supabase')
const logger = require('../utils/logger')
const { donnees, estTableAbsente, executerSansEchec, ErreurBase } = require('../utils/db')
const { decalerNumero } = require('../utils/numeros')

const SEUIL_OCCUPATION = 0.90
const SEUIL_JOURS = 7
const MARGE_SECURITE = 1.5
const QUANTITE_MINIMUM = 10000
const PERIODE_ANALYSE_JOURS = 30
const STATUT_COMMANDE = 'REORDER_PENDING'

// Intégration de l'API de commande partenaire à brancher : simulation explicite.
const appelerApiPartenaire = async (endpoint, commande) => {
  logger.warn('Commande de numéros simulée (API partenaire à brancher)', { endpoint: endpoint || null, quantite: commande.quantite })
  return { statut: 'ACCEPTEE', simulation: true }
}

// ── Lectures ────────────────────────────────────────────────
const lireTousLesPools = async (paysISO = null) => {
  let requete = supabase.from('did_pool').select('*').eq('status', 'ACTIVE')
  if (paysISO) requete = requete.eq('country_iso', paysISO)
  return donnees(await requete, 'lecture des pools DID') || []
}

const calculerTauxOccupation = (allocatedCount, totalNumbers) =>
  (totalNumbers > 0 ? allocatedCount / totalNumbers : 1)

// Numéros attribués par jour sur la période d'analyse.
const calculerTauxCroissance = async (paysISO, maintenant = new Date()) => {
  const dateLimite = new Date(maintenant.getTime() - PERIODE_ANALYSE_JOURS * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from('virtual_number')
    .select('*', { count: 'exact', head: true })
    .eq('country_iso', paysISO)
    .gte('created_at', dateLimite)
  if (error) throw new ErreurBase('calcul du rythme d\'attribution', error)
  return (count || 0) / PERIODE_ANALYSE_JOURS
}

const calculerJoursAvantEpuisement = (pool, tauxCroissance) => {
  const restants = Math.max(0, pool.total_numbers - pool.allocated_count)
  return tauxCroissance > 0 ? restants / tauxCroissance : Number.POSITIVE_INFINITY
}

const calculerQuantiteCommande = (tauxCroissance) =>
  Math.max(QUANTITE_MINIMUM, Math.round(tauxCroissance * PERIODE_ANALYSE_JOURS * MARGE_SECURITE))

const besoinReapprovisionnement = (tauxOccupation, joursAvantEpuisement) =>
  tauxOccupation >= SEUIL_OCCUPATION || joursAvantEpuisement <= SEUIL_JOURS

const chercherMeilleurPartenaire = async (paysISO) => {
  const { data, error } = await supabase
    .from('mvno_partner')
    .select('*')
    .eq('country_iso', paysISO)
    .eq('agreement_status', 'ACTIVE')
    .order('failover_priority', { ascending: true })
    .limit(1)
  if (error) {
    if (estTableAbsente(error)) return null
    throw new ErreurBase('recherche du partenaire MVNO', error)
  }
  return (data && data[0]) || null
}

// ── Procédures ──────────────────────────────────────────────
// Compare-and-swap : n'aboutit que si aucune commande n'est déjà en cours.
const marquerCommandeEnCours = async (pool) => {
  const misAJour = donnees(
    await supabase
      .from('did_pool')
      .update({ reorder_status: STATUT_COMMANDE })
      .eq('pool_id', pool.pool_id)
      .or(`reorder_status.is.null,reorder_status.neq.${STATUT_COMMANDE}`)
      .select('pool_id'),
    'marquage de la commande en cours'
  )
  return Array.isArray(misAJour) && misAJour.length === 1
}

const annulerMarquageCommande = (pool) => executerSansEchec(
  supabase.from('did_pool').update({ reorder_status: pool.reorder_status || null }).eq('pool_id', pool.pool_id),
  'annulation du marquage de commande'
)

const passerCommande = async (pool, partenaire, quantite, appelerApi = appelerApiPartenaire) => {
  const debut = decalerNumero(pool.range_end, 1)
  const reponse = await appelerApi(partenaire.api_endpoint || partenaire.sip_endpoint, {
    pays: pool.country_iso,
    quantite,
    debut
  })
  return Boolean(reponse) && reponse.statut === 'ACCEPTEE'
}

const notifierEquipeOrange = (pool, partenaire, quantite, tauxOccupation, joursRestants) => {
  logger.warn('ALERTE STOCK — réapprovisionnement commandé', {
    pays: pool.country_iso,
    occupation: `${Math.round(tauxOccupation * 100)} %`,
    joursRestants: Number.isFinite(joursRestants) ? Math.floor(joursRestants) : null,
    partenaire: partenaire.name,
    quantite
  })
}

// ── Traitement principal ────────────────────────────────────
const analyserPool = async (pool, { maintenant, appelerApi }) => {
  const tauxOccupation = calculerTauxOccupation(pool.allocated_count, pool.total_numbers)
  const tauxCroissance = await calculerTauxCroissance(pool.country_iso, maintenant)
  const joursAvantEpuisement = calculerJoursAvantEpuisement(pool, tauxCroissance)
  const base = {
    poolId: pool.pool_id,
    pays: pool.country_iso,
    tauxOccupation: Number(tauxOccupation.toFixed(3)),
    joursAvantEpuisement: Number.isFinite(joursAvantEpuisement) ? Math.floor(joursAvantEpuisement) : null
  }

  if (!besoinReapprovisionnement(tauxOccupation, joursAvantEpuisement)) return { ...base, action: 'OK' }
  if (pool.reorder_status === STATUT_COMMANDE) return { ...base, action: 'COMMANDE_DEJA_EN_COURS' }

  const partenaire = await chercherMeilleurPartenaire(pool.country_iso)
  if (!partenaire) {
    logger.error('Aucun partenaire MVNO pour réapprovisionner : intervention manuelle requise', { pays: pool.country_iso })
    return { ...base, action: 'AUCUN_PARTENAIRE' }
  }

  if (!(await marquerCommandeEnCours(pool))) return { ...base, action: 'COMMANDE_DEJA_EN_COURS' }

  const quantite = calculerQuantiteCommande(tauxCroissance)
  let acceptee = false
  try {
    acceptee = await passerCommande(pool, partenaire, quantite, appelerApi)
  } catch (erreur) {
    logger.error('Erreur lors de la commande au partenaire', erreur)
  }
  if (!acceptee) {
    await annulerMarquageCommande(pool)
    return { ...base, action: 'ECHEC_COMMANDE', partenaire: partenaire.name }
  }

  notifierEquipeOrange(pool, partenaire, quantite, tauxOccupation, joursAvantEpuisement)
  return { ...base, action: 'COMMANDE_PASSEE', partenaire: partenaire.name, quantite }
}

// paysISO (facultatif) : limite l'analyse aux pools d'un pays.
const JITStockManager = async ({ maintenant = new Date(), appelerApi = appelerApiPartenaire, paysISO = null } = {}) => {
  const pools = await lireTousLesPools(paysISO)
  const rapport = []
  for (const pool of pools) {
    try {
      rapport.push(await analyserPool(pool, { maintenant, appelerApi }))
    } catch (erreur) {
      logger.error('Analyse JIT impossible pour un pool', erreur)
      rapport.push({ poolId: pool.pool_id, pays: pool.country_iso, action: 'ERREUR' })
    }
  }
  logger.info('Analyse JIT Stock Manager terminée', { pools: pools.length })
  return rapport
}

module.exports = {
  SEUIL_OCCUPATION,
  SEUIL_JOURS,
  QUANTITE_MINIMUM,
  calculerTauxOccupation,
  calculerJoursAvantEpuisement,
  calculerQuantiteCommande,
  besoinReapprovisionnement,
  JITStockManager
}
