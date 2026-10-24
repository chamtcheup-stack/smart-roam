const supabase = require('../supabase')
const crypto   = require('crypto')

// ════════════════════════════════════════════
// POST /api/security/pin/create
// ════════════════════════════════════════════
const creerPIN = async (req, res) => {
  try {
    const { userId, pin } = req.body

    if (!userId || !pin) {
      return res.status(400).json({
        erreur : 'userId et pin obligatoires'
      })
    }

    if (pin.length !== 4 || isNaN(pin)) {
      return res.status(400).json({
        erreur : 'Le PIN doit contenir 4 chiffres'
      })
    }

    const sel     = crypto.randomBytes(16).toString('hex')
    const pinHash = crypto
      .createHash('sha256')
      .update(pin + sel)
      .digest('hex')

    const { error } = await supabase
      .from('users')
      .update({ pin_hash: pinHash, pin_salt: sel })
      .eq('user_id', userId)

    if (error) {
      return res.status(500).json({
        erreur : 'Erreur sauvegarde PIN',
        detail : error.message
      })
    }

    return res.status(200).json({
      message : 'PIN créé avec succès'
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// POST /api/security/pin/verify
// ════════════════════════════════════════════
const verifierPIN = async (req, res) => {
  try {
    const { userId, pin } = req.body

    if (!userId || !pin) {
      return res.status(400).json({
        erreur : 'userId et pin obligatoires'
      })
    }

    const { data, error } = await supabase
      .from('users')
      .select('pin_hash, pin_salt')
      .eq('user_id', userId)
      .single()

    if (error || !data) {
      return res.status(404).json({
        erreur : 'Utilisateur introuvable'
      })
    }

    if (!data.pin_hash || !data.pin_salt) {
      return res.status(400).json({
        erreur : 'Aucun PIN configuré'
      })
    }

    const pinHash   = crypto
      .createHash('sha256')
      .update(pin + data.pin_salt)
      .digest('hex')

    const pinValide = pinHash === data.pin_hash

    return res.status(200).json({
      valide  : pinValide,
      message : pinValide ? 'PIN correct' : 'PIN incorrect'
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// POST /api/security/waf/analyze
// ════════════════════════════════════════════
const analyserRequeteWAF = async (req, res) => {
  try {
    const { evaluerRequeteWAF } = require('../algorithms/algo13_detectionWAF')
    const resultat = await evaluerRequeteWAF(req)

    return res.status(200).json({
      message  : 'Analyse WAF terminée',
      decision : resultat.decision,
      raison   : resultat.raison || 'REQUETE_NORMALE'
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

module.exports = {
  creerPIN,
  verifierPIN,
  analyserRequeteWAF
}