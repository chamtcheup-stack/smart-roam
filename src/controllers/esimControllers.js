const supabase = require('../supabase')

// ════════════════════════════════════════════
// POST /api/esim/provision
// ════════════════════════════════════════════
const provisionnerESIM = async (req, res) => {
  try {
    const { userId, numberId, paysISO } = req.body

    if (!userId || !numberId || !paysISO) {
      return res.status(400).json({
        erreur : 'Champs manquants',
        requis : ['userId', 'numberId', 'paysISO']
      })
    }

    // Vérifier que le pays existe
    const { data: pays } = await supabase
      .from('country')
      .select('*')
      .eq('country_iso', paysISO)
      .single()

    if (!pays) {
      return res.status(400).json({
        erreur : 'Pays introuvable : ' + paysISO
      })
    }

    // Générer un ICCID unique
    const iccid = '8930' + paysISO +
                  Date.now().toString().slice(-10)

    const { data, error } = await supabase
      .from('esim_profile')
      .insert([{
        user_id       : userId,
        number_id     : numberId,
        iccid         : iccid,
        country_iso   : paysISO,
        plan_type     : 'WEEK',
        data_quota_mb : 1024,
        data_used_mb  : 0,
        status        : 'ACTIVE'
      }])
      .select()
      .single()

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur provisioning eSIM',
        detail : error.message
      })
    }

    return res.status(201).json({
      message : 'eSIM provisionnée avec succès',
      esim    : data
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// GET /api/esim/:userId
// ════════════════════════════════════════════
const getESIM = async (req, res) => {
  try {
    const { userId } = req.params

    const { data, error } = await supabase
      .from('esim_profile')
      .select('*')
      .eq('user_id', userId)

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur lecture eSIMs',
        detail : error.message
      })
    }

    return res.status(200).json({
      esims : data,
      total : data.length
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

module.exports = { provisionnerESIM, getESIM }