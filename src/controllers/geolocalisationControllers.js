const { reconnaissanceSSID } = require('../algorithms/algo03_reconnaissanceSSID')

// ════════════════════════════════════════════
// POST /api/geolocation/ssid
// ════════════════════════════════════════════
const analyserSSID = async (req, res) => {
  try {
    const { ssid } = req.body

    if (!ssid) {
      return res.status(400).json({
        erreur : 'Le champ ssid est obligatoire'
      })
    }

    const resultat = reconnaissanceSSID(ssid)

    if (resultat && resultat.matchTrouve) {
      return res.status(200).json({
        message        : 'Aéroport reconnu',
        ssidAnalyse    : ssid,
        codeIATA       : resultat.codeIATA,
        paysISO        : resultat.paysISO,
        typeMatch      : resultat.typeMatch,
        bonusConfiance : resultat.bonusConfiance
      })
    }

    return res.status(200).json({
      message     : 'Aucun aéroport reconnu',
      ssidAnalyse : ssid,
      matchTrouve : false
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

// ════════════════════════════════════════════
// POST /api/geolocation/mccmnc
// ════════════════════════════════════════════
const decoderMCCMNC = async (req, res) => {
  try {
    const { mcc, mnc } = req.body

    if (!mcc) {
      return res.status(400).json({
        erreur : 'Le champ mcc est obligatoire'
      })
    }

    const tableMCCMNC = {
      '62402' : { pays: 'CM', operateur: 'Orange CM', confiance: 100 },
      '62401' : { pays: 'CM', operateur: 'MTN CM',    confiance: 100 },
      '20801' : { pays: 'FR', operateur: 'Orange FR', confiance: 100 },
      '20621' : { pays: 'BE', operateur: 'Orange BE', confiance: 100 },
      '60801' : { pays: 'SN', operateur: 'Orange SN', confiance: 100 }
    }

    const cle      = mcc + (mnc || '')
    const resultat = tableMCCMNC[cle]

    if (resultat) {
      return res.status(200).json({
        message   : 'Signal MCC/MNC décodé',
        mcc, mnc,
        pays      : resultat.pays,
        operateur : resultat.operateur,
        confiance : resultat.confiance
      })
    }

    return res.status(200).json({
      message   : 'Signal inconnu',
      mcc, mnc,
      confiance : 0
    })

  } catch (error) {
    return res.status(500).json({
      erreur : 'Erreur serveur',
      detail : error.message
    })
  }
}

module.exports = { analyserSSID, decoderMCCMNC }