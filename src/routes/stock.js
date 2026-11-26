'use strict'

const express = require('express')
const {
  getPools,
  verifierStock,
  confirmerReappro,
  lancerJIT
} = require('../controllers/stockControllers')
const { authentifier, exigerRole, ROLES } = require('../middlewares/auth')

const router = express.Router()

// Gestion des stocks de numéros : réservée à l'exploitation Orange.
router.use(authentifier, exigerRole(ROLES.ADMIN, ROLES.SERVICE))

router.get('/pools', getPools)
router.post('/check', verifierStock)
router.put('/reorder/:poolId', confirmerReappro)
router.post('/jit/run', lancerJIT)

module.exports = router
