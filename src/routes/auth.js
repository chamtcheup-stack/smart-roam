'use strict'

const express = require('express')
const {
  connexion,
  rafraichir,
  deconnexion,
  deconnexionGlobale,
  demanderCodeOTP,
  reinitialiserPINOublie
} = require('../controllers/authController')
const { authentifier, exigerRole, ROLES } = require('../middlewares/auth')
const config = require('../config')
const { limiterDebit } = require('../utils/limiteur')

const router = express.Router()
const QUINZE_MINUTES = 15 * 60 * 1000

// Plafond large par IP (CGNAT) : borne le coût CPU du hachage scrypt. La
// protection anti-force brute repose sur le verrou par compte et sur le
// comptage des seuls échecs par IP (contrôleur).
const limiteurConnexion = limiterDebit({
  fenetreMs: QUINZE_MINUTES,
  max: config.limites.connexionsParIP15min,
  message: 'Trop de tentatives de connexion depuis cette adresse, réessayez plus tard'
})
// Un refresh token ne sert qu'une fois et n'est pas devinable : plafond anti-abus seulement.
const limiteurRefresh = limiterDebit({ fenetreMs: QUINZE_MINUTES, max: 1000 })

// Codes SMS : quotas par numéro dans utils/otp (1 par minute, 5 par heure) ;
// plafond par IP volontairement large (CGNAT).
const limiteurOTP = limiterDebit({
  fenetreMs: QUINZE_MINUTES,
  max: 100,
  message: 'Trop de demandes de code depuis cette adresse, réessayez plus tard'
})

router.post('/login', limiteurConnexion, connexion)
router.post('/refresh', limiteurRefresh, rafraichir)
router.post('/otp', limiteurOTP, demanderCodeOTP)
router.post('/pin-oublie', limiteurOTP, reinitialiserPINOublie)
router.post('/logout', authentifier, exigerRole(ROLES.USER, ROLES.ADMIN), deconnexion)
router.post('/logout-all', authentifier, exigerRole(ROLES.USER, ROLES.ADMIN), deconnexionGlobale)

module.exports = router
