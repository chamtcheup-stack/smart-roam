'use strict'

const express = require('express')
const {
  creerRegle,
  getRegles,
  modifierRegle,
  evaluerAppel,
  supprimerRegle
} = require('../controllers/forwardingControllers')
const {
  authentifier,
  exigerRole,
  exigerProprietaireParam,
  exigerProprietaireCorps,
  exigerProprietaireRessource,
  ROLES
} = require('../middlewares/auth')

const router = express.Router()

const numeroAppartientAuCompte = exigerProprietaireRessource({
  table: 'virtual_number',
  colonneId: 'number_id',
  champ: 'numberId',
  source: 'body',
  message: 'Numéro virtuel introuvable'
})

const regleAppartientAuCompte = exigerProprietaireRessource({
  table: 'forwarding_rule',
  colonneId: 'rule_id',
  champ: 'ruleId',
  message: 'Règle introuvable'
})

router.use(authentifier)

router.post('/rules/create', exigerProprietaireCorps('userId'), numeroAppartientAuCompte, creerRegle)
router.get('/rules/:userId', exigerProprietaireParam('userId'), getRegles)
router.put('/rules/:ruleId', regleAppartientAuCompte, modifierRegle)
router.delete('/rules/:ruleId', regleAppartientAuCompte, supprimerRegle)
// Appelé par la plateforme de téléphonie à chaque appel entrant.
router.post('/evaluate', exigerRole(ROLES.SERVICE, ROLES.ADMIN), evaluerAppel)

module.exports = router
