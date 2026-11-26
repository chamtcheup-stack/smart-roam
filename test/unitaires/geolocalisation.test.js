'use strict'

const { describe, test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { preparer } = require('../helpers/contexte')

const U = 'a0000000-0000-4000-8000-000000000001'
const { faux, requerir } = preparer()
const a01 = requerir('src/algorithms/algo01_fusionSignaux')
const a02 = requerir('src/algorithms/algo02_detectionCellID')
const a03 = requerir('src/algorithms/algo03_reconnaissanceSSID')
const a04 = requerir('src/algorithms/algo04_decodageMCCMNC')
const a08 = requerir('src/algorithms/algo08_scoringConfiance')

describe('algo03 — reconnaissance SSID', () => {
  test('distance de Levenshtein correcte', () => {
    assert.equal(a03.calculerDistanceLevenshtein('kitten', 'sitting'), 3)
    assert.equal(a03.calculerDistanceLevenshtein('flaw', 'lawn'), 2)
    assert.equal(a03.calculerDistanceLevenshtein('', 'abc'), 3)
    assert.equal(a03.calculerDistanceLevenshtein('abc', 'abc'), 0)
  })

  test('match exact après normalisation (casse, espaces, tirets)', () => {
    const resultat = a03.reconnaissanceSSID('  cdg-wifi ')
    assert.equal(resultat.typeMatch, 'EXACT')
    assert.equal(resultat.codeIATA, 'CDG')
    assert.equal(resultat.bonusConfiance, 30)
  })

  test('match approché (1 caractère)', () => {
    const resultat = a03.reconnaissanceSSID('DAKAR_AIRPORT_WIFl')
    assert.equal(resultat.typeMatch, 'FUZZY')
    assert.equal(resultat.paysISO, 'SN')
    assert.equal(resultat.bonusConfiance, 15)
  })

  test('SSID inconnu ou invalide', () => {
    assert.equal(a03.reconnaissanceSSID('Livebox-1234').matchTrouve, false)
    assert.equal(a03.reconnaissanceSSID(1234).ssidValide, false)
    assert.equal(a03.reconnaissanceSSID('<hidden>').ssidValide, false)
    assert.equal(a03.reconnaissanceSSID('ab').ssidValide, false)
  })
})

describe('algo04 — décodage MCC/MNC', () => {
  test('opérateurs Orange correctement référencés', () => {
    assert.equal(a04.decoderMCCMNC('608', '01').paysISO, 'SN') // et non l'Égypte
    assert.equal(a04.decoderMCCMNC('602', '01').paysISO, 'EG')
    assert.equal(a04.decoderMCCMNC('206', '10').nomOperateur, 'Orange Belgium')
    assert.equal(a04.decoderMCCMNC('624', '02').confiance, 100)
  })

  test('MCC seul connu → confiance 80', () => {
    const resultat = a04.decoderMCCMNC('624', '99')
    assert.equal(resultat.paysISO, 'CM')
    assert.equal(resultat.confiance, 80)
  })

  test('MNC numérique complété à 2 chiffres', () => {
    assert.equal(a04.decoderMCCMNC(208, 1).nomOperateur, 'Orange France')
  })

  test('entrées invalides ou inconnues → null', () => {
    assert.equal(a04.decoderMCCMNC('6%', '01'), null)
    assert.equal(a04.decoderMCCMNC('999', '01'), null)
    assert.equal(a04.decoderMCCMNC('20801', null), null)
  })
})

describe('algo02 — changement de Cell-ID', () => {
  beforeEach(() => a02.reinitialiserCacheCellID())

  test('cycle complet : premier, identique, faux positif, changement confirmé', () => {
    let evenement = null
    a02.busEvenements.once(a02.EVENEMENT_CHANGEMENT, (e) => { evenement = e })
    assert.equal(a02.detecterChangementCellID(U, '208-01-1').action, 'PREMIER_CELL_ID')
    assert.equal(a02.detecterChangementCellID(U, '208-01-1').action, 'AUCUN_CHANGEMENT')
    assert.equal(a02.detecterChangementCellID(U, '208-01-2', { cellIDConfirmation: '208-01-1' }).action, 'FAUX_POSITIF')
    const changement = a02.detecterChangementCellID(U, '208-01-2', { cellIDConfirmation: '208-01-2' })
    assert.equal(changement.action, 'CELL_ID_CHANGED')
    assert.equal(changement.confirme, true)
    assert.equal(evenement.cell_id, '208-01-2')
  })

  test('Cell-ID illisible', () => {
    assert.equal(a02.detecterChangementCellID(U, '').action, 'CELL_ID_ILLISIBLE')
    assert.equal(a02.detecterChangementCellID(U, 'x'.repeat(65)).action, 'CELL_ID_ILLISIBLE')
  })
})

describe('algo08 — scoring de confiance', () => {
  const scorer = (signaux, signalSupplementaire) =>
    a08.scoringConfianceGeographique({ paysDestination: 'FR', signaux, signalSupplementaire })

  test('signaux concordants → HAUTE / activation immédiate', () => {
    const resultat = scorer({ mccMnc: { paysISO: 'FR', confiance: 100 }, cellId: { changement_detecte: true }, ip: 'FR' })
    assert.equal(resultat.scoreFinal, 90)
    assert.equal(resultat.decision, 'ACTIVATION_IMMEDIATE')
  })

  test('signaux d\'un autre pays → score nul (branche FAIBLE atteignable)', () => {
    const resultat = scorer({ mccMnc: { paysISO: 'BE', confiance: 100 }, ip: 'BE' })
    assert.equal(resultat.scoreFinal, 0)
    assert.equal(resultat.decision, 'ACTIVATION_IMPOSSIBLE')
  })

  test('score intermédiaire → attente, puis activation avec un signal supplémentaire', () => {
    const signaux = { mccMnc: { paysISO: 'FR', confiance: 80 }, ip: 'FR' }
    assert.equal(scorer(signaux).decision, 'EN_ATTENTE_SIGNAL')
    const apres = scorer(signaux, { type: 'CELL_ID', changement_detecte: true, paysISO: 'FR' })
    assert.equal(apres.scoreFinal, 82)
    assert.equal(apres.decision, 'ACTIVATION_APRES_ATTENTE')
  })

  test('pays candidat : MCC fiable > Wi-Fi aéroport > IP', () => {
    const signaux = a08.normaliserSignaux({ mccMnc: { paysISO: 'FR', confiance: 80 }, wifi: { matchTrouve: true, paysISO: 'BE' }, ip: 'ES' })
    assert.equal(a08.determinerPaysCandidat(signaux), 'FR')
  })
})

describe('algo01 — fusion multi-signaux', () => {
  beforeEach(() => faux.reinitialiser({
    users: [{ user_id: U, country_of_residence: 'CM' }],
    trip_declaration: [{ declaration_id: 'd1', user_id: U, destination_country: 'FR', status: 'PENDING', declaration_time: '2026-11-01T10:00:00Z' }],
    virtual_number: [{ number_id: 'n1', user_id: U, country_iso: 'FR', status: 'AWAITING_ARRIVAL' }],
    travel_history: [{ history_id: 'h1', user_id: U, country_iso: 'FR', declaration_time: '2026-11-01T10:00:00Z' }],
    audit_log: []
  }))

  const signauxFrance = { mccMnc: { paysISO: 'FR', confiance: 100 }, ip: 'FR', cellId: { changement_detecte: true } }

  test('escale dans un pays tiers ignorée', async () => {
    const resultat = await a01.fusionMultiSignaux(U, { mccMnc: { paysISO: 'BE', confiance: 100 }, ip: 'BE' })
    assert.equal(resultat.decision, 'ESCALE_IGNOREE')
  })

  test('arrivée → numéro activé, voyage confirmé, date d\'arrivée historisée', async () => {
    const resultat = await a01.fusionMultiSignaux(U, signauxFrance)
    assert.equal(resultat.decision, 'ARRIVEE_CONFIRMEE')
    assert.equal(faux.tables.virtual_number[0].status, 'ACTIVE')
    assert.equal(faux.tables.trip_declaration[0].status, 'CONFIRMED')
    assert.ok(faux.tables.travel_history[0].arrival_detected_at)
  })

  test('sur place puis retour → mode parking (le retour est désormais détecté)', async () => {
    await a01.fusionMultiSignaux(U, signauxFrance)
    assert.equal((await a01.fusionMultiSignaux(U, signauxFrance)).decision, 'DEJA_SUR_PLACE')
    const retour = await a01.fusionMultiSignaux(U, { mccMnc: { paysISO: 'CM', confiance: 100 }, ip: 'CM', cellId: { changement_detecte: true } })
    assert.equal(retour.decision, 'RETOUR_DETECTE')
    assert.equal(faux.tables.virtual_number[0].status, 'PARKED')
    assert.equal(faux.tables.trip_declaration[0].status, 'COMPLETED')
  })

  test('aucun voyage actif → surveillance', async () => {
    faux.tables.trip_declaration = []
    assert.equal((await a01.fusionMultiSignaux(U, signauxFrance)).decision, 'SURVEILLANCE')
  })

  test('voyage déclaré, encore chez soi → attente du départ, sans nouvel essai', async () => {
    const chezSoi = await a01.fusionMultiSignaux(U, { mccMnc: { paysISO: 'CM', confiance: 100 }, ip: 'CM' })
    assert.equal(chezSoi.decision, 'PAS_ENCORE_PARTI')
    assert.equal(chezSoi.reessayerDansSecondes, undefined)
    // Signaux partiels à domicile (IP + changement d'antenne = 50) : pas de boucle d'attente.
    const partiel = await a01.fusionMultiSignaux(U, { ip: 'CM', cellId: { changement_detecte: true } })
    assert.equal(partiel.decision, 'PAS_ENCORE_PARTI')
    assert.equal(faux.tables.virtual_number[0].status, 'AWAITING_ARRIVAL')
  })

  test('confiance intermédiaire pour l\'arrivée attendue → nouvel essai demandé', async () => {
    const resultat = await a01.fusionMultiSignaux(U, { ip: 'FR', cellId: { changement_detecte: true } })
    assert.deepEqual([resultat.decision, resultat.scoreConfiance, resultat.reessayerDansSecondes], ['ATTENTE_SIGNAL_SUPPLEMENTAIRE', 50, 5])
  })
})
