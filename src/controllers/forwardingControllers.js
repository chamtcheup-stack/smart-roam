const supabase = require('../supabase')
const { evaluerRequeteWAF } = require('../algorithms/algo13_detectionWAF')

// ════════════════════════════════════════════
// POST /api/forwarding/rules/create
// Créer une règle de forwarding
// ════════════════════════════════════════════
const creerRegle = async (req, res) => {
  try {
    const {
      userId,
      numberId,
      triggerCondition,
      action,
      targetNumber,
      priority
    } = req.body

    // Vérifier les champs obligatoires
    if (!userId || !numberId || !triggerCondition || !action) {
      return res.status(400).json({
        erreur : 'Champs manquants',
        requis : ['userId', 'numberId', 'triggerCondition', 'action']
      })
    }

    // Vérifier que la condition est valide
    const conditionsValides = ['ALWAYS', 'BUSY', 'NO_ANSWER', 'NEVER']
    if (!conditionsValides.includes(triggerCondition)) {
      return res.status(400).json({
        erreur    : 'Condition invalide',
        valides   : conditionsValides
      })
    }

    // Vérifier que l'action est valide
    const actionsValides = ['FORWARD', 'VOICEMAIL', 'REJECT', 'RING']
    if (!actionsValides.includes(action)) {
      return res.status(400).json({
        erreur  : 'Action invalide',
        valides : actionsValides
      })
    }

    // Créer la règle dans Supabase
    const { data, error } = await supabase
      .from('forwarding_rule')
      .insert([{
        number_id         : numberId,
        user_id           : userId,
        trigger_condition : triggerCondition,
        action            : action,
        target_number     : targetNumber || null,
        priority          : priority || 1,
        is_active         : true
      }])
      .select()
      .single()

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur création règle',
        detail : error.message
      })
    }

    return res.status(201).json({
      message : 'Règle de forwarding créée avec succès',
      regle   : data
    })

  } catch (error) {
    console.error('Erreur creerRegle :', error)
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// GET /api/forwarding/rules/:userId
// Récupérer toutes les règles d'un utilisateur
// ════════════════════════════════════════════
const getRegles = async (req, res) => {
  try {
    const { userId } = req.params

    if (!userId) {
      return res.status(400).json({
        erreur : 'userId manquant'
      })
    }

    const { data, error } = await supabase
      .from('forwarding_rule')
      .select('*')
      .eq('user_id', userId)
      .order('priority', { ascending: true })

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur lecture règles',
        detail : error.message
      })
    }

    return res.status(200).json({
      message : 'Règles récupérées',
      regles  : data,
      total   : data.length
    })

  } catch (error) {
    console.error('Erreur getRegles :', error)
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// POST /api/forwarding/evaluate
// Évaluer quelle règle appliquer pour un appel
// ════════════════════════════════════════════
const evaluerAppel = async (req, res) => {
  try {
    const { numeroAppele, numeroAppelant, statutLigne } = req.body

    if (!numeroAppele || !numeroAppelant) {
      return res.status(400).json({
        erreur : 'Champs manquants',
        requis : ['numeroAppele', 'numeroAppelant']
      })
    }

    // Trouver à qui appartient le numéro
    const { data: numero } = await supabase
      .from('virtual_number')
      .select('user_id')
      .eq('did_number', numeroAppele)
      .eq('status', 'ACTIVE')
      .single()

    if (!numero) {
      return res.status(404).json({
        erreur   : 'Numéro DID introuvable ou inactif',
        decision : 'REJECT'
      })
    }

    // Charger les règles de cet utilisateur
    const { data: regles } = await supabase
      .from('forwarding_rule')
      .select('*')
      .eq('user_id', numero.user_id)
      .eq('is_active', true)
      .order('priority', { ascending: true })

    // Si aucune règle → sonner directement
    if (!regles || regles.length === 0) {
      return res.status(200).json({
        message     : 'Aucune règle configurée',
        decision    : 'RING',
        destination : numeroAppele
      })
    }

    // Évaluer les règles dans l'ordre
    let regleAppliquee = null
    const statut       = statutLigne || 'LIBRE'

    for (let i = 0; i < regles.length; i++) {
      const regle = regles[i]

      if (regle.trigger_condition === 'ALWAYS') {
        regleAppliquee = regle
        break
      }
      if (regle.trigger_condition === 'BUSY'
          && statut === 'OCCUPE') {
        regleAppliquee = regle
        break
      }
      if (regle.trigger_condition === 'NO_ANSWER'
          && statut === 'SANS_REPONSE') {
        regleAppliquee = regle
        break
      }
    }

    // Aucune règle applicable → sonner
    if (!regleAppliquee) {
      return res.status(200).json({
        message     : 'Aucune règle applicable',
        decision    : 'RING',
        destination : numeroAppele
      })
    }

    return res.status(200).json({
      message     : 'Règle appliquée',
      decision    : regleAppliquee.action,
      destination : regleAppliquee.target_number || numeroAppele,
      regle       : regleAppliquee
    })

  } catch (error) {
    console.error('Erreur evaluerAppel :', error)
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// DELETE /api/forwarding/rules/:ruleId
// Supprimer une règle
// ════════════════════════════════════════════
const supprimerRegle = async (req, res) => {
  try {
    const { ruleId } = req.params

    const { error } = await supabase
      .from('forwarding_rule')
      .update({ is_active: false })
      .eq('rule_id', ruleId)

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur suppression règle',
        detail : error.message
      })
    }

    return res.status(200).json({
      message : 'Règle désactivée avec succès'
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

module.exports = {
  creerRegle,
  getRegles,
  evaluerAppel,
  supprimerRegle
}