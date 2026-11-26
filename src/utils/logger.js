'use strict'

// ════════════════════════════════════════════════════════════
// Journalisation à niveaux, sans données personnelles :
// - les clés sensibles (pin, hash, token…) sont masquées ;
// - masquerTelephone() doit être utilisé pour tout numéro logué.
// ════════════════════════════════════════════════════════════

const config = require('../config')
const { contexteCourant } = require('./contexteRequete')

const NIVEAUX = { silent: -1, error: 0, warn: 1, info: 2, debug: 3 }
const seuil = NIVEAUX[config.logLevel] ?? NIVEAUX.info

const CLES_SENSIBLES = /pin|hash|salt|token|secret|password|authorization|cle_hex|api[-_]?key|mfa/i
const PROFONDEUR_MAX = 4

const masquerTelephone = (numero) => {
  if (numero === null || numero === undefined) return numero
  const texte = String(numero)
  if (texte.length <= 5) return '*'.repeat(texte.length)
  return texte.slice(0, 3) + '*'.repeat(texte.length - 5) + texte.slice(-2)
}

// Masque les séquences ressemblant à des numéros de téléphone dans un texte libre
// (ex. message d'erreur PostgreSQL « Key (phone_number)=(+33612345678) »).
const masquerTexte = (texte) => (typeof texte === 'string'
  ? texte.replace(/\+?\d{7,15}/g, (sequence) => masquerTelephone(sequence))
  : texte)

const nettoyer = (valeur, profondeur = 0) => {
  if (valeur === null || typeof valeur !== 'object') return valeur
  if (profondeur >= PROFONDEUR_MAX) return '[…]'
  if (Array.isArray(valeur)) return valeur.map((element) => nettoyer(element, profondeur + 1))
  const resultat = {}
  for (const [cle, contenu] of Object.entries(valeur)) {
    resultat[cle] = CLES_SENSIBLES.test(cle) ? '[masqué]' : nettoyer(contenu, profondeur + 1)
  }
  return resultat
}

const formaterErreur = (erreur) => {
  const resultat = { message: masquerTexte(erreur.message) }
  if (erreur.code) resultat.code = erreur.code
  if (erreur.cause && typeof erreur.cause === 'object') {
    resultat.cause = { message: masquerTexte(erreur.cause.message), code: erreur.cause.code }
  }
  if (!config.estProduction && erreur.stack) resultat.stack = erreur.stack
  return resultat
}

const serialiser = (contexte) => {
  if (contexte instanceof Error) return JSON.stringify(formaterErreur(contexte))
  if (typeof contexte === 'object' && contexte !== null) {
    try {
      return JSON.stringify(nettoyer(contexte))
    } catch {
      return '[contexte non sérialisable]'
    }
  }
  return String(contexte)
}

// Une ligne JSON par évènement (LOG_FORMAT=json), pour un outil de supervision.
const ligneJSON = (horodatage, niveau, message, requestId, contexte) => {
  const evenement = { horodatage, niveau, message }
  if (requestId) evenement.requestId = requestId
  if (contexte instanceof Error) evenement.erreur = formaterErreur(contexte)
  else if (contexte && typeof contexte === 'object') Object.assign(evenement, nettoyer(contexte))
  else if (contexte !== undefined) evenement.contexte = String(contexte)
  try {
    return JSON.stringify(evenement)
  } catch {
    return JSON.stringify({ horodatage, niveau, message, requestId, contexte: '[non sérialisable]' })
  }
}

const ecrire = (niveau, message, contexte) => {
  if (NIVEAUX[niveau] > seuil) return
  const horodatage = new Date().toISOString()
  const requestId = (contexteCourant() || {}).requestId || null
  let ligne
  if (config.logFormat === 'json') {
    ligne = ligneJSON(horodatage, niveau, message, requestId, contexte)
  } else {
    const prefixe = requestId ? ` [${requestId}]` : ''
    const suffixe = contexte === undefined ? '' : ` ${serialiser(contexte)}`
    ligne = `${horodatage} ${niveau.toUpperCase().padEnd(5)}${prefixe} ${message}${suffixe}`
  }
  const sortie = niveau === 'error' || niveau === 'warn' ? console.error : console.log
  sortie(ligne)
}

module.exports = {
  error: (message, contexte) => ecrire('error', message, contexte),
  warn: (message, contexte) => ecrire('warn', message, contexte),
  info: (message, contexte) => ecrire('info', message, contexte),
  debug: (message, contexte) => ecrire('debug', message, contexte),
  masquerTelephone,
  masquerTexte,
  nettoyer
}
