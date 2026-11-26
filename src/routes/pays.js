'use strict'

const express = require('express')
const { listerPays } = require('../controllers/paysControllers')

const router = express.Router()

// Public : nécessaire avant toute connexion (écran d'inscription).
router.get('/', listerPays)

module.exports = router
