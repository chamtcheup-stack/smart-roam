'use strict'

// ════════════════════════════════════════════════════════════
// Authentification et autorisation.
// - Utilisateur : en-tête « Authorization: Bearer <jwt> » (algo 10).
// - Service (plateforme SIP, back-office) : en-tête « x-api-key ».
// Un utilisateur ne peut agir que sur ses propres données ; les
// rôles ADMIN et SERVICE peuvent cibler n'importe quel compte.
// ════════════════════════════════════════════════════════════

const crypto = require('crypto')
const config = require('../config')
const supabase = require('../supabase')
const v = require('../utils/validation')
const { ErreurBase } = require('../utils/db')
const { nonAuthentifie, interdit, introuvable, requeteInvalide } = require('../utils/http')
const { verifierToken, ROLE_ADMIN, ROLE_USER } = require('../algorithms/algo10_zeroTrustJWT')

const ROLE_SERVICE = 'SERVICE'
const ROLES = Object.freeze({ USER: ROLE_USER, ADMIN: ROLE_ADMIN, SERVICE: ROLE_SERVICE })

// Comparaison en temps constant de deux secrets de longueurs quelconques.
const secretsEgaux = (a, b) => {
  const empreinteA = crypto.createHash('sha256').update(String(a)).digest()
  const empreinteB = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(empreinteA, empreinteB)
}

const authentifier = (req, res, next) => {
  const cleApi = req.get('x-api-key')
  if (cleApi) {
    if (!config.cleServiceApi || !secretsEgaux(cleApi, config.cleServiceApi)) {
      throw nonAuthentifie('Clé API invalide')
    }
    req.auth = { role: ROLE_SERVICE, userId: null, sessionId: null }
    return next()
  }

  const [schema, jeton] = (req.get('authorization') || '').split(' ')
  if (schema !== 'Bearer' || !jeton) {
    throw nonAuthentifie('Jeton d\'accès manquant (en-tête Authorization: Bearer …)')
  }
  req.auth = verifierToken(jeton)
  return next()
}

const estPrivilegie = (auth) => Boolean(auth) && (auth.role === ROLE_ADMIN || auth.role === ROLE_SERVICE)

const exigerRole = (...roles) => (req, res, next) => {
  if (!req.auth || !roles.includes(req.auth.role)) {
    throw interdit('Droits insuffisants pour cette opération')
  }
  return next()
}

// Opération sensible (conversion, suppression de compte…) : un utilisateur doit
// présenter le jeton sensible obtenu en confirmant son PIN (5 minutes).
const exigerOperationSensible = (req, res, next) => {
  if (estPrivilegie(req.auth) || (req.auth && req.auth.sensible)) return next()
  throw nonAuthentifie('Confirmation par PIN requise : POST /api/security/pin/verify puis réessayez avec le jeton sensible', {
    code: 'CONFIRMATION_PIN_REQUISE'
  })
}

// Détermine le compte ciblé par la requête à partir d'un userId fourni
// (corps ou paramètre) : un utilisateur ne peut cibler que lui-même.
const resoudreUtilisateurCible = (req, userIdFourni, champ = 'userId') => {
  const userId = v.identifiant(userIdFourni, champ, { optionnel: true })
  if (estPrivilegie(req.auth)) {
    if (!userId) throw requeteInvalide(`${champ} obligatoire pour un appel administrateur ou service`)
    return userId
  }
  if (userId && userId !== String(req.auth.userId)) {
    throw interdit('Vous ne pouvez agir que sur votre propre compte')
  }
  return String(req.auth.userId)
}

// Middleware : le paramètre de route (ex. :userId) doit désigner l'appelant.
const exigerProprietaireParam = (nomParametre = 'userId') => (req, res, next) => {
  req.params[nomParametre] = resoudreUtilisateurCible(req, req.params[nomParametre], nomParametre)
  return next()
}

// Middleware : le champ du corps (ex. userId) désigne l'appelant ; il est
// renseigné automatiquement depuis le jeton s'il est absent.
const exigerProprietaireCorps = (champ = 'userId') => (req, res, next) => {
  req.body[champ] = resoudreUtilisateurCible(req, req.body[champ], champ)
  return next()
}

// Ressource chargée par son identifiant : 404 si elle appartient à un autre
// compte (ne révèle pas son existence).
const verifierProprietaire = (req, proprietaireId, message = 'Ressource introuvable') => {
  if (estPrivilegie(req.auth)) return
  if (proprietaireId === null || proprietaireId === undefined || String(proprietaireId) !== String(req.auth.userId)) {
    throw introuvable(message)
  }
}

// Middleware : la ressource désignée (paramètre de route ou champ du corps)
// doit appartenir à l'appelant. Ex. une règle de forwarding, un numéro virtuel.
const exigerProprietaireRessource = ({
  table,
  colonneId,
  champ,
  source = 'params',
  colonneProprietaire = 'user_id',
  message = 'Ressource introuvable'
}) => async (req, res, next) => {
  if (estPrivilegie(req.auth)) return next()
  const valeur = v.identifiant(req[source][champ], champ)
  const { data, error } = await supabase
    .from(table)
    .select(colonneProprietaire)
    .eq(colonneId, valeur)
    .maybeSingle()
  if (error) throw new ErreurBase(`contrôle de propriété (${table})`, error)
  verifierProprietaire(req, data && data[colonneProprietaire], message)
  return next()
}

module.exports = {
  ROLES,
  authentifier,
  exigerRole,
  exigerOperationSensible,
  exigerProprietaireParam,
  exigerProprietaireCorps,
  exigerProprietaireRessource,
  resoudreUtilisateurCible,
  verifierProprietaire,
  estPrivilegie,
  secretsEgaux
}
