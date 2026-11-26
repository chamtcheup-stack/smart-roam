'use strict'

// ════════════════════════════════════════════════════════════
// Limitation de débit et verrouillage après échecs, en mémoire.
// Portée : un processus Node. En déploiement multi-instances,
// remplacer le stockage par un magasin partagé (ex. Redis).
// ════════════════════════════════════════════════════════════

const { tropDeRequetes } = require('./http')

const INTERVALLE_NETTOYAGE_MAX_MS = 60 * 1000

// Toutes les instances (compteurs, verrous) : remise à zéro globale possible
// (réinitialisation du mode démo, tests).
const instances = new Set()

const demarrerNettoyage = (instance, intervalleMs) => {
  instances.add(instance)
  const minuterie = setInterval(() => instance.nettoyer(), Math.min(intervalleMs, INTERVALLE_NETTOYAGE_MAX_MS))
  minuterie.unref()
}

// Compteur à fenêtre fixe : au plus `max` évènements par fenêtre et par clé.
class CompteurFenetre {
  constructor ({ fenetreMs, max }) {
    this.fenetreMs = fenetreMs
    this.max = max
    this.entrees = new Map()
    demarrerNettoyage(this, fenetreMs)
  }

  consommer (cle, maintenant = Date.now()) {
    let entree = this.entrees.get(cle)
    if (!entree || maintenant >= entree.finFenetre) {
      entree = { compte: 0, finFenetre: maintenant + this.fenetreMs }
      this.entrees.set(cle, entree)
    }
    entree.compte += 1
    return {
      autorise: entree.compte <= this.max,
      compte: entree.compte,
      restant: Math.max(0, this.max - entree.compte),
      reessayerDansSecondes: Math.max(1, Math.ceil((entree.finFenetre - maintenant) / 1000))
    }
  }

  // Lecture sans incrément (ex. ne compter que les échecs, mais vérifier avant d'agir).
  lire (cle, maintenant = Date.now()) {
    const entree = this.entrees.get(cle)
    const actif = entree && maintenant < entree.finFenetre
    return {
      compte: actif ? entree.compte : 0,
      depasse: actif ? entree.compte >= this.max : false,
      reessayerDansSecondes: actif ? Math.max(1, Math.ceil((entree.finFenetre - maintenant) / 1000)) : 0
    }
  }

  reinitialiser (cle) {
    this.entrees.delete(cle)
  }

  nettoyer (maintenant = Date.now()) {
    for (const [cle, entree] of this.entrees) {
      if (maintenant >= entree.finFenetre) this.entrees.delete(cle)
    }
  }
}

// Verrou progressif : chaque verrouillage successif dure plus longtemps
// (paliers), jusqu'à une réussite ou 24 h sans nouveau verrouillage.
// Avec 5 essais par palier (15 min, 1 h, 4 h, puis 24 h), un PIN à 4 chiffres
// ne peut plus être essayé qu'environ 25 fois par jour au lieu de 480.
class VerrouProgressif {
  constructor ({
    maxEchecs = 5,
    fenetreMs = 15 * 60 * 1000,
    paliersMs = [15 * 60 * 1000, 60 * 60 * 1000, 4 * 60 * 60 * 1000, 24 * 60 * 60 * 1000],
    oubliMs = 24 * 60 * 60 * 1000
  } = {}) {
    this.maxEchecs = maxEchecs
    this.fenetreMs = fenetreMs
    this.paliersMs = paliersMs
    this.oubliMs = oubliMs
    this.entrees = new Map()
    demarrerNettoyage(this, fenetreMs)
  }

  etat (cle, maintenant = Date.now()) {
    const entree = this.entrees.get(cle)
    if (entree && entree.bloqueJusqua > maintenant) {
      return { bloque: true, reessayerDansSecondes: Math.ceil((entree.bloqueJusqua - maintenant) / 1000), niveau: entree.niveau }
    }
    return { bloque: false, reessayerDansSecondes: 0, niveau: entree ? entree.niveau : 0 }
  }

