'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { preparer } = require('../helpers/contexte')

const { requerir } = preparer()
const v = requerir('src/utils/validation')
const { decalerNumero, comparerNumeros } = requerir('src/utils/numeros')
const { CompteurFenetre, VerrouTentatives } = requerir('src/utils/limiteur')
const logger = requerir('src/utils/logger')

const refuse400 = (fonction) => assert.throws(fonction, (erreur) => erreur.statut === 400)

describe('utils/validation', () => {
  test('identifiant : UUID ou entier positif, rien d\'autre', () => {
    assert.equal(v.identifiant('a0000000-0000-4000-8000-000000000001', 'id'), 'a0000000-0000-4000-8000-000000000001')
    assert.equal(v.identifiant(42, 'id'), '42')
    refuse400(() => v.identifiant('abc', 'id'))
    refuse400(() => v.identifiant('0', 'id'))
    refuse400(() => v.identifiant('1 OR 1=1', 'id'))
    assert.equal(v.identifiant(undefined, 'id', { optionnel: true }), undefined)
  })

  test('téléphone normalisé au format E.164', () => {
    assert.equal(v.telephone('+237 699-12-34-56', 'tel'), '+237699123456')
    assert.equal(v.telephone('00237699123456', 'tel'), '+237699123456')
    assert.equal(v.telephone('237699123456', 'tel'), '+237699123456')
    refuse400(() => v.telephone('abc', 'tel'))
    refuse400(() => v.telephone('+0123456789', 'tel'))
    assert.deepEqual(v.variantesTelephone('+33612345678'), ['+33612345678', '33612345678'])
  })

  test('date ISO 8601 stricte (pas de normalisation silencieuse)', () => {
    assert.equal(v.date('2026-02-28', 'd'), '2026-02-28')
    assert.equal(v.date('2026-11-19T10:00:00Z', 'd'), '2026-11-19T10:00:00Z')
    refuse400(() => v.date('2026-02-31', 'd'))
    refuse400(() => v.date('19/11/2026', 'd'))
  })

  test('montant strictement positif et numérique', () => {
    assert.equal(v.montant(10.5, 'm'), 10.5)
    assert.equal(v.montant('10.5', 'm'), 10.5)
    for (const invalide of ['abc', -1, 0, 'NaN', Infinity, '1e5']) refuse400(() => v.montant(invalide, 'm'))
  })

  test('entier borné (la chaîne "20000" devient un nombre)', () => {
    assert.equal(v.entier('20000', 'q', { min: 10000 }), 20000)
    refuse400(() => v.entier(1.5, 'q'))
    refuse400(() => v.entier(50, 'q', { min: 10000 }))
  })

  test('booléen strict ("false" vaut faux, le reste est refusé)', () => {
    assert.equal(v.booleen('false', 'b'), false)
    assert.equal(v.booleen(true, 'b'), true)
    refuse400(() => v.booleen('oui', 'b'))
    refuse400(() => v.booleen(1, 'b'))
  })

  test('PIN : exactement 4 chiffres en chaîne', () => {
    assert.equal(v.pin('0123', 'pin'), '0123')
    for (const invalide of [' 123', '1e10', '0x1F', 1234, '12345']) refuse400(() => v.pin(invalide, 'pin'))
  })

  test('pays, devise et énumération normalisés en majuscules', () => {
    assert.equal(v.paysISO('fr', 'p'), 'FR')
    assert.equal(v.devise('xaf', 'd'), 'XAF')
    assert.equal(v.enumeration('busy', 'c', { valeurs: ['BUSY'] }), 'BUSY')
    refuse400(() => v.paysISO('FRA', 'p'))
    assert.throws(() => v.enumeration('X', 'c', { valeurs: ['BUSY'] }), (e) => e.statut === 400 && e.details.valides.includes('BUSY'))
  })

  test('champs manquants listés', () => {
    assert.throws(() => v.exigerChamps({ a: 1, b: ' ' }, ['a', 'b', 'c']), (e) => e.statut === 400 && e.details.manquants.join() === 'b,c')
  })

  test('pagination bornée', () => {
    assert.deepEqual(v.pagination({}), { limit: 50, offset: 0 })
    assert.deepEqual(v.pagination({ limit: '10', offset: '20' }), { limit: 10, offset: 20 })
    refuse400(() => v.pagination({ limit: '0' }))
    refuse400(() => v.pagination({ limit: '201' }))
    refuse400(() => v.pagination({ offset: '-1' }))
  })
})

describe('utils/numeros', () => {
  test('décalage sans perte de zéros ni de « + »', () => {
    assert.equal(decalerNumero('+33700000099', 1), '+33700000100')
    assert.equal(decalerNumero('0612000009', 1), '0612000010')
    assert.equal(decalerNumero('+966500000999', 20000), '+966500020999')
  })

  test('dépassement de largeur ou format invalide → null', () => {
    assert.equal(decalerNumero('999', 1), null)
    assert.equal(decalerNumero('abc', 1), null)
    assert.equal(decalerNumero(null, 1), null)
  })

  test('comparaison', () => {
    assert.equal(comparerNumeros('+33700000100', '+33700000099'), 1)
    assert.equal(comparerNumeros('+33700000001', '+33700000001'), 0)
  })
})

describe('utils/limiteur', () => {
  test('fenêtre fixe : au-delà du maximum, refus jusqu\'à la fenêtre suivante', () => {
    const compteur = new CompteurFenetre({ fenetreMs: 1000, max: 2 })
    assert.equal(compteur.consommer('ip', 0).autorise, true)
    assert.equal(compteur.consommer('ip', 10).autorise, true)
    assert.equal(compteur.consommer('ip', 20).autorise, false)
    assert.equal(compteur.consommer('ip', 1000).autorise, true)
  })

  test('verrouillage après échecs puis déverrouillage', () => {
    const verrou = new VerrouTentatives({ maxEchecs: 3, fenetreMs: 1000, dureeBlocageMs: 5000 })
    assert.equal(verrou.enregistrerEchec('u', 0).bloque, false)
    assert.equal(verrou.enregistrerEchec('u', 1).echecsRestants, 1)
    assert.equal(verrou.enregistrerEchec('u', 2).bloque, true)
    assert.equal(verrou.etat('u', 3000).bloque, true)
    assert.equal(verrou.etat('u', 5003).bloque, false)
    verrou.enregistrerEchec('v', 0)
    verrou.reinitialiser('v')
    assert.equal(verrou.enregistrerEchec('v', 1).echecsRestants, 2)
  })
})

describe('utils/logger', () => {
  test('masquage des numéros et des clés sensibles', () => {
    assert.equal(logger.masquerTelephone('+33612345678'), '+33*******78')
    assert.doesNotMatch(logger.masquerTexte('Key (phone_number)=(+33612345678) already exists'), /612345/)
    const nettoye = logger.nettoyer({ pin: '1234', pin_hash: 'h', nom: 'Awa', profond: { access_token: 't' } })
    assert.deepEqual(nettoye, { pin: '[masqué]', pin_hash: '[masqué]', nom: 'Awa', profond: { access_token: '[masqué]' } })
  })
})
