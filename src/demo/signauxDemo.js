'use strict'

// ════════════════════════════════════════════════════════════
// Signaux réseau simulés (mode démo) : ce que « verrait » le téléphone
// dans un pays — réseau Orange local (MCC/MNC), Wi-Fi de l'aéroport,
// pays de l'adresse IP, antenne relais (Cell-ID).
// L'application les renvoie tels quels à POST /api/geolocalisation/arrivee :
// toute la chaîne de détection réelle (algos 02, 03, 04, 08, 01) s'exécute.
// ════════════════════════════════════════════════════════════

const crypto = require('crypto')

// SSID présents dans la base de l'algo 03 ; MCC/MNC dans celle de l'algo 04.
const PROFILS_SIGNAUX = Object.freeze({
  CM: { lieu: 'Aéroport de Douala (DLA)', mcc: '624', mnc: '02', operateur: 'Orange Cameroun', ssid: 'DLA_AIRPORT_WIFI', paysIP: 'CM' },
  FR: { lieu: 'Aéroport Paris-Charles-de-Gaulle (CDG)', mcc: '208', mnc: '01', operateur: 'Orange France', ssid: 'CDG_WIFI', paysIP: 'FR' },
  BE: { lieu: 'Aéroport de Bruxelles (BRU)', mcc: '206', mnc: '10', operateur: 'Orange Belgium', ssid: 'BRUSSELS_AIRPORT', paysIP: 'BE' },
  SN: { lieu: 'Aéroport de Dakar (DSS)', mcc: '608', mnc: '01', operateur: 'Orange Sénégal', ssid: 'DAKAR_AIRPORT_WIFI', paysIP: 'SN' },
  CI: { lieu: 'Aéroport d\'Abidjan (ABJ)', mcc: '612', mnc: '03', operateur: 'Orange Côte d\'Ivoire', ssid: 'ABIDJAN_AIRPORT', paysIP: 'CI' },
  // Escale : aucun Wi-Fi d'aéroport référencé, réseau et IP marocains.
  MA: { lieu: 'Aéroport de Casablanca (CMN), en escale', mcc: '604', mnc: '00', operateur: 'Orange Maroc', ssid: null, paysIP: 'MA' }
})

const PAYS_SIMULES = Object.freeze(Object.keys(PROFILS_SIGNAUX))

// Nouvelle antenne à chaque appel (LAC et identifiant de cellule aléatoires) ;
// la seconde lecture confirme la cellule (pas de bascule ping-pong).
const nouvelleCellule = (mcc, mnc) => `${mcc}-${mnc}-${crypto.randomInt(1000, 9999)}-${crypto.randomInt(10000, 99999)}`

const signauxPour = (paysISO) => {
  const profil = PROFILS_SIGNAUX[String(paysISO || '').toUpperCase()]
  if (!profil) return null
  const cellId = nouvelleCellule(profil.mcc, profil.mnc)
  return {
    paysISO: String(paysISO).toUpperCase(),
    lieu: profil.lieu,
    operateur: profil.operateur,
    signaux: {
      mcc: profil.mcc,
      mnc: profil.mnc,
      ...(profil.ssid ? { ssid: profil.ssid } : {}),
      paysIP: profil.paysIP,
      cellId,
      cellIdConfirmation: cellId
    }
  }
}

module.exports = { PROFILS_SIGNAUX, PAYS_SIMULES, signauxPour }
