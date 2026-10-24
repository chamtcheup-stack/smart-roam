const supabase = require('../supabase')

// ════════════════════════════════════════════
// POST /api/currency/preview
// ════════════════════════════════════════════
const previewConversion = async (req, res) => {
  try {
    const { userId, deviseSource, deviseCible, montant } = req.body

    if (!userId || !deviseSource || !deviseCible || !montant) {
      return res.status(400).json({
        erreur : 'Champs manquants',
        requis : ['userId', 'deviseSource', 'deviseCible', 'montant']
      })
    }

    if (montant < 500) {
      return res.status(400).json({
        erreur   : 'Montant trop faible',
        minimum  : '500 XAF'
      })
    }

    // Vérifier le corridor de change
    const { data: corridor } = await supabase
      .from('currency_exchange_corridor')
      .select('*')
      .eq('source_currency', deviseSource)
      .eq('target_currency', deviseCible)
      .eq('is_active', true)
      .single()

    if (!corridor) {
      return res.status(400).json({
        erreur : 'Conversion ' + deviseSource +
                 ' vers ' + deviseCible + ' non disponible'
      })
    }

    if (corridor.circuit_breaker_status === 'TRIPPED') {
      return res.status(503).json({
        erreur  : 'Service suspendu',
        raison  : 'Taux instable en ce moment'
      })
    }

    // Calcul
    const tauxChange   = 0.00152
    const montantBrut  = montant * tauxChange
    const commission   = montantBrut * 0.015
    const montantNet   = montantBrut - commission

    return res.status(200).json({
      message        : 'Aperçu de votre conversion',
      deviseSource,
      deviseCible,
      montantSource  : montant,
      tauxChange,
      montantBrut    : parseFloat(montantBrut.toFixed(4)),
      commission     : parseFloat(commission.toFixed(4)),
      montantNet     : parseFloat(montantNet.toFixed(4))
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// POST /api/currency/confirm
// ════════════════════════════════════════════
const confirmerConversion = async (req, res) => {
  try {
    const { userId, deviseSource, deviseCible, montant } = req.body

    if (!userId || !deviseSource || !deviseCible || !montant) {
      return res.status(400).json({
        erreur : 'Champs manquants'
      })
    }

    const tauxChange   = 0.00152
    const montantBrut  = montant * tauxChange
    const commission   = montantBrut * 0.015
    const montantNet   = montantBrut - commission

    const { data, error } = await supabase
      .from('currency_transaction')
      .insert([{
        user_id           : userId,
        source_currency   : deviseSource,
        target_currency   : deviseCible,
        source_amount     : montant,
        gross_amount      : parseFloat(montantBrut.toFixed(4)),
        commission_amount : parseFloat(commission.toFixed(4)),
        net_amount        : parseFloat(montantNet.toFixed(4)),
        exchange_rate     : tauxChange,
        rate_source       : 'BCE',
        status            : 'CONFIRMED'
      }])
      .select()
      .single()

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur transaction',
        detail : error.message
      })
    }

    return res.status(201).json({
      message     : 'Transaction confirmée',
      transaction : data
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// GET /api/currency/history/:userId
// ════════════════════════════════════════════
const getHistorique = async (req, res) => {
  try {
    const { userId } = req.params

    const { data, error } = await supabase
      .from('currency_transaction')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur lecture historique',
        detail : error.message
      })
    }

    return res.status(200).json({
      transactions : data,
      total        : data.length
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

module.exports = {
  previewConversion,
  confirmerConversion,
  getHistorique
}