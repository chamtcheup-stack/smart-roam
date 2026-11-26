'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 08 — Scoring de confiance géographique
//
// Somme pondérée (bornée à 100) des signaux qui désignent le pays visé :
//   MCC/MNC 40 % × confiance · Cell-ID 30 % · IP 20 % · Wi-Fi aéroport 10 %
// Niveaux : HAUTE ≥ 70 · MOYENNE ≥ 50 · FAIBLE < 50.
// Un signal qui désigne un autre pays ne contribue pas au score.
//
// Format des signaux (normalisés par normaliserSignaux) :
//   cellId : { changement_detecte: bool, paysISO? }
//   mccMnc : { paysISO, confiance (0–100) }          (sortie de l'algo 04)
//   wifi   : { aeroport_reconnu: bool, paysISO }      (sortie de l'algo 03)
//   ip     : { paysISO }  ou directement 'FR'
// ════════════════════════════════════════════════════════════

const logger = require('../utils/logger')
const { journaliserAudit } = require('../utils/audit')

const POIDS_MCC_MNC = 0.40
const POIDS_CELL_ID = 0.30
const POIDS_IP = 0.20
const POIDS_WIFI = 0.10
const SEUIL_HAUTE = 70
const SEUIL_MOYENNE = 50
const DUREE_ATTENTE_MAX_SECONDES = 5

const pays = (valeur) => (typeof valeur === 'string' && /^[A-Za-z]{2}$/.test(valeur.trim()) ? valeur.trim().toUpperCase() : null)

const normaliserSignal = (type, signal) => {
  if (signal === null || signal === undefined) return null
  if (type === 'ip' && typeof signal === 'string') return { paysISO: pays(signal) }
  if (typeof signal !== 'object') return null
  const paysISO = pays(signal.paysISO || signal.pays_iso || signal.pays)
  switch (type) {
    case 'cellId':
      return { changement_detecte: signal.changement_detecte !== false, paysISO }
    case 'mccMnc':
      return { paysISO, confiance: Math.max(0, Math.min(100, Number(signal.confiance) || 0)) }
    case 'wifi':
      return { aeroport_reconnu: signal.aeroport_reconnu === true || signal.matchTrouve === true, paysISO }
    case 'ip':
      return { paysISO }
    default:
      return null
  }
}

const normaliserSignaux = ({ cellId = null, mccMnc = null, wifi = null, ip = null } = {}) => ({
  cellId: normaliserSignal('cellId', cellId),
  mccMnc: normaliserSignal('mccMnc', mccMnc),
  wifi: normaliserSignal('wifi', wifi),
  ip: normaliserSignal('ip', ip)
})

// Un changement de cellule prouve un déplacement ; s'il porte un pays, il doit correspondre.
const calculerContributionCellID = (signal, paysCible) => {
  if (!signal || !signal.changement_detecte) return 0
  if (signal.paysISO && signal.paysISO !== paysCible) return 0
  return POIDS_CELL_ID * 100
}

const calculerContributionMCCMNC = (signal, paysCible) => {
  if (!signal || signal.paysISO !== paysCible) return 0
  return POIDS_MCC_MNC * signal.confiance
}

const calculerContributionWifi = (signal, paysCible) =>
  (signal && signal.aeroport_reconnu && signal.paysISO === paysCible ? POIDS_WIFI * 100 : 0)

const calculerContributionIP = (signal, paysCible) =>
  (signal && signal.paysISO === paysCible ? POIDS_IP * 100 : 0)

// Somme pondérée bornée à 100 (nom conservé pour compatibilité).
const fusionnerScoresBayesien = (scoreCellID, scoreMCCMNC, scoreWifi, scoreIP) =>
  Math.round(Math.min(100, scoreCellID + scoreMCCMNC + scoreWifi + scoreIP))

const determinerNiveauCertitude = (scoreFinal) => {
  if (scoreFinal >= SEUIL_HAUTE) return 'HAUTE'
  if (scoreFinal >= SEUIL_MOYENNE) return 'MOYENNE'
  return 'FAIBLE'
}

// Pays le plus probable : MCC fiable > Wi-Fi d'aéroport > IP.
const determinerPaysCandidat = (signaux) => {
  const { mccMnc, wifi, ip } = signaux
  if (mccMnc && mccMnc.paysISO && mccMnc.confiance >= 80) return mccMnc.paysISO
  if (wifi && wifi.aeroport_reconnu && wifi.paysISO) return wifi.paysISO
  if (ip && ip.paysISO) return ip.paysISO
  return null
}

