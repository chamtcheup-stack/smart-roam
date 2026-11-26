'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 12 — Certificate pinning (SPKI SHA-256)
//
// Côté backend, le pinning protège les appels HTTPS SORTANTS vers les
// partenaires (SM-DP+ eSIM, MVNO, API de change) contre une attaque de
// l'homme du milieu : le hash SHA-256 de la clé publique (SPKI) du
// certificat présenté doit figurer parmi les empreintes épinglées
// (PARTNER_TLS_PINS, format HPKP « sha256/<base64> » ou base64 seul).
// Le pinning de l'application mobile se configure côté client.
// ════════════════════════════════════════════════════════════

const crypto = require('crypto')
const tls = require('tls')
const https = require('https')
const config = require('../config')
const logger = require('../utils/logger')
const { journaliserAudit } = require('../utils/audit')

const ALGORITHME_HASH = 'sha256'
const TYPE_PINNING = 'SPKI'

const chargerPinsEpingles = (pins = config.pinning.empreintes) =>
  pins.map((pin) => String(pin).trim().replace(/^sha256\//i, '')).filter(Boolean)

// Clé publique DER (SubjectPublicKeyInfo) du certificat présenté par le serveur.
const extraireClePublique = (certificat) =>
  (certificat && Buffer.isBuffer(certificat.pubkey) ? certificat.pubkey : null)

const calculerHashSHA256 = (clePublique) =>
  (clePublique ? crypto.createHash(ALGORITHME_HASH).update(clePublique).digest('base64') : null)

// Comparaison en temps constant, sans sortie anticipée.
const comparerAvecPins = (hashClePublique, pinsStockes) => {
  const cible = Buffer.from(String(hashClePublique))
  let pinTrouve = false
  for (const pin of pinsStockes) {
    const candidat = Buffer.from(String(pin))
    if (candidat.length === cible.length && crypto.timingSafeEqual(candidat, cible)) pinTrouve = true
  }
  return pinTrouve
}

// Les empreintes ont une date d'expiration configurée (rotation des certificats partenaires).
const verifierExpirationPins = (dateExpiration = config.pinning.expiration, maintenant = new Date()) => {
  if (!dateExpiration) return false
  const expiration = new Date(dateExpiration)
  return !Number.isNaN(expiration.getTime()) && maintenant > expiration
}

const verifierCertificatValide = (certificat, maintenant = new Date()) => {
  if (!certificat || !certificat.valid_from || !certificat.valid_to) return false
  const debut = new Date(certificat.valid_from)
  const fin = new Date(certificat.valid_to)
  return !Number.isNaN(debut.getTime()) && !Number.isNaN(fin.getTime()) && maintenant >= debut && maintenant <= fin
}

// Vérification du nom d'hôte (SAN, jokers) déléguée à l'implémentation de Node.
const verifierDomaineServeur = (certificat, hote) => {
  try {
    return tls.checkServerIdentity(hote, certificat) === undefined
  } catch {
    return false
  }
}

// ── Procédures ──────────────────────────────────────────────
const refuserConnexion = (hote, hashClePublique, raison) => {
  logger.warn('Connexion TLS refusée (pinning)', { hote, hash: hashClePublique, raison })
}

const notifierEquipeSecurite = (hashSuspect, hote) => {
  logger.error('ALERTE CRITIQUE : tentative MITM potentielle (empreinte inconnue)', { hote, hashSuspect })
}

const enregistrerAlerteSecurite = (hote, hashClePublique, raison) => {
  void journaliserAudit({
    entite: 'CERTIFICATE_PINNING',
    action: `CONNEXION_REFUSEE_${raison}_${hote}`.slice(0, 255),
    extra: { details: { hote, hash: hashClePublique } }
  })
}

// ── Traitement principal ────────────────────────────────────
const verifierCertificatePinningSSL = ({
  hote,
  certificat,
  pins: pinsFournis = config.pinning.empreintes,
  expirationPins = config.pinning.expiration,
  maintenant = new Date()
}) => {
  // Accepte « sha256/<base64> » (format HPKP) comme « <base64> ».
  const pins = chargerPinsEpingles(pinsFournis)
  const refus = (raison, hash = 'INCONNU') => {
    refuserConnexion(hote, hash, raison)
    enregistrerAlerteSecurite(hote, hash, raison)
    return { autorisee: false, raison, hash: hash === 'INCONNU' ? null : hash }
  }

  if (pins.length === 0) return refus('AUCUNE_EMPREINTE_CONFIGUREE')
  if (verifierExpirationPins(expirationPins, maintenant)) {
    logger.error('Empreintes TLS des partenaires expirées : mise à jour de PARTNER_TLS_PINS requise')
    return refus('PINS_EXPIRES')
  }
  if (!verifierCertificatValide(certificat, maintenant)) return refus('CERTIFICAT_EXPIRE_OU_INVALIDE')
  if (!verifierDomaineServeur(certificat, hote)) return refus('DOMAINE_INCORRECT')

  const clePublique = extraireClePublique(certificat)
  if (!clePublique) return refus('CLE_PUBLIQUE_ILLISIBLE')

  const hashClePublique = calculerHashSHA256(clePublique)
  if (!comparerAvecPins(hashClePublique, pins)) {
    notifierEquipeSecurite(hashClePublique, hote)
    return refus('PIN_NON_RECONNU', hashClePublique)
  }

  logger.debug('Connexion TLS autorisée (empreinte reconnue)', { hote })
  return { autorisee: true, raison: 'PIN_RECONNU', hash: hashClePublique }
}

// Agent HTTPS à utiliser pour tout appel sortant vers un partenaire :
//   fetch n'acceptant pas d'agent, utiliser https.request({ ..., agent }).
const creerAgentHttpsEpingle = ({ pins = config.pinning.empreintes, expirationPins = config.pinning.expiration } = {}) =>
  new https.Agent({
    keepAlive: true,
    checkServerIdentity: (hote, certificat) => {
      const resultat = verifierCertificatePinningSSL({ hote, certificat, pins, expirationPins })
      return resultat.autorisee ? undefined : new Error(`Certificate pinning : connexion refusée (${resultat.raison})`)
    }
  })

module.exports = {
  ALGORITHME_HASH,
  TYPE_PINNING,
  chargerPinsEpingles,
  extraireClePublique,
  calculerHashSHA256,
  comparerAvecPins,
  verifierExpirationPins,
  verifierCertificatValide,
  verifierDomaineServeur,
  verifierCertificatePinningSSL,
  creerAgentHttpsEpingle
}
