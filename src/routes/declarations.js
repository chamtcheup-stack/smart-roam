'use strict'

const express = require('express')
const {
  declarerDestination,
  getDeclarations,
  annulerDeclaration
} = require('../controllers/declarationsControllers')
const {
  authentifier,
  exigerProprietaireParam,
  exigerProprietaireCorps,
  exigerProprietaireRessource
} = require('../middlewares/auth')
const { idempotence } = require('../middlewares/idempotence')

const router = express.Router()

const declarationAppartientAuCompte = exigerProprietaireRessource({
  table: 'trip_declaration',
  colonneId: 'declaration_id',
  champ: 'declarationId',
  message: 'Déclaration introuvable'
})

router.use(authentifier)

router.post('/new', exigerProprietaireCorps('userId'), idempotence(), declarerDestination)
router.get('/:userId', exigerProprietaireParam('userId'), getDeclarations)
router.put('/:declarationId/cancel', declarationAppartientAuCompte, annulerDeclaration)

module.exports = router
