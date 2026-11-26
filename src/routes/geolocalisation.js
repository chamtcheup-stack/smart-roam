'use strict'

const express = require('express')
const {
  analyserSSID,
  decoderMCCMNC,
  signalerCellID,
  detecterArrivee
} = require('../controllers/geolocalisationControllers')
const { authentifier } = require('../middlewares/auth')

const router = express.Router()

router.use(authentifier)

router.post('/ssid', analyserSSID)
router.post('/mccmnc', decoderMCCMNC)
router.post('/cellid', signalerCellID)
router.post('/arrivee', detecterArrivee)

module.exports = router
