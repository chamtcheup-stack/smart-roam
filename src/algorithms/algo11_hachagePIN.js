'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 11 — Hachage et vérification des PIN
//
// argon2 / bcrypt (modules natifs non installés) sont remplacés par
// scrypt, fonction mémoire-intensive native de Node et alternative
// recommandée par l'OWASP (N=2^15, r=8, p=3 ≈ 32 Mio).
// Un PIN à 4 chiffres n'a que 10 000 valeurs : la vraie protection
// repose sur le poivre secret (PIN_PEPPER, HMAC-SHA256 avant scrypt)
// et sur le verrouillage des tentatives (contrôleur).
//
// Format stocké (auto-descriptif, permet le re-hachage transparent) :
//   scrypt$v=1$N=32768,r=8,p=3$poivre=1$<sel base64>$<hash base64>
// L'ancien format (SHA-256 hex de pin + sel) reste vérifiable et
// est converti automatiquement à la première vérification réussie.
// ════════════════════════════════════════════════════════════

const crypto = require('crypto')
const { promisify } = require('util')
const supabase = require('../supabase')
const config = require('../config')
const logger = require('../utils/logger')
const { donnees } = require('../utils/db')

const scryptAsync = promisify(crypto.scrypt)

const ALGORITHME = 'scrypt'
const VERSION = 1
const PARAMETRES = Object.freeze({ N: 2 ** 15, r: 8, p: 3 })
const TAILLE_SEL = 16
const TAILLE_HASH = 32
const MEMOIRE_MAX = 64 * 1024 * 1024

// PIN triviaux refusés à la création (chiffres identiques, suites).
const PIN_TRIVIAUX = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '0123', '1234', '2345', '3456', '4567', '5678', '6789',
  '9876', '8765', '7654', '6543', '5432', '4321', '3210'
])

const estPINTrivial = (pin) => PIN_TRIVIAUX.has(pin)

const genererSel = () => crypto.randomBytes(TAILLE_SEL)

const preparerEntree = (pin, avecPoivre) => (avecPoivre
  ? crypto.createHmac('sha256', config.pinPepper).update(pin, 'utf8').digest()
  : Buffer.from(pin, 'utf8'))

const deriver = (entree, sel, { N, r, p }) =>
  scryptAsync(entree, sel, TAILLE_HASH, { N, r, p, maxmem: MEMOIRE_MAX })

const comparerTempsConstant = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b)

const hacherPIN = async (pin) => {
  const sel = genererSel()
  const avecPoivre = Boolean(config.pinPepper)
  const hash = await deriver(preparerEntree(pin, avecPoivre), sel, PARAMETRES)
  const { N, r, p } = PARAMETRES
  return {
    hash: `${ALGORITHME}$v=${VERSION}$N=${N},r=${r},p=${p}$poivre=${avecPoivre ? 1 : 0}$${sel.toString('base64')}$${hash.toString('base64')}`,
    sel: sel.toString('base64')
  }
}

const estPuissanceDeDeux = (n) => Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0

const analyserHash = (chaine) => {
  if (typeof chaine !== 'string') return null
  const parties = chaine.split('$')
  if (parties.length !== 6 || parties[0] !== ALGORITHME) return null

  const version = Number((parties[1].match(/^v=(\d+)$/) || [])[1])
  const params = Object.fromEntries(parties[2].split(',').map((paire) => {
    const [cle, valeur] = paire.split('=')
    return [cle, Number(valeur)]
  }))
  const poivre = parties[3].match(/^poivre=([01])$/)

  if (!version || !poivre || !estPuissanceDeDeux(params.N) || !(params.r > 0) || !(params.p > 0)) return null
  return {
    version,
    params: { N: params.N, r: params.r, p: params.p },
    avecPoivre: poivre[1] === '1',
    sel: Buffer.from(parties[4], 'base64'),
    hash: Buffer.from(parties[5], 'base64')
  }
}

const parametresAJour = (analyse) =>
  analyse.version === VERSION &&
  analyse.params.N === PARAMETRES.N &&
  analyse.params.r === PARAMETRES.r &&
  analyse.params.p === PARAMETRES.p &&
  analyse.avecPoivre === Boolean(config.pinPepper)

// Ancien format du contrôleur historique : SHA-256(pin + sel) en hexadécimal.
const verifierAncienFormat = (pin, hashStocke, selStocke) => {
  if (!/^[0-9a-f]{64}$/i.test(hashStocke) || !selStocke) return false
  const calcule = crypto.createHash('sha256').update(pin + selStocke).digest()
  return comparerTempsConstant(calcule, Buffer.from(hashStocke, 'hex'))
}

// Vérification pure : { valide, doitRehacher }.
const verifierPIN = async (pin, hashStocke, selStocke) => {
  if (!hashStocke) return { valide: false, doitRehacher: false }

  const analyse = analyserHash(hashStocke)
  if (!analyse) {
    const valide = verifierAncienFormat(pin, hashStocke, selStocke)
    return { valide, doitRehacher: valide }
  }

  if (analyse.avecPoivre && !config.pinPepper) {
    logger.error('PIN haché avec poivre mais PIN_PEPPER absent de la configuration')
    return { valide: false, doitRehacher: false }
  }

  const calcule = await deriver(preparerEntree(pin, analyse.avecPoivre), analyse.sel, analyse.params)
  const valide = comparerTempsConstant(calcule, analyse.hash)
  return { valide, doitRehacher: valide && !parametresAJour(analyse) }
}

// Calcul factice de même coût : évite de révéler par le temps de réponse
// qu'un compte n'existe pas ou n'a pas de PIN.
const simulerVerification = async () => {
  await deriver(Buffer.from('0000'), genererSel(), PARAMETRES)
  return { valide: false, doitRehacher: false }
}

// ── Accès base ──────────────────────────────────────────────
const sauvegarderHash = async (userId, pin) => {
  const { hash, sel } = await hacherPIN(pin)
  donnees(
    await supabase.from('users').update({ pin_hash: hash, pin_salt: sel }).eq('user_id', userId),
    'sauvegarde du PIN'
  )
  logger.info('PIN haché et sauvegardé', { userId, algorithme: ALGORITHME })
}

// Vérifie le PIN d'un utilisateur déjà chargé ({ user_id, pin_hash, pin_salt })
// et ré-hache automatiquement si le format ou les paramètres sont obsolètes.
const verifierPINUtilisateur = async (utilisateur, pin) => {
  if (!utilisateur || !utilisateur.pin_hash) return simulerVerification()

  const resultat = await verifierPIN(pin, utilisateur.pin_hash, utilisateur.pin_salt)
  if (resultat.valide && resultat.doitRehacher) {
    try {
      await sauvegarderHash(utilisateur.user_id, pin)
      logger.info('PIN ré-haché avec les paramètres actuels', { userId: utilisateur.user_id })
    } catch (erreur) {
      logger.warn('Ré-hachage du PIN impossible (vérification conservée)', erreur)
    }
  }
  return resultat
}

module.exports = {
  hacherPIN,
  verifierPIN,
  verifierPINUtilisateur,
  simulerVerification,
  sauvegarderHash,
  analyserHash,
  parametresAJour,
  estPINTrivial,
  PARAMETRES
}