  enregistrerEchec (cle, maintenant = Date.now()) {
    let entree = this.entrees.get(cle)
    if (!entree) {
      entree = { echecs: 0, debutFenetre: maintenant, bloqueJusqua: 0, niveau: 0, dernierBlocage: 0 }
      this.entrees.set(cle, entree)
    }
    if (entree.niveau > 0 && maintenant - entree.dernierBlocage > this.oubliMs) entree.niveau = 0
    if (maintenant - entree.debutFenetre > this.fenetreMs) {
      entree.echecs = 0
      entree.debutFenetre = maintenant
    }

    entree.echecs += 1
    if (entree.echecs < this.maxEchecs) {
      return { bloque: false, echecsRestants: this.maxEchecs - entree.echecs, reessayerDansSecondes: 0, niveau: entree.niveau }
    }

    const duree = this.paliersMs[Math.min(entree.niveau, this.paliersMs.length - 1)]
    entree.bloqueJusqua = maintenant + duree
    entree.niveau += 1
    entree.dernierBlocage = maintenant
    entree.echecs = 0
    entree.debutFenetre = maintenant
    return { bloque: true, echecsRestants: 0, reessayerDansSecondes: Math.ceil(duree / 1000), niveau: entree.niveau }
  }

  reinitialiser (cle) {
    this.entrees.delete(cle)
  }

  nettoyer (maintenant = Date.now()) {
    for (const [cle, entree] of this.entrees) {
      const inactif = maintenant - entree.debutFenetre > this.fenetreMs && entree.bloqueJusqua <= maintenant
      const oublie = entree.niveau === 0 || maintenant - entree.dernierBlocage > this.oubliMs
      if (inactif && oublie) this.entrees.delete(cle)
    }
  }
}

// Verrou : après `maxEchecs` échecs dans `fenetreMs`, la clé est bloquée `dureeBlocageMs`.
class VerrouTentatives {
  constructor ({ maxEchecs, fenetreMs, dureeBlocageMs }) {
    this.maxEchecs = maxEchecs
    this.fenetreMs = fenetreMs
    this.dureeBlocageMs = dureeBlocageMs
    this.entrees = new Map()
    demarrerNettoyage(this, fenetreMs)
  }

  etat (cle, maintenant = Date.now()) {
    const entree = this.entrees.get(cle)
    if (entree && entree.bloqueJusqua > maintenant) {
      return { bloque: true, reessayerDansSecondes: Math.ceil((entree.bloqueJusqua - maintenant) / 1000) }
    }
    return { bloque: false, reessayerDansSecondes: 0 }
  }

  enregistrerEchec (cle, maintenant = Date.now()) {
    let entree = this.entrees.get(cle)
    if (!entree || maintenant - entree.debutFenetre > this.fenetreMs) {
      entree = { echecs: 0, debutFenetre: maintenant, bloqueJusqua: 0 }
      this.entrees.set(cle, entree)
    }
    entree.echecs += 1
    if (entree.echecs >= this.maxEchecs) {
      entree.bloqueJusqua = maintenant + this.dureeBlocageMs
      entree.echecs = 0
      entree.debutFenetre = maintenant
      return { bloque: true, echecsRestants: 0, reessayerDansSecondes: Math.ceil(this.dureeBlocageMs / 1000) }
    }
    return { bloque: false, echecsRestants: this.maxEchecs - entree.echecs, reessayerDansSecondes: 0 }
  }

  reinitialiser (cle) {
    this.entrees.delete(cle)
  }

  nettoyer (maintenant = Date.now()) {
    for (const [cle, entree] of this.entrees) {
      const fenetreExpiree = maintenant - entree.debutFenetre > this.fenetreMs
      if (fenetreExpiree && entree.bloqueJusqua <= maintenant) this.entrees.delete(cle)
    }
  }
}

// Middleware Express de limitation de débit (par IP par défaut).
const limiterDebit = ({
  fenetreMs,
  max,
  message = 'Trop de requêtes, réessayez plus tard',
  cle = (req) => req.ip || 'inconnue'
}) => {
  const compteur = new CompteurFenetre({ fenetreMs, max })
  const middleware = (req, res, next) => {
    const resultat = compteur.consommer(cle(req))
    res.set('RateLimit-Limit', String(max))
    res.set('RateLimit-Remaining', String(resultat.restant))
    if (!resultat.autorise) return next(tropDeRequetes(message, resultat.reessayerDansSecondes))
    return next()
  }
  middleware.compteur = compteur
  return middleware
}

// Efface compteurs et verrouillages de toutes les instances.
const reinitialiserLimiteurs = () => {
  for (const instance of instances) instance.entrees.clear()
}

module.exports = { CompteurFenetre, VerrouTentatives, VerrouProgressif, limiterDebit, reinitialiserLimiteurs }
