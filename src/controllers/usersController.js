const supabase = require('../supabase')
const crypto   = require('crypto')

// ════════════════════════════════════════════
// POST /api/users/register
// Créer un nouvel utilisateur
// ════════════════════════════════════════════
const inscrireUtilisateur = async (req, res) => {
  try {
    const { phoneNumber, countryResidence, planId } = req.body

    if (!phoneNumber || !countryResidence) {
      return res.status(400).json({
        erreur : 'Champs manquants',
        requis : ['phoneNumber', 'countryResidence']
      })
    }

    // Vérifier que le numéro n'existe pas déjà
    const { data: existant } = await supabase
      .from('users')
      .select('user_id')
      .eq('phone_number', phoneNumber)
      .single()

    if (existant) {
      return res.status(409).json({
        erreur : 'Ce numéro de téléphone est déjà enregistré'
      })
    }

    // Vérifier que le pays existe
    const { data: pays } = await supabase
      .from('country')
      .select('*')
      .eq('country_iso', countryResidence)
      .single()

    if (!pays) {
      return res.status(400).json({
        erreur : 'Pays introuvable : ' + countryResidence
      })
    }

    // Créer l'utilisateur
    const { data: user, error } = await supabase
      .from('users')
      .insert([{
        phone_number           : phoneNumber,
        country_of_residence   : countryResidence,
        kyc_status             : 'PENDING',
        plan_id                : planId || null,
        data_region            : pays.data_region,
        residence_status       : 'RESIDENT',
        global_identity_status : 'PENDING_SYNC',
        user_origin_type       : 'ORANGE_NATIVE'
      }])
      .select()
      .single()

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur création utilisateur',
        detail : error.message
      })
    }

    // Créer le profil de fraude
    await supabase
      .from('fraud_profile')
      .insert([{
        user_id                 : user.user_id,
        avg_transaction_amount  : 0,
        avg_daily_transactions  : 0,
        typical_countries       : [],
        typical_hours           : [],
        anomaly_score           : 0,
        total_alerts            : 0,
        model_version           : '1.0'
      }])

    return res.status(201).json({
      message : 'Utilisateur créé avec succès',
      user    : {
        user_id              : user.user_id,
        phone_number         : user.phone_number,
        country_of_residence : user.country_of_residence,
        kyc_status           : user.kyc_status
      }
    })

  } catch (error) {
    console.error('Erreur inscrireUtilisateur :', error)
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// GET /api/users/:userId
// Récupérer le profil d'un utilisateur
// ════════════════════════════════════════════
const getUtilisateur = async (req, res) => {
  try {
    const { userId } = req.params

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (error || !data) {
      return res.status(404).json({
        erreur : 'Utilisateur introuvable'
      })
    }

    // Ne pas retourner les données sensibles
    const { pin_hash, pin_salt, mfa_secret, ...userSafe } = data

    return res.status(200).json({
      message : 'Utilisateur trouvé',
      user    : userSafe
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// PUT /api/users/:userId/kyc
// Mettre à jour le statut KYC
// ════════════════════════════════════════════
const mettreAJourKYC = async (req, res) => {
  try {
    const { userId }    = req.params
    const { kycStatus } = req.body

    const statutsValides = ['PENDING', 'VERIFIED', 'REJECTED']
    if (!kycStatus || !statutsValides.includes(kycStatus)) {
      return res.status(400).json({
        erreur  : 'Statut KYC invalide',
        valides : statutsValides
      })
    }

    const { data, error } = await supabase
      .from('users')
      .update({
        kyc_status      : kycStatus,
        kyc_verified_at : kycStatus === 'VERIFIED'
                          ? new Date()
                          : null
      })
      .eq('user_id', userId)
      .select()
      .single()

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur mise à jour KYC',
        detail : error.message
      })
    }

    return res.status(200).json({
      message    : 'Statut KYC mis à jour',
      user_id    : userId,
      kyc_status : data.kyc_status
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// GET /api/users/:userId/numbers
// Récupérer tous les numéros virtuels d'un user
// ════════════════════════════════════════════
const getMesNumeros = async (req, res) => {
  try {
    const { userId } = req.params

    const { data, error } = await supabase
      .from('virtual_number')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur lecture numéros',
        detail : error.message
      })
    }

    return res.status(200).json({
      message  : 'Numéros virtuels récupérés',
      numeros  : data,
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
// DELETE /api/users/:userId
// Supprimer un utilisateur (soft delete)
// ════════════════════════════════════════════
const supprimerUtilisateur = async (req, res) => {
  try {
    const { userId } = req.params

    const { error } = await supabase
      .from('users')
      .update({ deleted_at: new Date() })
      .eq('user_id', userId)

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur suppression',
        detail : error.message
      })
    }

    return res.status(200).json({
      message : 'Utilisateur supprimé avec succès'
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

module.exports = {
  inscrireUtilisateur,
  getUtilisateur,
  mettreAJourKYC,
  getMesNumeros,
  supprimerUtilisateur
}