'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 09 — Chiffrement authentifié AES-256-GCM
//
// Les clés ne sont plus stockées en clair dans la base (table kms_keys)
// à côté des données qu'elles protègent : elles proviennent d'un
// trousseau versionné fourni par l'environnement (ENCRYPTION_KEYS,
// idéalement injecté par un coffre de secrets) :
//     ENCRYPTION_KEYS=v1:<64 hex>:2026-01-15,v2:<64 hex>:2026-02-14
// La dernière entrée est la clé courante (chiffrement) ; les autres ne
// servent qu'au déchiffrement des anciens messages (rotation sans
// rupture). La date facultative permet d'alerter au-delà de 30 jours.
// ════════════════════════════════════════════════════════════

const crypto = require('crypto')
const config = require('../config')
const logger = require('../utils/logger')

const ALGORITHME = 'aes-256-gcm'
const TAILLE_CLE = 32 // octets (256 bits)
const TAILLE_IV = 12 // octets (96 bits, recommandé pour GCM)
const TAILLE_TAG = 16 // octets
const DUREE_VIE_CLE_JOURS = 30

const analyserTrousseau = (texte) => {
  const cles = new Map()
  let versionCourante = null

  for (const entree of String(texte || '').split(',').map((e) => e.trim()).filter(Boolean)) {
    const [version, cleHex, dateCreation] = entree.split(':')
    if (!/^[\w-]{1,32}$/.test(version || '')) throw new Error('ENCRYPTION_KEYS : version de clé invalide')
    if (!/^[0-9a-f]{64}$/i.test(cleHex || '')) throw new Error(`ENCRYPTION_KEYS : la clé ${version} doit faire 64 caractères hexadécimaux`)
    const date = dateCreation ? new Date(dateCreation) : null
    if (date && Number.isNaN(date.getTime())) throw new Error(`ENCRYPTION_KEYS : date invalide pour la clé ${version}`)
    cles.set(version, { cle: Buffer.from(cleHex, 'hex'), dateCreation: date })
    versionCourante = version
  }
  return { cles, versionCourante }
}

let trousseau = null
const obtenirTrousseau = () => {
  if (!trousseau) trousseau = analyserTrousseau(config.chiffrement.cles)
  if (!trousseau.versionCourante) {
    throw new Error('Chiffrement indisponible : ENCRYPTION_KEYS n\'est pas configuré (voir .env.example)')
  }
  return trousseau
}

// Permet de remplacer le trousseau (tests, rechargement à chaud).
const chargerTrousseau = (texte) => {
  trousseau = analyserTrousseau(texte)
  return trousseau.versionCourante
}

const genererIV = () => crypto.randomBytes(TAILLE_IV)

const genererNouvelleCle = () => crypto.randomBytes(TAILLE_CLE).toString('hex')

const chiffrerDonnees = (texteClair, cle, iv, donneesAssociees) => {
  const chiffreur = crypto.createCipheriv(ALGORITHME, cle, iv, { authTagLength: TAILLE_TAG })
  if (donneesAssociees) chiffreur.setAAD(Buffer.from(String(donneesAssociees), 'utf8'))
  const chiffre = Buffer.concat([chiffreur.update(String(texteClair), 'utf8'), chiffreur.final()])
  return { donnees_chiffrees: chiffre.toString('base64'), tag_gcm: chiffreur.getAuthTag().toString('base64') }
}

// Lève une erreur si le tag GCM est invalide (données ou AAD altérées, mauvaise clé).
const dechiffrerDonnees = (donneesChiffrees, tagGCM, cle, iv, donneesAssociees) => {
  const dechiffreur = crypto.createDecipheriv(ALGORITHME, cle, iv, { authTagLength: TAILLE_TAG })
  if (donneesAssociees) dechiffreur.setAAD(Buffer.from(String(donneesAssociees), 'utf8'))
  dechiffreur.setAuthTag(Buffer.from(tagGCM, 'base64'))
  return Buffer.concat([
    dechiffreur.update(Buffer.from(donneesChiffrees, 'base64')),
    dechiffreur.final()
  ]).toString('utf8')
}

const verifierRotationCle = () => {
  const { cles, versionCourante } = obtenirTrousseau()
  const { dateCreation } = cles.get(versionCourante)
  if (!dateCreation) return { versionCourante, ageJours: null, rotationRecommandee: false }
  const ageJours = Math.floor((Date.now() - dateCreation.getTime()) / (24 * 60 * 60 * 1000))
  return { versionCourante, ageJours, rotationRecommandee: ageJours >= DUREE_VIE_CLE_JOURS }
}

const refuserMessageCorrompu = (raison) => {
  logger.warn('Message chiffré rejeté : intégrité compromise', { raison })
}

// ── Traitement principal ────────────────────────────────────
// donneesAssociees (AAD) : contexte authentifié non chiffré (ex. userId),
// qui doit être fourni à l'identique au déchiffrement.
const chiffrerMessage = (texteClair, { donneesAssociees } = {}) => {
  const { cles, versionCourante } = obtenirTrousseau()
  const rotation = verifierRotationCle()
  if (rotation.rotationRecommandee) {
    logger.warn('Rotation de la clé de chiffrement recommandée', { version: versionCourante, ageJours: rotation.ageJours })
  }

  const iv = genererIV()
  const { donnees_chiffrees, tag_gcm } = chiffrerDonnees(texteClair, cles.get(versionCourante).cle, iv, donneesAssociees)
  return {
    version_cle: versionCourante,
    iv: iv.toString('base64'),
    tag_gcm,
    donnees_chiffrees
  }
}

// Retourne le texte clair, ou null si le message est corrompu / la clé inconnue.
const dechiffrerMessage = (payloadRecu, { donneesAssociees } = {}) => {
  const { cles } = obtenirTrousseau()
  const { donnees_chiffrees: donneesChiffrees, iv, tag_gcm: tagGCM, version_cle: versionCle } = payloadRecu || {}

  const entree = cles.get(versionCle)
  if (!entree) {
    refuserMessageCorrompu(`clé de version « ${versionCle} » inconnue`)
    return null
  }
  try {
    const ivBuffer = Buffer.from(String(iv), 'base64')
    if (ivBuffer.length !== TAILLE_IV) throw new Error('IV invalide')
    return dechiffrerDonnees(donneesChiffrees, tagGCM, entree.cle, ivBuffer, donneesAssociees)
  } catch {
    refuserMessageCorrompu('tag GCM invalide ou données altérées')
    return null
  }
}

module.exports = {
  ALGORITHME,
  chiffrerMessage,
  dechiffrerMessage,
  chiffrerDonnees,
  dechiffrerDonnees,
  verifierRotationCle,
  genererNouvelleCle,
  genererIV,
  chargerTrousseau,
  analyserTrousseau
}
