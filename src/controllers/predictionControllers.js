const supabase = require('../supabase')

// ════════════════════════════════════════════
// POST /api/prediction/suggest
// Suggérer une destination selon l'historique
// ════════════════════════════════════════════
const suggererDestination = async (req, res) => {
  try {
    const { userId } = req.body

    if (!userId) {
      return res.status(400).json({
        erreur : 'userId obligatoire'
      })
    }

    // Récupérer l'historique des 24 derniers mois
    const dateLimit = new Date()
    dateLimit.setMonth(dateLimit.getMonth() - 24)

    const { data: historique, error } = await supabase
      .from('travel_history')
      .select('*')
      .eq('user_id', userId)
      .gte('arrival_detected_at', dateLimit.toISOString())

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur lecture historique',
        detail : error.message
      })
    }

    // Minimum 3 voyages pour prédire
    if (!historique || historique.length < 3) {
      return res.status(200).json({
        message       : 'Historique insuffisant pour prédire',
        suggestion    : null,
        totalVoyages  : historique ? historique.length : 0,
        minimumRequis : 3
      })
    }

    // Compter les destinations
    const compteur = {}
    historique.forEach(voyage => {
      const pays = voyage.country_iso
      if (pays) {
        compteur[pays] = (compteur[pays] || 0) + 1
      }
    })

    // Trouver la destination la plus fréquente
    let meilleureDestination = null
    let maxVoyages           = 0

    Object.keys(compteur).forEach(pays => {
      if (compteur[pays] > maxVoyages) {
        maxVoyages           = compteur[pays]
        meilleureDestination = pays
      }
    })

    const probabilite = maxVoyages / historique.length

    // Seuil de 60% pour suggérer
    if (probabilite < 0.60) {
      return res.status(200).json({
        message    : 'Probabilité insuffisante pour suggérer',
        suggestion : null,
        probabilite : parseFloat((probabilite * 100).toFixed(1)) + '%'
      })
    }

    // Récupérer le nom du pays
    const { data: pays } = await supabase
      .from('country')
      .select('name_fr')
      .eq('country_iso', meilleureDestination)
      .single()

    return res.status(200).json({
      message         : 'Destination suggérée',
      suggestion      : {
        paysISO     : meilleureDestination,
        nomPays     : pays ? pays.name_fr : meilleureDestination,
        probabilite : parseFloat((probabilite * 100).toFixed(1)) + '%',
        nbVoyages   : maxVoyages
      },
      totalVoyages    : historique.length,
      instruction     : 'Confirmez avec POST /api/declarations/new'
    })

  } catch (error) {
    console.error('Erreur suggererDestination :', error)
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// GET /api/prediction/history/:userId
// Récupérer l'historique des voyages
// ════════════════════════════════════════════
const getHistoriqueVoyages = async (req, res) => {
  try {
    const { userId } = req.params

    const { data, error } = await supabase
      .from('travel_history')
      .select('*')
      .eq('user_id', userId)
      .order('arrival_detected_at', { ascending: false })

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur lecture historique',
        detail : error.message
      })
    }

    return res.status(200).json({
      historique : data,
      total      : data.length
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

module.exports = {
  suggererDestination,
  getHistoriqueVoyages
}