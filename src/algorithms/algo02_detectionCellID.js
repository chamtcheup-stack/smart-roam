'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 02 — Détection de changement de Cell-ID
//
// Le serveur ne peut pas lire l'antenne relais : l'application mobile
// envoie le Cell-ID courant et, idéalement, une seconde lecture faite
// ~2 s plus tard (cellIDConfirmation) pour écarter les faux positifs
// (bascule ping-pong entre deux cellules). Le dernier Cell-ID connu de
// chaque utilisateur est conservé en mémoire (24 h).
// Un changement confirmé émet l'évènement « CELL_ID_CHANGED ».
// ════════════════════════════════════════════════════════════

const { EventEmitter } = require('events')
const logger = require('../utils/logger')

const DUREE_CONSERVATION_MS = 24 * 60 * 60 * 1000
const LONGUEUR_MAX_CELL_ID = 64
const EVENEMENT_CHANGEMENT = 'CELL_ID_CHANGED'

const busEvenements = new EventEmitter()
const derniersCellID = new Map() // userId → { cellID, horodatage }

const nettoyer = (maintenant = Date.now()) => {
  for (const [userId, entree] of derniersCellID) {
    if (maintenant - entree.horodatage > DUREE_CONSERVATION_MS) derniersCellID.delete(userId)
  }
}
setInterval(nettoyer, 60 * 60 * 1000).unref()

const normaliserCellID = (valeur) => {
  if (valeur === null || valeur === undefined) return null
  const texte = String(valeur).trim()
  return texte.length > 0 && texte.length <= LONGUEUR_MAX_CELL_ID ? texte : null
}

const lireCellIDPrecedent = (userId, maintenant = Date.now()) => {
  const entree = derniersCellID.get(String(userId))
  if (!entree || maintenant - entree.horodatage > DUREE_CONSERVATION_MS) return null
  return entree.cellID
}

const comparerCellID = (cellIDActuel, cellIDPrecedent) => cellIDActuel !== cellIDPrecedent

// La seconde lecture doit confirmer la nouvelle cellule.
const confirmerChangement = (cellIDActuel, cellIDConfirmation) =>
  cellIDConfirmation === null || cellIDConfirmation === cellIDActuel

const mettreAJourCacheLocal = (userId, cellID, maintenant = Date.now()) => {
  derniersCellID.set(String(userId), { cellID, horodatage: maintenant })
}

const emettreEvenement = (userId, cellID, horodatage) => {
  const evenement = { user_id: userId, cell_id: cellID, timestamp: horodatage, source: 'CELL_ID' }
  busEvenements.emit(EVENEMENT_CHANGEMENT, evenement)
  logger.debug('Évènement émis : CELL_ID_CHANGED', { userId })
  return evenement
}

// ── Traitement principal ────────────────────────────────────
const detecterChangementCellID = (userId, cellIDBrut, { cellIDConfirmation = null, maintenant = Date.now() } = {}) => {
  const cellIDActuel = normaliserCellID(cellIDBrut)
  if (!cellIDActuel) return { action: 'CELL_ID_ILLISIBLE', changementDetecte: false }

  const cellIDPrecedent = lireCellIDPrecedent(userId, maintenant)
  if (cellIDPrecedent === null) {
    mettreAJourCacheLocal(userId, cellIDActuel, maintenant)
    return { action: 'PREMIER_CELL_ID', changementDetecte: false, cellID: cellIDActuel }
  }

  if (!comparerCellID(cellIDActuel, cellIDPrecedent)) {
    mettreAJourCacheLocal(userId, cellIDActuel, maintenant)
    return { action: 'AUCUN_CHANGEMENT', changementDetecte: false, cellID: cellIDActuel }
  }

  const confirmation = normaliserCellID(cellIDConfirmation)
  if (!confirmerChangement(cellIDActuel, confirmation)) {
    logger.debug('Faux positif ignoré : Cell-ID instable', { userId })
    return { action: 'FAUX_POSITIF', changementDetecte: false, cellID: cellIDPrecedent }
  }

  const horodatage = new Date(maintenant).toISOString()
  mettreAJourCacheLocal(userId, cellIDActuel, maintenant)
  emettreEvenement(userId, cellIDActuel, horodatage)

  return {
    action: EVENEMENT_CHANGEMENT,
    changementDetecte: true,
    confirme: confirmation !== null,
    cellID: cellIDActuel,
    cellIDPrecedent,
    timestamp: horodatage
  }
}

module.exports = {
  EVENEMENT_CHANGEMENT,
  busEvenements,
  detecterChangementCellID,
  normaliserCellID,
  comparerCellID,
  confirmerChangement,
  lireCellIDPrecedent,
  reinitialiserCacheCellID: () => derniersCellID.clear()
}
