'use strict'

const express = require('express')
const { provisionnerESIM, getESIM } = require('../controllers/esimControllers')
const {
  authentifier,
  exigerProprietaireParam,
  exigerProprietaireCorps,
  exigerProprietaireRessource
} = require('../middlewares/auth')
const { idempotence } = require('../middlewares/idempotence')

const router = express.Router()

const numeroAppartientAuCompte = exigerProprietaireRessource({
  table: 'virtual_number',
  colonneId: 'number_id',
  champ: 'numberId',
  source: 'body',
  message: 'Numéro virtuel introuvable'
})

router.use(authentifier)

router.post('/provision', exigerProprietaireCorps('userId'), numeroAppartientAuCompte, idempotence(), provisionnerESIM)
router.get('/:userId', exigerProprietaireParam('userId'), getESIM)

module.exports = router
