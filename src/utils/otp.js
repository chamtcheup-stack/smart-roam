'use strict'

// ════════════════════════════════════════════════════════════
// Codes à usage unique (OTP) envoyés par SMS : prouvent que l'utilisateur
// possède le numéro (inscription, PIN oublié).
//   - 6 chiffres tirés au hasard (crypto), valables 5 minutes ;
//   - 5 essais au plus, puis un nouveau code doit être demandé ;
//   - au plus 1 envoi par minute et 5 par heure pour un même numéro
//     (coût des SMS, fraude au « SMS pumping ») ;
//   - seule une empreinte HMAC est conservée (en mémoire, par processus :
//     magasin partagé type Redis requis en déploiement multi-instances).
//
// Fournisseurs (OTP_PROVIDER) :
//   demo    : mode démo uniquement, le code est renvoyé dans la réponse ;
//   console : développement uniquement, le code est écrit dans le journal ;
//   aucun   : envoi impossible (503) tant qu'un fournisseur SMS réel n'est pas
//             branché dans FOURNISSEURS ci-dessous (ex. API SMS Orange).
// ════════════════════════════════════════════════════════════

const crypto = require('crypto')
const config = require('../config')
const logger = require('./logger')
const { tropDeRequetes, indisponible, requeteInvalide } = require('./http')
const { CompteurFenetre } = require('./limiteur')

const MOTIFS = Object.freeze(['INSCRIPTION', 'PIN_OUBLIE'])
const LONGUEUR_CODE = 6
const DUREE_VALIDITE_MS = 5 * 60 * 1000
const MAX_ESSAIS = 5
const DELAI_RENVOI_MS = 60 * 1000
const MAX_ENVOIS_HEURE = 5

const secretProcessus = crypto.randomBytes(32)
const codes = new Map() // `${motif}:${telephone}` → { empreinte, expiration, essais, envoyeLe }
const envoisParNumero = new CompteurFenetre({ fenetreMs: 60 * 60 * 1000, max: MAX_ENVOIS_HEURE })

const empreinteCode = (code) => crypto.createHmac('sha256', secretProcessus).update(String(code)).digest()
const cle = (telephone, motif) => `${motif}:${telephone}`

setInterval(() => {
  const maintenant = Date.now()
  for (const [identifiant, entree] of codes) if (entree.expiration <= maintenant) codes.delete(identifiant)
}, 60 * 1000).unref()

const texteSMS = (code, motif) => (motif === 'PIN_OUBLIE'
  ? `Smart Roam : votre code de réinitialisation du PIN est ${code}. Valable 5 minutes. Ne le communiquez à personne.`
  : `Smart Roam : votre code de vérification est ${code}. Valable 5 minutes. Ne le communiquez à personne.`)

// Envoi du SMS selon le fournisseur configuré. Pour brancher un fournisseur
// réel : ajouter ici une fonction async (telephone, message) qui lève une
// erreur en cas d'échec.
const FOURNISSEURS = {
  demo: async () => {},
  console: async (telephone, message) => {
    logger.info('SMS simulé (OTP_PROVIDER=console, développement uniquement)', { telephone: logger.masquerTelephone(telephone), message })
  },
  aucun: async () => {
    throw indisponible('Vérification par SMS momentanément indisponible : réessayez plus tard ou contactez le support Orange')
  }
}

// Envoie un nouveau code. Retourne { expireDansSecondes, renvoiPossibleDansSecondes, codeDemo? }.
const envoyerCode = async (telephone, motif, { maintenant = Date.now() } = {}) => {
  const identifiant = cle(telephone, motif)
  const existant = codes.get(identifiant)
  if (existant && maintenant - existant.envoyeLe < DELAI_RENVOI_MS) {
    throw tropDeRequetes('Un code vient d\'être envoyé : patientez avant d\'en demander un autre', Math.ceil((DELAI_RENVOI_MS - (maintenant - existant.envoyeLe)) / 1000))
  }
  const quota = envoisParNumero.consommer(telephone, maintenant)
  if (!quota.autorise) throw tropDeRequetes('Trop de codes demandés pour ce numéro, réessayez plus tard', quota.reessayerDansSecondes)

  const code = String(crypto.randomInt(0, 10 ** LONGUEUR_CODE)).padStart(LONGUEUR_CODE, '0')
  await (FOURNISSEURS[config.otp.fournisseur] || FOURNISSEURS.aucun)(telephone, texteSMS(code, motif))

  codes.set(identifiant, { empreinte: empreinteCode(code), expiration: maintenant + DUREE_VALIDITE_MS, essais: 0, envoyeLe: maintenant })
  return {
    expireDansSecondes: DUREE_VALIDITE_MS / 1000,
    renvoiPossibleDansSecondes: DELAI_RENVOI_MS / 1000,
    ...(config.otp.fournisseur === 'demo' ? { codeDemo: code } : {})
  }
}

// Vérifie (et consomme si valide) le code. Retourne { valide, raison?, essaisRestants? }.
const verifierCode = (telephone, motif, code, { maintenant = Date.now() } = {}) => {
  const identifiant = cle(telephone, motif)
  const entree = codes.get(identifiant)
  if (!entree || entree.expiration <= maintenant) {
    codes.delete(identifiant)
    return { valide: false, raison: 'CODE_EXPIRE_OU_ABSENT' }
  }
  const recu = empreinteCode(typeof code === 'string' ? code.trim() : '')
  if (crypto.timingSafeEqual(recu, entree.empreinte)) {
    codes.delete(identifiant) // usage unique
    return { valide: true }
  }
  entree.essais += 1
  if (entree.essais >= MAX_ESSAIS) {
    codes.delete(identifiant)
    return { valide: false, raison: 'TROP_D_ESSAIS', essaisRestants: 0 }
  }
  return { valide: false, raison: 'CODE_INCORRECT', essaisRestants: MAX_ESSAIS - entree.essais }
}

// Vérifie le code ou lève une erreur 400 explicite (code machine + essais restants).
const exigerCodeValide = (telephone, motif, code) => {
  const verification = verifierCode(telephone, motif, code)
  if (verification.valide) return
  throw requeteInvalide(
    verification.raison === 'CODE_INCORRECT' ? 'Code de vérification incorrect' : 'Code expiré ou trop d\'essais : demandez un nouveau code',
    {
      champ: 'otpCode',
      code: verification.raison,
      ...(verification.essaisRestants !== undefined ? { essaisRestants: verification.essaisRestants } : {})
    }
  )
}

module.exports = {
  MOTIFS,
  LONGUEUR_CODE,
  envoyerCode,
  verifierCode,
  exigerCodeValide,
  reinitialiserOTP: () => codes.clear()
}
