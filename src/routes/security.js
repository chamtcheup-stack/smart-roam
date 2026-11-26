'use strict'

const express = require('express')
const {
  creerPIN,
  verifierPIN,
  analyserRequeteWAF
} = require('../controllers/securityControllers')
const { authentifier, exigerRole, exigerProprietaireCorps, ROLES } = require('../middlewares/auth')
const { limiterDebit } = require('../utils/limiteur')

const router = express.Router()

// Limitation par IP en complément du verrouillage par compte.
const limiteurPIN = limiterDebit({
  fenetreMs: 15 * 60 * 1000,
  max: 20,
  message: 'Trop de tentatives de PIN depuis cette adresse, réessayez plus tard'
})

router.use(authentifier)

router.post('/pin/create', limiteurPIN, exigerProprietaireCorps('userId'), creerPIN)
router.post('/pin/verify', limiteurPIN, exigerProprietaireCorps('userId'), verifierPIN)
router.post('/waf/analyze', exigerRole(ROLES.ADMIN, ROLES.SERVICE), analyserRequeteWAF)

module.exports = router
