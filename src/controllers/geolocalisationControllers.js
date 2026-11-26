'use strict'

const v = require('../utils/validation')
const { requeteInvalide } = require('../utils/http')
const { resoudreUtilisateurCible } = require('../middlewares/auth')
const { reconnaissanceSSID } = require('../algorithms/algo03_reconnaissanceSSID')
const { decoderMCCMNC: decoderCodes, normaliserCodes } = require('../algorithms/algo04_decodageMCCMNC')
const { detecterChangementCellID } = require('../algorithms/algo02_detectionCellID')
const { fusionMultiSignaux } = require('../algorithms/algo01_fusionSignaux')

const lireCellID = (valeur, champ, options = {}) =>
  v.chaine(v.estAbsent(valeur) ? valeur : String(valeur), champ, { max: 64, ...options })

const MESSAGES_DECISION = {
  SURVEILLANCE: 'Aucun voyage actif : géofencing en surveillance',
  ARRIVEE_CONFIRMEE: 'Arrivée confirmée : votre numéro virtuel est actif',
  RETOUR_DETECTE: 'Retour détecté : vos numéros passent en mode parking',
  DEJA_SUR_PLACE: 'Vous êtes déjà sur place',
  ATTENTE_SIGNAL_SUPPLEMENTAIRE: 'Confiance intermédiaire : renvoyez vos signaux dans quelques secondes',
  ESCALE_IGNOREE: 'Pays sans rapport avec le voyage (escale probable)',
  SCORE_INSUFFISANT: 'Signaux insuffisants pour décider'
}

// ════════════════════════════════════════════
// POST /api/geolocalisation/ssid
// ════════════════════════════════════════════
const analyserSSID = async (req, res) => {
  const ssid = v.chaine(req.body.ssid, 'ssid', { max: 64 })
  const resultat = reconnaissanceSSID(ssid)

  if (resultat.matchTrouve) {
    return res.status(200).json({
      message: 'Aéroport reconnu',
      ssidAnalyse: ssid,
      codeIATA: resultat.codeIATA,
      paysISO: resultat.paysISO,
      typeMatch: resultat.typeMatch,
      bonusConfiance: resultat.bonusConfiance
    })
  }
  return res.status(200).json({
    message: resultat.ssidValide ? 'Aucun aéroport reconnu' : 'SSID non analysable',
    ssidAnalyse: ssid,
    matchTrouve: false
  })
}

// ════════════════════════════════════════════
// POST /api/geolocalisation/mccmnc
// ════════════════════════════════════════════
const decoderMCCMNC = async (req, res) => {
  v.exigerChamps(req.body, ['mcc'])
  const codes = normaliserCodes(req.body.mcc, req.body.mnc)
  if (!codes) {
    throw requeteInvalide('mcc doit comporter 3 chiffres et mnc 1 à 3 chiffres', { champ: 'mcc' })
  }

  const resultat = decoderCodes(codes.mcc, codes.mnc)
  if (resultat) {
    return res.status(200).json({
      message: 'Signal MCC/MNC décodé',
      mcc: codes.mcc,
      mnc: codes.mnc,
      pays: resultat.paysISO,
      operateur: resultat.nomOperateur,
      confiance: resultat.confiance
    })
  }
  return res.status(200).json({ message: 'Signal inconnu', mcc: codes.mcc, mnc: codes.mnc, confiance: 0 })
}

// ════════════════════════════════════════════
// POST /api/geolocalisation/cellid
// Changement d'antenne relais (algo 02)
// ════════════════════════════════════════════
const signalerCellID = async (req, res) => {
  const userId = resoudreUtilisateurCible(req, req.body.userId)
  const cellId = lireCellID(req.body.cellId, 'cellId')
  const cellIDConfirmation = lireCellID(req.body.cellIdConfirmation, 'cellIdConfirmation', { optionnel: true, defaut: null })

  const resultat = detecterChangementCellID(userId, cellId, { cellIDConfirmation })
  return res.status(200).json({ message: 'Cell-ID analysé', ...resultat })
}

// ════════════════════════════════════════════
// POST /api/geolocalisation/arrivee
// Signaux bruts du téléphone → décodage (algos 02, 03, 04) → fusion (algo 01)
// Corps : { mcc?, mnc?, ssid?, cellId?, cellIdConfirmation?, paysIP? }
// ════════════════════════════════════════════
const detecterArrivee = async (req, res) => {
  const userId = resoudreUtilisateurCible(req, req.body.userId)
  const { mcc, mnc, ssid, cellId, cellIdConfirmation, paysIP } = req.body
  const signaux = {}

  if (!v.estAbsent(mcc)) {
    const codes = normaliserCodes(mcc, mnc)
    if (!codes) throw requeteInvalide('mcc doit comporter 3 chiffres et mnc 1 à 3 chiffres', { champ: 'mcc' })
    const decode = decoderCodes(codes.mcc, codes.mnc)
    if (decode) signaux.mccMnc = { paysISO: decode.paysISO, confiance: decode.confiance }
  }
  if (!v.estAbsent(ssid)) {
    const wifi = reconnaissanceSSID(v.chaine(ssid, 'ssid', { max: 64 }))
    signaux.wifi = { aeroport_reconnu: wifi.matchTrouve, paysISO: wifi.paysISO }
  }
  if (!v.estAbsent(cellId)) {
    const cellule = detecterChangementCellID(userId, lireCellID(cellId, 'cellId'), {
      cellIDConfirmation: lireCellID(cellIdConfirmation, 'cellIdConfirmation', { optionnel: true, defaut: null })
    })
    signaux.cellId = { changement_detecte: cellule.changementDetecte, paysISO: signaux.mccMnc ? signaux.mccMnc.paysISO : null }
  }
  if (!v.estAbsent(paysIP)) signaux.ip = v.paysISO(paysIP, 'paysIP')

  if (Object.keys(signaux).length === 0) {
    throw requeteInvalide('Au moins un signal est requis', { signaux: ['mcc / mnc', 'ssid', 'cellId', 'paysIP'] })
  }

  const resultat = await fusionMultiSignaux(userId, signaux)
  return res.status(200).json({
    message: MESSAGES_DECISION[resultat.decision] || resultat.decision,
    ...resultat,
    signaux
  })
}

module.exports = { analyserSSID, decoderMCCMNC, signalerCellID, detecterArrivee }
