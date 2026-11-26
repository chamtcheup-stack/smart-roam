'use strict'

// ════════════════════════════════════════════════════════════
// Routes du mode démo (/api/demo), montées UNIQUEMENT si DEMO_MODE=true.
// Elles simulent ce qui, en production, vient de l'extérieur :
// signaux réseau du téléphone, appels entrants de la plateforme de
// téléphonie, tâches planifiées — sans contourner la logique métier.
// ════════════════════════════════════════════════════════════

const express = require('express')
const supabase = require('../supabase')
const config = require('../config')
const v = require('../utils/validation')
const { introuvable, requeteInvalide } = require('../utils/http')
const { donnees } = require('../utils/db')
const { limiterDebit } = require('../utils/limiteur')
const { authentifier, estPrivilegie } = require('../middlewares/auth')
const { moteurRegleForwarding, normaliserStatutLigne } = require('../algorithms/algo16_moteurForwarding')
const { lireStatutLigne } = require('../controllers/forwardingControllers')
const { executerMaintenance } = require('../taches/maintenance')
const { COMPTES_DEMO, NUMEROS_DEMO } = require('./donneesDemo')
const { PAYS_SIMULES, signauxPour } = require('./signauxDemo')
const { reinitialiserDemo, etatDemo } = require('./pilotageDemo')
const { ETAPES_SCENARIO } = require('./scenario')

const router = express.Router()
const UNE_MINUTE = 60 * 1000

// Défense en profondeur : jamais servies hors mode démo.
router.use((req, res, next) => (config.demo ? next() : next(introuvable('Route introuvable'))))

const limiteurActions = limiterDebit({ fenetreMs: UNE_MINUTE, max: 30, message: 'Trop d\'actions de démo, patientez une minute' })

const comptePublic = ({ cle, nom, telephone, pin, role, pays, presentation, couleur, deviceId }) => ({
  cle, nom, telephone, pin, role, pays, presentation, couleur, deviceId, avatar: `/api/demo/avatars/${cle}.svg`
})

// ════════════════════════════════════════════
// GET /api/demo — comptes fictifs (avec PIN), outils, scénario
// ════════════════════════════════════════════
router.get('/', (req, res) => {
  res.status(200).json({
    mode: 'demo',
    message: 'Mode démo Smart Roam : données fictives, aucune base réelle ni opérateur contacté',
    comptes: COMPTES_DEMO.map(comptePublic),
    numeros: NUMEROS_DEMO,
    paysSimules: PAYS_SIMULES,
    scenario: ETAPES_SCENARIO,
    outils: {
      signaux: 'GET /api/demo/signaux/{paysISO}',
      appelEntrant: 'POST /api/demo/appel-entrant',
      maintenance: 'POST /api/demo/maintenance',
      etat: 'GET /api/demo/etat',
      reinitialiser: 'POST /api/demo/reinitialiser'
    }
  })
})

// ════════════════════════════════════════════
// GET /api/demo/etat — vue d'ensemble (stocks, voyages, numéros, audit)
// ════════════════════════════════════════════
router.get('/etat', (req, res) => {
  res.status(200).json({ mode: 'demo', ...etatDemo() })
})

// ════════════════════════════════════════════
// GET /api/demo/signaux/:paysISO — signaux qu'un téléphone capterait dans ce
// pays, à renvoyer à POST /api/geolocalisation/arrivee
// ════════════════════════════════════════════
router.get('/signaux/:paysISO', (req, res) => {
  const paysISO = v.paysISO(req.params.paysISO, 'paysISO')
  const resultat = signauxPour(paysISO)
  if (!resultat) throw introuvable('Pays non simulé', { paysSimules: PAYS_SIMULES })
  res.status(200).json({
    message: `Signaux simulés : ${resultat.lieu}`,
    ...resultat,
    utilisation: 'Envoyer « signaux » à POST /api/geolocalisation/arrivee'
  })
})

