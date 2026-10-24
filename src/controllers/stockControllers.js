const supabase = require('../supabase')

// ════════════════════════════════════════════
// GET /api/stock/pools
// Voir l'état de tous les pools DID
// ════════════════════════════════════════════
const getPools = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('did_pool')
      .select('*')
      .eq('status', 'ACTIVE')

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur lecture pools',
        detail : error.message
      })
    }

    // Calculer le taux d'occupation pour chaque pool
    const poolsAvecTaux = data.map(pool => ({
      ...pool,
      tauxOccupation : pool.total_numbers > 0
        ? parseFloat(
            ((pool.allocated_count / pool.total_numbers) * 100)
            .toFixed(1)
          ) + '%'
        : '0%',
      numerosDisponibles : pool.total_numbers - pool.allocated_count
    }))

    return res.status(200).json({
      message : 'État des pools DID',
      pools   : poolsAvecTaux,
      total   : poolsAvecTaux.length
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// POST /api/stock/check
// Vérifier si un pool a besoin de réappro
// ════════════════════════════════════════════
const verifierStock = async (req, res) => {
  try {
    const { paysISO } = req.body

    if (!paysISO) {
      return res.status(400).json({
        erreur : 'paysISO obligatoire'
      })
    }

    const { data: pool, error } = await supabase
      .from('did_pool')
      .select('*')
      .eq('country_iso', paysISO)
      .eq('status', 'ACTIVE')
      .single()

    if (error || !pool) {
      return res.status(404).json({
        erreur : 'Pool introuvable pour ce pays',
        pays   : paysISO
      })
    }

    const tauxOccupation      = pool.allocated_count / pool.total_numbers
    const numerosRestants     = pool.total_numbers - pool.allocated_count
    const alerteRequise       = tauxOccupation >= 0.90
    const commandeEnCours     = pool.reorder_status === 'REORDER_PENDING'

    // Déclencher une alerte si stock critique
    if (alerteRequise && !commandeEnCours) {
      await supabase
        .from('did_pool')
        .update({ reorder_status: 'REORDER_PENDING' })
        .eq('pool_id', pool.pool_id)

      console.warn('ALERTE STOCK : Pool ' + paysISO +
        ' à ' + Math.round(tauxOccupation * 100) + '%')
    }

    return res.status(200).json({
      message            : 'Vérification stock terminée',
      paysISO            : paysISO,
      totalNumeros       : pool.total_numbers,
      numerosAttribues   : pool.allocated_count,
      numerosRestants    : numerosRestants,
      tauxOccupation     : Math.round(tauxOccupation * 100) + '%',
      alerteRequise      : alerteRequise,
      commandeEnCours    : commandeEnCours,
      statutReappro      : pool.reorder_status
    })

  } catch (error) {
    console.error('Erreur verifierStock :', error)
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// PUT /api/stock/reorder/:poolId
// Confirmer une commande de réapprovisionnement
// ════════════════════════════════════════════
const confirmerReappro = async (req, res) => {
  try {
    const { poolId }   = req.params
    const { quantite } = req.body

    if (!quantite || quantite < 10000) {
      return res.status(400).json({
        erreur   : 'Quantité invalide',
        minimum  : 10000
      })
    }

    // Récupérer le pool
    const { data: pool } = await supabase
      .from('did_pool')
      .select('*')
      .eq('pool_id', poolId)
      .single()

    if (!pool) {
      return res.status(404).json({
        erreur : 'Pool introuvable'
      })
    }

    // Mettre à jour le pool
    const { data, error } = await supabase
      .from('did_pool')
      .update({
        total_numbers  : pool.total_numbers + quantite,
        reorder_status : 'REORDER_CONFIRMED'
      })
      .eq('pool_id', poolId)
      .select()
      .single()

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur confirmation réapprovisionnement',
        detail : error.message
      })
    }

    return res.status(200).json({
      message          : 'Réapprovisionnement confirmé',
      pool             : data,
      numerosAjoutes   : quantite,
      nouveauTotal     : data.total_numbers
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

module.exports = {
  getPools,
  verifierStock,
  confirmerReappro
}