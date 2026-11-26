'use strict'

const express = require('express')
const {
  suggererDestination,
  getHistoriqueVoyages,
  enregistrerRetourSuggestion
} = require('../controllers/predictionControllers')
const { authentifier, exigerProprietaireParam, exigerProprietaireCorps } = require('../middlewares/auth')

const router = express.Router()

router.use(authentifier)

router.post('/suggest', exigerProprietaireCorps('userId'), suggererDestination)
router.post('/feedback', exigerProprietaireCorps('userId'), enregistrerRetourSuggestion)
router.get('/history/:userId', exigerProprietaireParam('userId'), getHistoriqueVoyages)

module.exports = router