const calculerScore = (signaux, paysCible) => {
  const contributions = {
    cellId: calculerContributionCellID(signaux.cellId, paysCible),
    mccMnc: calculerContributionMCCMNC(signaux.mccMnc, paysCible),
    wifi: calculerContributionWifi(signaux.wifi, paysCible),
    ip: calculerContributionIP(signaux.ip, paysCible)
  }
  const scoreFinal = fusionnerScoresBayesien(contributions.cellId, contributions.mccMnc, contributions.wifi, contributions.ip)
  return { scoreFinal, niveauCertitude: determinerNiveauCertitude(scoreFinal), contributions }
}

// Un signal supplémentaire ({ type: 'MCC_MNC' | 'CELL_ID' | 'WIFI' | 'IP', ... }) remplace le signal du même type.
const integrerSignalSupplementaire = (signaux, signalSupplementaire) => {
  const correspondance = { MCC_MNC: 'mccMnc', CELL_ID: 'cellId', WIFI: 'wifi', IP: 'ip' }
  const type = correspondance[String(signalSupplementaire && signalSupplementaire.type || '').toUpperCase()]
  if (!type) return signaux
  return { ...signaux, [type]: normaliserSignal(type, signalSupplementaire) }
}

// ── Journalisation ──────────────────────────────────────────
const journaliserScore = (userId, scoreFinal, niveauCertitude, paysCandidat, paysDestination) => {
  logger.debug('Score de confiance géographique', { userId, scoreFinal, niveauCertitude, paysCandidat, paysDestination })
  void journaliserAudit({
    userId,
    entite: 'GEOLOCALISATION',
    action: `SCORE_${scoreFinal}_PAYS_${paysCandidat || 'INCONNU'}_DEST_${paysDestination}`
  })
}

const journaliserEvenementManque = (userId, scoreFinal, raison) => {
  logger.info('Activation non déclenchée', { userId, scoreFinal, minimum: SEUIL_HAUTE, raison })
  void journaliserAudit({ userId, entite: 'GEOLOCALISATION', action: `ACTIVATION_MANQUEE_${raison}_SCORE_${scoreFinal}` })
}

// ── Traitement principal ────────────────────────────────────
// HAUTE → ACTIVATION_IMMEDIATE ; MOYENNE → attente d'un signal supplémentaire
// (renvoyé par le client) puis ACTIVATION_APRES_ATTENTE ou ACTIVATION_ECHOUEE ;
// FAIBLE → ACTIVATION_IMPOSSIBLE.
const scoringConfianceGeographique = ({ userId = null, paysDestination, signaux, signalSupplementaire = null }) => {
  const cible = pays(paysDestination)
  let signauxNormalises = normaliserSignaux(signaux)
  let { scoreFinal, niveauCertitude, contributions } = calculerScore(signauxNormalises, cible)
  let paysCandidat = determinerPaysCandidat(signauxNormalises)
  journaliserScore(userId, scoreFinal, niveauCertitude, paysCandidat, cible)

  const resultat = (decision, extra = {}) => ({ decision, scoreFinal, niveauCertitude, paysCandidat, contributions, ...extra })

  if (niveauCertitude === 'HAUTE') return resultat('ACTIVATION_IMMEDIATE')

  if (niveauCertitude === 'FAIBLE') {
    journaliserEvenementManque(userId, scoreFinal, 'SCORE_FAIBLE')
    return resultat('ACTIVATION_IMPOSSIBLE')
  }

  // MOYENNE
  if (!signalSupplementaire) {
    return resultat('EN_ATTENTE_SIGNAL', { reessayerDansSecondes: DUREE_ATTENTE_MAX_SECONDES })
  }
  signauxNormalises = integrerSignalSupplementaire(signauxNormalises, signalSupplementaire)
  ;({ scoreFinal, niveauCertitude, contributions } = calculerScore(signauxNormalises, cible))
  paysCandidat = determinerPaysCandidat(signauxNormalises)
  journaliserScore(userId, scoreFinal, niveauCertitude, paysCandidat, cible)

  if (niveauCertitude === 'HAUTE') return resultat('ACTIVATION_APRES_ATTENTE')
  journaliserEvenementManque(userId, scoreFinal, 'APRES_ATTENTE')
  return resultat('ACTIVATION_ECHOUEE')
}

module.exports = {
  SEUIL_HAUTE,
  SEUIL_MOYENNE,
  normaliserSignaux,
  calculerContributionCellID,
  calculerContributionMCCMNC,
  calculerContributionWifi,
  calculerContributionIP,
  fusionnerScoresBayesien,
  determinerNiveauCertitude,
  determinerPaysCandidat,
  calculerScore,
  integrerSignalSupplementaire,
  scoringConfianceGeographique
}
