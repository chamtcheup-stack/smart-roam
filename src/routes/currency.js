'use strict'

const express = require('express')
const {
  previewConversion,
  confirmerConversion,
  getHistorique,
  listerCorridors
} = require('../controllers/currencyControllers')
const { authentifier, exigerProprietaireParam, exigerProprietaireCorps } = require('../middlewares/auth')
const { idempotence } = require('../middlewares/idempotence')

const router = express.Router()

router.use(authentifier)

router.get('/corridors', listerCorridors)
router.post('/preview', exigerProprietaireCorps('userId'), previewConversion)
router.post('/confirm', exigerProprietaireCorps('userId'), idempotence(), confirmerConversion)
router.get('/history/:userId', exigerProprietaireParam('userId'), getHistorique)

module.exports = router
