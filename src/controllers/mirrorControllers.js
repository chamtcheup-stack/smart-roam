const supabase = require('../supabase')

// ════════════════════════════════════════════
// POST /api/mirror/sync
// Synchroniser le profil miroir
// ════════════════════════════════════════════
const synchroniserMiroir = async (req, res) => {
  try {
    const { userId, numberId } = req.body

    if (!userId || !numberId) {
      return res.status(400).json({
        erreur : 'Champs manquants',
        requis : ['userId', 'numberId']
      })
    }

    // Récupérer le numéro virtuel
    const { data: numero } = await supabase
      .from('virtual_number')
      .select('*')
      .eq('number_id', numberId)
      .single()

    if (!numero) {
      return res.status(404).json({
        erreur : 'Numéro virtuel introuvable'
      })
    }

    // Récupérer le profil utilisateur
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (!user) {
      return res.status(404).json({
        erreur : 'Utilisateur introuvable'
      })
    }

    // Vérifier le consentement pour ce pays
    const paysDestination = numero.country_iso

    const { data: consentement } = await supabase
      .from('data_sovereignty_consent')
      .select('*')
      .eq('user_id', userId)
      .eq('destination_country', paysDestination)
      .eq('data_type', 'PROFILE')
      .eq('is_granted', true)
      .single()

    // Construire le profil miroir
    const nomAutorise    = consentement !== null
    const badgeKYC       = user.kyc_status === 'VERIFIED'
                           ? 'KYC_VERIFIE'
                           : 'AUCUN'

    const displayName = nomAutorise
      ? user.phone_number
      : 'Utilisateur Orange'

    // Mettre à jour le numéro virtuel
    const { data, error } = await supabase
      .from('virtual_number')
      .update({
        mirror_display_name : displayName,
        mirror_avatar_url   : null,
        mirror_synced_at    : new Date()
      })
      .eq('number_id', numberId)
      .select()
      .single()

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur synchronisation miroir',
        detail : error.message
      })
    }

    return res.status(200).json({
      message      : 'Profil miroir synchronisé avec succès',
      numero       : data,
      nomAutorise  : nomAutorise,
      badgeKYC     : badgeKYC
    })

  } catch (error) {
    console.error('Erreur synchroniserMiroir :', error)
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// GET /api/mirror/:userId
// Récupérer le profil miroir d'un utilisateur
// ════════════════════════════════════════════
const getProfilMiroir = async (req, res) => {
  try {
    const { userId } = req.params

    const { data, error } = await supabase
      .from('virtual_number')
      .select('*')
      .eq('user_id', userId)
      .not('mirror_display_name', 'is', null)

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur lecture profil miroir',
        detail : error.message
      })
    }

    return res.status(200).json({
      message  : 'Profils miroir récupérés',
      profils  : data,
      total    : data.length
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// POST /api/mirror/consent
// Gérer les consentements de partage
// ════════════════════════════════════════════
const gererConsentement = async (req, res) => {
  try {
    const { userId, paysDestination, dataType, isGranted } = req.body

    if (!userId || !paysDestination || !dataType) {
      return res.status(400).json({
        erreur : 'Champs manquants',
        requis : ['userId', 'paysDestination', 'dataType']
      })
    }

    const typesValides = ['PROFILE', 'LOCATION', 'TRANSACTION', 'AVATAR']
    if (!typesValides.includes(dataType)) {
      return res.status(400).json({
        erreur  : 'Type de donnée invalide',
        valides : typesValides
      })
    }

    // Date d'expiration 30 jours
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)

    const { data, error } = await supabase
      .from('data_sovereignty_consent')
      .upsert([{
        user_id             : userId,
        destination_country : paysDestination,
        data_type           : dataType,
        is_granted          : isGranted !== false,
        granted_at          : new Date(),
        expires_at          : expiresAt,
        legal_basis         : 'RGPD_CONSENT'
      }])
      .select()
      .single()

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur gestion consentement',
        detail : error.message
      })
    }

    return res.status(200).json({
      message      : 'Consentement mis à jour',
      consentement : data
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

module.exports = {
  synchroniserMiroir,
  getProfilMiroir,
  gererConsentement
}