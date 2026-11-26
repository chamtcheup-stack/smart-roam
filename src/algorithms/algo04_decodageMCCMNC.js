'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 04 — Décodage MCC/MNC (Mobile Country / Network Code)
//
// MCC + MNC connus → pays + opérateur, confiance 100.
// MCC seul connu   → pays, opérateur inconnu, confiance 80.
// Sinon            → null (signal inexploitable).
// Tables locales (ITU-T E.212) : aucune requête réseau nécessaire.
// ════════════════════════════════════════════════════════════

const logger = require('../utils/logger')

const CONFIANCE_MCC_MNC = 100
const CONFIANCE_MCC_SEUL = 80

// MCC → pays (ISO 3166-1 alpha-2)
const TABLE_MCC_PAYS = new Map(Object.entries({
  // Europe
  208: 'FR', 206: 'BE', 214: 'ES', 270: 'LU', 260: 'PL', 226: 'RO', 231: 'SK', 259: 'MD',
  222: 'IT', 262: 'DE', 228: 'CH', 268: 'PT', 204: 'NL', 234: 'GB', 235: 'GB', 286: 'TR', 202: 'GR',
  // Afrique
  624: 'CM', 612: 'CI', 608: 'SN', 610: 'ML', 613: 'BF', 611: 'GN', 630: 'CD', 646: 'MG',
  602: 'EG', 603: 'DZ', 604: 'MA', 605: 'TN', 628: 'GA', 629: 'CG', 622: 'TD', 623: 'CF',
  614: 'NE', 615: 'TG', 616: 'BJ', 618: 'LR', 619: 'SL', 632: 'GW', 652: 'BW', 617: 'MU',
  627: 'GQ', 621: 'NG', 620: 'GH', 639: 'KE', 655: 'ZA',
  // Moyen-Orient / Asie
  416: 'JO', 420: 'SA', 424: 'AE', 425: 'IL', 432: 'IR', 467: 'KP', 460: 'CN', 440: 'JP',
  450: 'KR', 404: 'IN', 405: 'IN',
  // Amériques
  310: 'US', 311: 'US', 312: 'US', 313: 'US', 314: 'US', 315: 'US', 316: 'US',
  302: 'CA', 334: 'MX', 724: 'BR'
}))

// MCC + MNC → opérateur
const TABLE_MCC_MNC = new Map(Object.entries({
  20801: { pays: 'FR', operateur: 'Orange France' },
  20802: { pays: 'FR', operateur: 'Orange France' },
  20810: { pays: 'FR', operateur: 'SFR' },
  20815: { pays: 'FR', operateur: 'Free Mobile' },
  20820: { pays: 'FR', operateur: 'Bouygues Telecom' },
  20601: { pays: 'BE', operateur: 'Proximus' },
  20610: { pays: 'BE', operateur: 'Orange Belgium' },
  20620: { pays: 'BE', operateur: 'BASE' },
  21403: { pays: 'ES', operateur: 'Orange Espagne' },
  26003: { pays: 'PL', operateur: 'Orange Polska' },
  22610: { pays: 'RO', operateur: 'Orange Romania' },
  23101: { pays: 'SK', operateur: 'Orange Slovensko' },
  25901: { pays: 'MD', operateur: 'Orange Moldova' },
  27099: { pays: 'LU', operateur: 'Orange Luxembourg' },
  62401: { pays: 'CM', operateur: 'MTN Cameroon' },
  62402: { pays: 'CM', operateur: 'Orange Cameroun' },
  61203: { pays: 'CI', operateur: 'Orange Côte d\'Ivoire' },
  60801: { pays: 'SN', operateur: 'Orange Sénégal' },
  61002: { pays: 'ML', operateur: 'Orange Mali' },
  61302: { pays: 'BF', operateur: 'Orange Burkina Faso' },
  61101: { pays: 'GN', operateur: 'Orange Guinée' },
  63086: { pays: 'CD', operateur: 'Orange RDC' },
  64602: { pays: 'MG', operateur: 'Orange Madagascar' },
  60201: { pays: 'EG', operateur: 'Orange Egypt' },
  60400: { pays: 'MA', operateur: 'Orange Maroc' },
  60501: { pays: 'TN', operateur: 'Orange Tunisie' },
  41677: { pays: 'JO', operateur: 'Orange Jordan' }
}))

// MCC : 3 chiffres ; MNC : 2 ou 3 chiffres (un seul chiffre est complété à 2).
const normaliserCodes = (mcc, mnc) => {
  const mccTexte = mcc === null || mcc === undefined ? '' : String(mcc).trim()
  if (!/^\d{3}$/.test(mccTexte)) return null
  if (mnc === null || mnc === undefined || String(mnc).trim() === '') return { mcc: mccTexte, mnc: null }
  let mncTexte = String(mnc).trim()
  if (!/^\d{1,3}$/.test(mncTexte)) return null
  if (mncTexte.length === 1) mncTexte = `0${mncTexte}`
  return { mcc: mccTexte, mnc: mncTexte }
}

const construireCleRecherche = (mcc, mnc) => `${mcc}${mnc}`

const rechercherDansTable = (cleRecherche) => TABLE_MCC_MNC.get(cleRecherche) || null

const rechercherParMccSeul = (mcc) => {
  const pays = TABLE_MCC_PAYS.get(mcc)
  return pays ? { pays, operateur: null } : null
}

const calculerConfiance = (mccConnu, mncConnu) => {
  if (mccConnu && mncConnu) return CONFIANCE_MCC_MNC
  if (mccConnu) return CONFIANCE_MCC_SEUL
  return 0
}

// ── Traitement principal ────────────────────────────────────
const decoderMCCMNC = (mcc, mnc) => {
  const codes = normaliserCodes(mcc, mnc)
  if (!codes) {
    logger.debug('Signal MCC/MNC invalide', { mcc, mnc })
    return null
  }

  if (codes.mnc) {
    const exact = rechercherDansTable(construireCleRecherche(codes.mcc, codes.mnc))
    if (exact) {
      return { paysISO: exact.pays, nomOperateur: exact.operateur, confiance: calculerConfiance(true, true), ...codes }
    }
  }

  const parMcc = rechercherParMccSeul(codes.mcc)
  if (parMcc) {
    return { paysISO: parMcc.pays, nomOperateur: 'Opérateur inconnu', confiance: calculerConfiance(true, false), ...codes }
  }

  logger.debug('Signal MCC/MNC inconnu', codes)
  return null
}

module.exports = {
  decoderMCCMNC,
  normaliserCodes,
  calculerConfiance,
  TABLE_MCC_MNC,
  TABLE_MCC_PAYS
}
