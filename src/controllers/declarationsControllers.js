const supabase = require('../supabase')
const { attribuerNumeroDID } = require('../algorithms/algo15_attributionDID')

// ════════════════════════════════════════════
// POST /api/declarations/new
// ════════════════════════════════════════════
const declarerDestination = async (req, res) => {
  try {
    const { userId, paysISO, dateDepart, dateRetour } = req.body

    // Vérifier les champs obligatoires
    if (!userId || !paysISO || !dateDepart) {
      return res.status(400).json({
        erreur : 'Champs manquants',
        requis : ['userId', 'paysISO', 'dateDepart']
      })
    }

    // Vérifier que le pays existe
    const { data: pays, error: paysError } = await supabase
      .from('country')
      .select('*')
      .eq('country_iso', paysISO)
      .eq('did_enabled', true)
      .single()

    if (paysError || !pays) {
      return res.status(400).json({
        erreur : 'Ce pays nest pas supporté par Smart Roam',
        pays   : paysISO
      })
    }

    // Vérifier si déclaration déjà active
    const { data: existant } = await supabase
      .from('trip_declaration')
      .select('*')
      .eq('user_id', userId)
      .eq('destination_country', paysISO)
      .eq('status', 'PENDING')
      .single()

    if (existant) {
      return res.status(200).json({
        message     : 'Déclaration déjà active pour ce pays',
        declaration : existant
      })
    }

    // Appeler algo n°15 pour attribuer un numéro
    const numeroVirtuel = await attribuerNumeroDID(userId, paysISO)

    if (!numeroVirtuel) {
      return res.status(400).json({
        erreur : 'Aucun numéro disponible pour ce pays'
      })
    }

    // Créer la déclaration
    const { data: declaration, error: declError } = await supabase
      .from('trip_declaration')
      .insert([{
        user_id             : userId,
        destination_country : paysISO,
        departure_date      : dateDepart,
        return_date         : dateRetour || null,
        status              : 'PENDING',
        number_id           : numeroVirtuel.number_id,
        vault_prepared      : false
      }])
      .select()
      .single()

    if (declError) {
      return res.status(500).json({
        erreur : 'Erreur création déclaration',
        detail : declError.message
      })
    }

    // Enregistrer dans l'historique
    await supabase
      .from('travel_history')
      .insert([{
        user_id              : userId,
        country_iso          : paysISO,
        declared_destination : paysISO,
        declaration_time     : new Date(),
        detection_method     : 'MANUAL'
      }])

    return res.status(201).json({
      message       : 'Déclaration enregistrée avec succès',
      declaration   : declaration,
      numeroVirtuel : numeroVirtuel,
      pays          : pays.name_fr
    })

  } catch (error) {
    console.error('Erreur declarerDestination :', error)
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// GET /api/declarations/:userId
// ════════════════════════════════════════════
const getDeclarations = async (req, res) => {
  try {
    const { userId } = req.params

    const { data, error } = await supabase
      .from('trip_declaration')
      .select('*')
      .eq('user_id', userId)
      .order('declaration_time', { ascending: false })

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur lecture déclarations',
        detail : error.message
      })
    }

    return res.status(200).json({
      declarations : data,
      total        : data.length
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// PUT /api/declarations/:declarationId/cancel
// ════════════════════════════════════════════
const annulerDeclaration = async (req, res) => {
  try {
    const { declarationId } = req.params

    const { data: existant } = await supabase
      .from('trip_declaration')
      .select('*')
      .eq('declaration_id', declarationId)
      .single()

    if (!existant) {
      return res.status(404).json({
        erreur : 'Déclaration introuvable'
      })
    }

    if (existant.status === 'COMPLETED') {
      return res.status(400).json({
        erreur : 'Impossible dannuler un voyage terminé'
      })
    }

    const { data, error } = await supabase
      .from('trip_declaration')
      .update({ status: 'CANCELLED' })
      .eq('declaration_id', declarationId)
      .select()
      .single()

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur annulation',
        detail : error.message
      })
    }

    return res.status(200).json({
      message     : 'Déclaration annulée',
      declaration : data
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

module.exports = {
  declarerDestination,
  getDeclarations,
  annulerDeclaration
}