'use strict'

const express = require('express')
const {
  connexion,
  rafraichir,
  deconnexion,
  deconnexionGlobale
} = require('../controllers/authController')
const { authentifier, exigerRole, ROLES } = require('../middlewares/auth')
const { limiterDebit } = require('../utils/limiteur')

const router = express.Router()
const QUINZE_MINUTES = 15 * 60 * 1000

const limiteurConnexion = limiterDebit({
  fenetreMs: QUINZE_MINUTES,
  max: 10,
  message: 'Trop de tentatives de connexion depuis cette adresse, réessayez plus tard'
})
const limiteurRefresh = limiterDebit({ fenetreMs: QUINZE_MINUTES, max: 60 })

router.post('/login', limiteurConnexion, connexion)
router.post('/refresh', limiteurRefresh, rafraichir)
router.post('/logout', authentifier, exigerRole(ROLES.USER, ROLES.ADMIN), deconnexion)
router.post('/logout-all', authentifier, exigerRole(ROLES.USER, ROLES.ADMIN), deconnexionGlobale)

module.exports = router
