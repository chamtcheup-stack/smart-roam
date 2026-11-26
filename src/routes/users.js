'use strict'

const express = require('express')
const {
  inscrireUtilisateur,
  getUtilisateur,
  mettreAJourKYC,
  getMesNumeros,
  supprimerUtilisateur
} = require('../controllers/usersController')
const config = require('../config')
const {
  authentifier,
  exigerRole,
  exigerOperationSensible,
  exigerProprietaireParam,
  ROLES
} = require('../middlewares/auth')
const { limiterDebit } = require('../utils/limiteur')

const router = express.Router()

// Seuil par IP réglable (LIMITE_INSCRIPTIONS_IP_HEURE) : IP partagées (CGNAT).
const limiteurInscription = limiterDebit({
  fenetreMs: 60 * 60 * 1000,
  max: config.limites.inscriptionsParIPHeure,
  message: 'Trop d\'inscriptions depuis cette adresse, réessayez plus tard'
})

// ── Public ───────────────────────────────────────────────────
router.post('/register', limiteurInscription, inscrireUtilisateur)
router.post('/', limiteurInscription, inscrireUtilisateur) // compatibilité avec l'ancienne route

// ── Authentifié ──────────────────────────────────────────────
router.use(authentifier)

router.get('/:userId', exigerProprietaireParam('userId'), getUtilisateur)
router.get('/:userId/numbers', exigerProprietaireParam('userId'), getMesNumeros)
// Suppression du compte : confirmation par PIN exigée (jeton sensible).
router.delete('/:userId', exigerProprietaireParam('userId'), exigerOperationSensible, supprimerUtilisateur)
router.put('/:userId/kyc', exigerRole(ROLES.ADMIN, ROLES.SERVICE), exigerProprietaireParam('userId'), mettreAJourKYC)

module.exports = router
