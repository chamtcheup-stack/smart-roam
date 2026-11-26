'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 10 — Zero Trust : jetons d'accès JWT courts (15 min, 5 min
// pour une opération sensible) + refresh tokens opaques rotatifs
// (7 jours) stockés hachés (SHA-256) dans la table « session ».
//
// - Algorithme de signature épinglé (HS256) et émetteur vérifié.
// - Révocation immédiate : par session (logout) ou par utilisateur
//   (logout global, suppression de compte), vérifiée à chaque requête.
// - Rotation : un refresh token ne sert qu'une fois ; sa réutilisation
//   (vol probable) révoque toutes les sessions de l'utilisateur.
// - Si la table « session » est absente ou incompatible, les sessions
//   sont conservées en mémoire (avertissement journalisé).
// ════════════════════════════════════════════════════════════

const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const supabase = require('../supabase')
const config = require('../config')
const logger = require('../utils/logger')
const { nonAuthentifie } = require('../utils/http')
const { ErreurBase, estIncompatibiliteSchema } = require('../utils/db')
const { journaliserAudit } = require('../utils/audit')

const {
  secret,
  algorithme,
  emetteur,
  dureeAccesMinutes,
  dureeAccesSensibleMinutes,
  dureeRefreshMinutes
} = config.jwt

const MS_PAR_MINUTE = 60 * 1000
const ROLE_ADMIN = 'ADMIN'
const ROLE_USER = 'USER'

// ── État en mémoire (borné par la durée de vie des jetons) ──
const revocationsUtilisateur = new Map() // userId → horodatage (ms) : jetons émis avant = révoqués
const sessionsRevoquees = new Map() // sid → expiration (ms)
const refreshConsommes = new Map() // hash → { userId, expiration } (détection de réutilisation)
const sessionsMemoire = new Map() // hash → session (repli si table absente)
let tableSessionDisponible = true

const nettoyerEtat = (maintenant = Date.now()) => {
  const dureeAccesMaxMs = Math.max(dureeAccesMinutes, dureeAccesSensibleMinutes) * MS_PAR_MINUTE
  for (const [userId, horodatage] of revocationsUtilisateur) {
    if (maintenant - horodatage > dureeAccesMaxMs) revocationsUtilisateur.delete(userId)
  }
  for (const [sid, expiration] of sessionsRevoquees) if (expiration <= maintenant) sessionsRevoquees.delete(sid)
  for (const [hash, entree] of refreshConsommes) if (entree.expiration <= maintenant) refreshConsommes.delete(hash)
  for (const [hash, session] of sessionsMemoire) {
    if (Date.parse(session.expires_at) <= maintenant) sessionsMemoire.delete(hash)
  }
}
setInterval(nettoyerEtat, MS_PAR_MINUTE).unref()

// ── Fonctions ───────────────────────────────────────────────
const determinerDureeExpiration = (operationSensible) =>
  (operationSensible === true ? dureeAccesSensibleMinutes : dureeAccesMinutes)

const determinerRole = (utilisateur) => {
  if (!utilisateur) return ROLE_USER
  if (config.adminUserIds.includes(String(utilisateur.user_id))) return ROLE_ADMIN
  return String(utilisateur.role || '').toUpperCase() === ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER
}

// apc : appareil déjà connu du compte (true / false / null = inconnu), utilisé
// par la règle anti-fraude DEVICE. sens : jeton d'opération sensible (PIN confirmé).
const construirePayload = ({ userId, role, deviceId, sessionId, appareilConnu = null, sensible = false }) => ({
  sub: String(userId),
  role,
  did: deviceId || null,
  sid: sessionId,
  apc: typeof appareilConnu === 'boolean' ? appareilConnu : null,
  ...(sensible ? { sens: true } : {}),
  iat_ms: Date.now() // précision milliseconde pour la révocation
})

const genererAccessToken = (payload, dureeMinutes) => jwt.sign(payload, secret, {
  algorithm: algorithme,
  expiresIn: dureeMinutes * 60,
  issuer: emetteur,
  jwtid: crypto.randomUUID()
})

const genererRefreshToken = () => crypto.randomBytes(48).toString('base64url')

const hacherToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')

// ── Magasin de sessions ─────────────────────────────────────
const basculerEnMemoire = (erreur) => {
  if (!tableSessionDisponible) return
  tableSessionDisponible = false
  logger.warn('Table « session » absente ou incompatible : sessions conservées en mémoire (perdues au redémarrage)', {
    code: erreur.code
  })
}

const enregistrerSession = async (session) => {
  if (tableSessionDisponible) {
    const { error } = await supabase.from('session').insert(session)
    if (!error) return
    if (!estIncompatibiliteSchema(error)) throw new ErreurBase('enregistrement de la session', error)
    basculerEnMemoire(error)
  }
  sessionsMemoire.set(session.refresh_token_hash, session)
}

const trouverSession = async (refreshTokenHash) => {
  if (tableSessionDisponible) {
    const { data, error } = await supabase
      .from('session')
      .select('*')
      .eq('refresh_token_hash', refreshTokenHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (!error) return data
    if (!estIncompatibiliteSchema(error)) throw new ErreurBase('lecture de la session', error)
    basculerEnMemoire(error)
  }
  const session = sessionsMemoire.get(refreshTokenHash)
  return session && Date.parse(session.expires_at) > Date.now() ? session : null
}

// Retourne true si une session a effectivement été supprimée (protège la rotation
// contre deux renouvellements concurrents avec le même refresh token).
const supprimerSession = async (refreshTokenHash) => {
  const supprimeeMemoire = sessionsMemoire.delete(refreshTokenHash)
  if (!tableSessionDisponible) return supprimeeMemoire
  const { data, error } = await supabase
    .from('session')
    .delete()
    .eq('refresh_token_hash', refreshTokenHash)
    .select('refresh_token_hash')
  if (error) {
    if (!estIncompatibiliteSchema(error)) throw new ErreurBase('suppression de la session', error)
    basculerEnMemoire(error)
    return supprimeeMemoire
  }
  return supprimeeMemoire || (Array.isArray(data) && data.length > 0)
}

const supprimerSessionsUtilisateur = async (userId) => {
  for (const [hash, session] of sessionsMemoire) {
    if (String(session.user_id) === String(userId)) sessionsMemoire.delete(hash)
  }
  if (!tableSessionDisponible) return
  const { error } = await supabase.from('session').delete().eq('user_id', userId)
  if (error) {
    if (!estIncompatibiliteSchema(error)) throw new ErreurBase('révocation des sessions', error)
    basculerEnMemoire(error)
  }
}

// ── Traitement principal ────────────────────────────────────
const genererTokens = async ({ userId, role = ROLE_USER, deviceId = null, operationSensible = false, appareilConnu = null }) => {
  const dureeAcces = determinerDureeExpiration(operationSensible)
  const sessionId = crypto.randomUUID()
  const accessToken = genererAccessToken(construirePayload({ userId, role, deviceId, sessionId, appareilConnu }), dureeAcces)
  const refreshToken = genererRefreshToken()
  const expiration = new Date(Date.now() + dureeRefreshMinutes * MS_PAR_MINUTE)

  await enregistrerSession({
    user_id: userId,
    device_id: deviceId,
    access_token_hash: hacherToken(accessToken),
    refresh_token_hash: hacherToken(refreshToken),
    expires_at: expiration.toISOString()
  })

  return {
    token_type: 'Bearer',
    access_token: accessToken,
    expires_in: dureeAcces * 60,
    refresh_token: refreshToken,
    refresh_expires_in: dureeRefreshMinutes * 60
  }
}

// Vérifie un jeton d'accès ; retourne { userId, role, deviceId, sessionId }
// ou lève une erreur 401 explicite.
const verifierToken = (tokenRecu) => {
  let payload
  try {
    payload = jwt.verify(tokenRecu, secret, { algorithms: [algorithme], issuer: emetteur })
  } catch (erreur) {
    if (erreur.name === 'TokenExpiredError') {
      throw nonAuthentifie('Jeton expiré : utilisez le refresh token', { code: 'TOKEN_EXPIRE' })
    }
    throw nonAuthentifie('Jeton invalide', { code: 'TOKEN_INVALIDE' })
  }

  if (!payload.sub || !payload.role || !payload.sid) {
    throw nonAuthentifie('Jeton invalide', { code: 'TOKEN_INVALIDE' })
  }
  if (sessionsRevoquees.has(payload.sid)) {
    throw nonAuthentifie('Session révoquée : reconnexion requise', { code: 'SESSION_REVOQUEE' })
  }
  const revoqueLe = revocationsUtilisateur.get(payload.sub)
  const emisLe = payload.iat_ms || payload.iat * 1000
  // <= : un jeton émis dans la même milliseconde que la révocation est révoqué.
  if (revoqueLe && emisLe <= revoqueLe) {
    throw nonAuthentifie('Jetons révoqués : reconnexion requise', { code: 'TOKENS_REVOQUES' })
  }

  return {
    userId: payload.sub,
    role: payload.role,
    deviceId: payload.did || null,
    sessionId: payload.sid,
    appareilConnu: typeof payload.apc === 'boolean' ? payload.apc : null,
    sensible: payload.sens === true
  }
}

// Jeton d'opération sensible (5 min) délivré après confirmation du PIN :
// rattaché à la session courante (révoqué avec elle), sans refresh token.
const genererJetonSensible = ({ userId, role, deviceId = null, sessionId, appareilConnu = null }) => ({
  token_type: 'Bearer',
  access_token: genererAccessToken(
    construirePayload({ userId, role, deviceId, sessionId, appareilConnu, sensible: true }),
    dureeAccesSensibleMinutes
  ),
  expires_in: dureeAccesSensibleMinutes * 60
})

const revoquerTousTokens = async (userId) => {
  revocationsUtilisateur.set(String(userId), Date.now())
  await supprimerSessionsUtilisateur(userId)
  logger.info('Toutes les sessions ont été révoquées', { userId })
}

const revoquerSession = async ({ refreshToken, sessionId }) => {
  if (sessionId) {
    sessionsRevoquees.set(sessionId, Date.now() + Math.max(dureeAccesMinutes, dureeAccesSensibleMinutes) * MS_PAR_MINUTE)
  }
  if (refreshToken) await supprimerSession(hacherToken(refreshToken))
}

// chargerUtilisateur(userId) → ligne utilisateur active ou null.
const renouvelerTokens = async (refreshToken, chargerUtilisateur) => {
  const hash = hacherToken(refreshToken)
  const session = await trouverSession(hash)

  if (!session) {
    const consomme = refreshConsommes.get(hash)
    if (consomme) {
      logger.warn('Réutilisation d\'un refresh token déjà utilisé : révocation de toutes les sessions', { userId: consomme.userId })
      void journaliserAudit({ userId: consomme.userId, entite: 'AUTH', action: 'REFRESH_TOKEN_REUTILISE_SESSIONS_REVOQUEES' })
      await revoquerTousTokens(consomme.userId)
    }
    throw nonAuthentifie('Refresh token invalide ou expiré', { code: 'REFRESH_INVALIDE' })
  }

  const supprimee = await supprimerSession(hash)
  if (!supprimee) throw nonAuthentifie('Refresh token déjà utilisé', { code: 'REFRESH_INVALIDE' })
  refreshConsommes.set(hash, { userId: String(session.user_id), expiration: Date.parse(session.expires_at) })

  const utilisateur = await chargerUtilisateur(session.user_id)
  if (!utilisateur) throw nonAuthentifie('Compte introuvable ou désactivé', { code: 'COMPTE_INACTIF' })

  return genererTokens({
    userId: session.user_id,
    role: determinerRole(utilisateur),
    deviceId: session.device_id,
    // Appareil enregistré lors de la connexion initiale de cette session.
    appareilConnu: session.device_id ? true : null
  })
}

module.exports = {
  ROLE_ADMIN,
  ROLE_USER,
  determinerDureeExpiration,
  determinerRole,
  genererTokens,
  genererJetonSensible,
  verifierToken,
  renouvelerTokens,
  revoquerSession,
  revoquerTousTokens,
  hacherToken,
  nettoyerEtat
}
