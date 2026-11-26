'use strict'

const express = require('express')
const {
  synchroniserMiroir,
  getProfilMiroir,
  gererConsentement,
  getConsentements
} = require('../controllers/mirrorControllers')
const {
  authentifier,
  exigerProprietaireParam,
  exigerProprietaireCorps,
  exigerProprietaireRessource
} = require('../middlewares/auth')

const router = express.Router()

const numeroAppartientAuCompte = exigerProprietaireRessource({
  table: 'virtual_number',
  colonneId: 'number_id',
  champ: 'numberId',
  source: 'body',
  message: 'Numéro virtuel introuvable'
})

router.use(authentifier)

router.post('/sync', exigerProprietaireCorps('userId'), numeroAppartientAuCompte, synchroniserMiroir)
router.post('/consent', exigerProprietaireCorps('userId'), gererConsentement)
router.get('/consents/:userId', exigerProprietaireParam('userId'), getConsentements)
router.get('/:userId', exigerProprietaireParam('userId'), getProfilMiroir)

module.exports = router