// ════════════════════════════════════════════
// POST /api/demo/appel-entrant (authentifié)
// Simule la plateforme de téléphonie : { numberId | numeroAppele,
// numeroAppelant?, statutLigne? (LIBRE, OCCUPE, SANS_REPONSE) }
// ════════════════════════════════════════════
const EXPLICATIONS = {
  RING: (r) => `Le téléphone sonne : l'appel est présenté sur ${r.destination}`,
  VOICEMAIL: () => 'Appel renvoyé vers la messagerie vocale',
  FORWARD: (r) => `Appel renvoyé vers ${r.destination}`,
  REJECT: (r) => (r.raison === 'NUMERO_INCONNU_OU_INACTIF'
    ? 'Numéro inactif (en attente d\'arrivée, en parking ou suspendu) : l\'appelant entend la tonalité occupé'
    : 'Appel refusé par une règle de renvoi')
}

const lireNumero = async (req) => {
  const { numberId, numeroAppele } = req.body
  if (v.estAbsent(numberId) && v.estAbsent(numeroAppele)) {
    throw requeteInvalide('numberId ou numeroAppele est obligatoire', { champs: ['numberId', 'numeroAppele'] })
  }
  const requete = supabase.from('virtual_number').select('number_id, user_id, did_number, status')
  const lignes = donnees(
    await (v.estAbsent(numberId)
      ? requete.in('did_number', v.variantesTelephone(v.telephone(numeroAppele, 'numeroAppele')))
      : requete.eq('number_id', v.identifiant(numberId, 'numberId'))
    ).limit(1),
    'lecture du numéro virtuel'
  ) || []
  const numero = lignes[0]
  // Un utilisateur ne simule des appels que vers ses propres numéros.
  if (!numero || (!estPrivilegie(req.auth) && String(numero.user_id) !== String(req.auth.userId))) {
    throw introuvable('Numéro virtuel introuvable')
  }
  return numero
}

router.post('/appel-entrant', authentifier, limiteurActions, async (req, res) => {
  const numero = await lireNumero(req)
  const numeroAppelant = v.chaine(req.body.numeroAppelant, 'numeroAppelant', { optionnel: true, max: 64 }) || NUMEROS_DEMO.correspondantParis
  const statutLigne = normaliserStatutLigne(lireStatutLigne(req.body.statutLigne))

  const resultat = await moteurRegleForwarding(numero.did_number, numeroAppelant, statutLigne)
  res.status(200).json({
    message: EXPLICATIONS[resultat.decision](resultat),
    numeroAppele: numero.did_number,
    statutNumero: numero.status,
    numeroAppelant,
    statutLigne,
    decision: resultat.decision,
    destination: resultat.destination,
    codeSIP: resultat.codeSIP,
    raison: resultat.raison,
    regle: resultat.regle || null
  })
})

// ════════════════════════════════════════════
// POST /api/demo/maintenance — exécute immédiatement les tâches planifiées
// (clôture des voyages échus, forfaits eSIM expirés, sessions périmées)
// ════════════════════════════════════════════
router.post('/maintenance', limiteurActions, async (req, res) => {
  const rapport = await executerMaintenance()
  res.status(200).json({ message: 'Tâches de maintenance exécutées', rapport })
})

// ════════════════════════════════════════════
// POST /api/demo/reinitialiser — état initial ; tous les appareils
// doivent se reconnecter
// ════════════════════════════════════════════
router.post('/reinitialiser', limiteurActions, async (req, res) => {
  const resultat = await reinitialiserDemo()
  res.status(200).json({ message: 'Démo réinitialisée : reconnectez-vous', ...resultat })
})

// ════════════════════════════════════════════
// GET /api/demo/avatars/:fichier — photo de profil fictive (initiales, SVG)
// ════════════════════════════════════════════
const echapperXML = (texte) => String(texte).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

const avatarSVG = ({ nom, couleur }) => {
  const initiales = nom.split(/\s+/).filter((mot) => /^\p{L}/u.test(mot)).slice(0, 2).map((mot) => mot[0].toUpperCase()).join('')
  return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" ' +
    `aria-label="${echapperXML(nom)}"><circle cx="128" cy="128" r="128" fill="${echapperXML(couleur)}"/>` +
    '<text x="128" y="128" dy="0.35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" ' +
    `font-size="104" font-weight="700" fill="#FFFFFF">${echapperXML(initiales)}</text></svg>`
}

router.get('/avatars/:fichier', (req, res) => {
  const compte = COMPTES_DEMO.find((c) => `${c.cle}.svg` === req.params.fichier)
  if (!compte) throw introuvable('Avatar introuvable')
  res.set('Cache-Control', 'public, max-age=3600')
  res.type('image/svg+xml').send(avatarSVG(compte))
})

module.exports = router
