'use strict'

const supabase = require('../supabase')
const v = require('../utils/validation')
const { introuvable, conflit, requeteInvalide } = require('../utils/http')
const { donnees, paginer } = require('../utils/db')
const { auditerRequete } = require('../utils/audit')
const { decalerNumero } = require('../utils/numeros')
const { JITStockManager, calculerTauxOccupation, QUANTITE_MINIMUM } = require('../algorithms/algo19_jitStockManager')

const QUANTITE_MAXIMUM = 10000000

const enrichirPool = (pool) => {
  const taux = calculerTauxOccupation(pool.allocated_count, pool.total_numbers)
  return {
    ...pool,
    tauxOccupation: `${(taux * 100).toFixed(1)}%`,
    tauxOccupationValeur: Number(taux.toFixed(4)),
    numerosDisponibles: Math.max(0, pool.total_numbers - pool.allocated_count)
  }
}

// ════════════════════════════════════════════
// GET /api/stock/pools   (ADMIN / SERVICE)
// ════════════════════════════════════════════
const getPools = async (req, res) => {
  const page = v.pagination(req.query)
  const { lignes, total } = await paginer(
    supabase.from('did_pool').select('*', { count: 'exact' }).eq('status', 'ACTIVE').order('country_iso', { ascending: true }),
    page,
    'lecture des pools DID'
  )

  return res.status(200).json({
    message: 'État des pools DID',
    pools: lignes.map(enrichirPool),
    total,
    ...page
  })
}

// ════════════════════════════════════════════
// POST /api/stock/check   (ADMIN / SERVICE)
// Analyse JIT des pools d'un pays (algo 19) : commande si nécessaire.
// ════════════════════════════════════════════
const verifierStock = async (req, res) => {
  const paysISO = v.paysISO(req.body.paysISO, 'paysISO')

  const rapport = await JITStockManager({ paysISO })
  if (rapport.length === 0) throw introuvable('Pool introuvable pour ce pays', { pays: paysISO })

  void auditerRequete(req, { entite: 'STOCK', action: `CONTROLE_STOCK_${paysISO}` })
  return res.status(200).json({
    message: 'Vérification stock terminée',
    paysISO,
    alerteRequise: rapport.some((ligne) => ligne.action !== 'OK'),
    pools: rapport
  })
}

// ════════════════════════════════════════════
// PUT /api/stock/reorder/:poolId   (ADMIN / SERVICE)
// Confirmer la livraison d'une commande de réapprovisionnement.
// ════════════════════════════════════════════
const confirmerReappro = async (req, res) => {
  const poolId = v.identifiant(req.params.poolId, 'poolId')
  const quantite = v.entier(req.body.quantite, 'quantite', { min: QUANTITE_MINIMUM, max: QUANTITE_MAXIMUM })

  const pool = donnees(
    await supabase.from('did_pool').select('*').eq('pool_id', poolId).maybeSingle(),
    'lecture du pool'
  )
  if (!pool) throw introuvable('Pool introuvable')
  if (pool.reorder_status !== 'REORDER_PENDING') {
    throw conflit('Aucune commande de réapprovisionnement en attente pour ce pool', { statutReappro: pool.reorder_status || null })
  }

  const miseAJour = { total_numbers: pool.total_numbers + quantite, reorder_status: 'REORDER_CONFIRMED' }
  if (pool.range_end) {
    const nouvelleFin = decalerNumero(pool.range_end, quantite)
    if (!nouvelleFin) throw requeteInvalide('La plage de numéros ne peut pas être étendue de cette quantité', { rangeEnd: pool.range_end })
    miseAJour.range_end = nouvelleFin
  }

  // Mise à jour conditionnelle : échoue si le pool a changé entre-temps.
  const lignes = donnees(
    await supabase
      .from('did_pool')
      .update(miseAJour)
      .eq('pool_id', poolId)
      .eq('total_numbers', pool.total_numbers)
      .eq('reorder_status', 'REORDER_PENDING')
      .select(),
    'confirmation du réapprovisionnement'
  ) || []
  if (lignes.length === 0) throw conflit('Le pool a été modifié entre-temps : réessayez')

  void auditerRequete(req, { entite: 'STOCK', action: `REAPPRO_CONFIRME_${poolId}_${quantite}` })
  return res.status(200).json({
    message: 'Réapprovisionnement confirmé',
    pool: enrichirPool(lignes[0]),
    numerosAjoutes: quantite,
    nouveauTotal: lignes[0].total_numbers
  })
}

// ════════════════════════════════════════════
// POST /api/stock/jit/run   (ADMIN / SERVICE)
// Exécution manuelle du JIT Stock Manager sur tous les pools.
// ════════════════════════════════════════════
const lancerJIT = async (req, res) => {
  const rapport = await JITStockManager()
  void auditerRequete(req, { entite: 'STOCK', action: 'JIT_MANUEL' })
  return res.status(200).json({
    message: 'Analyse JIT terminée',
    commandes: rapport.filter((ligne) => ligne.action === 'COMMANDE_PASSEE').length,
    rapport
  })
}

module.exports = {
  getPools,
  verifierStock,
  confirmerReappro,
  lancerJIT
}
