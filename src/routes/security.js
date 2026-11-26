'use strict'

const express = require('express')
const {
  creerPIN,
  verifierPIN,
  deverrouillerCompte,
  analyserRequeteWAF
} = require('../controllers/securityControllers')
const { authentifier, exigerRole, exigerProprietaireCorps, ROLES } = require('../middlewares/auth')
const { limiterDebit } = require('../utils/limiteur')

const router = express.Router()

// Routes authentifiées : limitation par compte (et non par IP, partagée en CGNAT),
// en complément du verrou progressif anti-force brute.
const limiteurPIN = limiterDebit({
  fenetreMs: 15 * 60 * 1000,
  max: 30,
  message: "Trop d'opérations sur le PIN pour ce compte, réessayez plus tard",
  cle: (req) => (req.auth && req.auth.userId ? `compte:${req.auth.userId}` : `ip:${req.ip}`)
})

router.use(authentifier)

router.post('/pin/create', limiteurPIN, exigerProprietaireCorps('userId'), creerPIN)
router.post('/pin/verify', limiteurPIN, exigerProprietaireCorps('userId'), verifierPIN)
router.post('/pin/unlock', exigerRole(ROLES.ADMIN, ROLES.SERVICE), deverrouillerCompte)
router.post('/waf/analyze', exigerRole(ROLES.ADMIN, ROLES.SERVICE), analyserRequeteWAF)

module.exports = router
