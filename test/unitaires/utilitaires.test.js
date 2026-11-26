'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { createClient } = require('@supabase/supabase-js')
const { preparer } = require('../helpers/contexte')

const { requerir } = preparer()
const v = requerir('src/utils/validation')
const { decalerNumero, comparerNumeros } = requerir('src/utils/numeros')
const { CompteurFenetre, VerrouTentatives, VerrouProgressif } = requerir('src/utils/limiteur')
const { executerEnExclusion, nombreClesActives } = requerir('src/utils/exclusion')
const { creerFetchAvecDelai } = requerir('src/utils/fetchDelai')
const { estDelaiDepasse, donnees } = requerir('src/utils/db')
const logger = requerir('src/utils/logger')

const MINUTE = 60 * 1000
const HEURE = 60 * MINUTE

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

describe('utils/limiteur — compléments du bloc 7', () => {
  test('lecture d\'un compteur sans incrément', () => {
    const compteur = new CompteurFenetre({ fenetreMs: 1000, max: 2 })
    assert.deepEqual(compteur.lire('ip', 0), { compte: 0, depasse: false, reessayerDansSecondes: 0 })
    compteur.consommer('ip', 0)
    compteur.consommer('ip', 0)
    assert.equal(compteur.lire('ip', 10).depasse, true)
    assert.equal(compteur.lire('ip', 10).compte, 2) // la lecture n'a rien consommé
    assert.equal(compteur.lire('ip', 1000).depasse, false)
  })

  test('verrou progressif : 15 min, 1 h, 4 h, puis 24 h', () => {
    const verrou = new VerrouProgressif()
    let t = 0
    const cinqEchecs = () => {
      let dernier
      for (let i = 0; i < 5; i++) dernier = verrou.enregistrerEchec('compte', t)
      return dernier
    }
    const durees = []
    for (let palier = 0; palier < 5; palier++) {
      const blocage = cinqEchecs()
      assert.equal(blocage.bloque, true)
      durees.push(blocage.reessayerDansSecondes)
      assert.equal(verrou.etat('compte', t + 1000).bloque, true)
      t += blocage.reessayerDansSecondes * 1000 // attendre la fin du blocage
      assert.equal(verrou.etat('compte', t).bloque, false)
    }
    assert.deepEqual(durees, [15 * 60, 60 * 60, 4 * 60 * 60, 24 * 60 * 60, 24 * 60 * 60])
  })

  test('verrou progressif : oubli après 24 h sans blocage, remise à zéro après une réussite', () => {
    const verrou = new VerrouProgressif()
    for (let i = 0; i < 5; i++) verrou.enregistrerEchec('a', 0)
    let blocage
    for (let i = 0; i < 5; i++) blocage = verrou.enregistrerEchec('a', 15 * MINUTE + 1)
    assert.equal(blocage.reessayerDansSecondes, 60 * 60) // second palier
    const longtempsApres = 15 * MINUTE + 1 + 26 * HEURE
    for (let i = 0; i < 5; i++) blocage = verrou.enregistrerEchec('a', longtempsApres)
    assert.equal(blocage.reessayerDansSecondes, 15 * 60) // niveau oublié

    for (let i = 0; i < 4; i++) verrou.enregistrerEchec('b', 0)
    verrou.reinitialiser('b')
    assert.equal(verrou.enregistrerEchec('b', 1).echecsRestants, 4)
  })
})

describe('utils/exclusion', () => {
  test('les opérations d\'une même clé s\'exécutent l\'une après l\'autre', async () => {
    const journal = []
    const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const operation = (nom, ms) => async () => {
      journal.push(`debut ${nom}`)
      await attendre(ms)
      journal.push(`fin ${nom}`)
      return nom
    }
    const resultats = await Promise.all([
      executerEnExclusion('u1', operation('A', 20)),
      executerEnExclusion('u1', operation('B', 1)),
      executerEnExclusion('u2', operation('C', 1))
    ])
    assert.deepEqual(resultats, ['A', 'B', 'C'])
    assert.ok(journal.indexOf('fin A') < journal.indexOf('debut B'), journal.join(' | '))
    assert.ok(journal.indexOf('fin C') < journal.indexOf('fin A')) // autre clé : pas d'attente
    assert.equal(nombreClesActives(), 0)
  })

  test('une erreur libère la clé', async () => {
    await assert.rejects(executerEnExclusion('u3', async () => { throw new Error('échec') }))
    assert.equal(await executerEnExclusion('u3', async () => 'suite'), 'suite')
  })
})

describe('utils/fetchDelai — délai maximal des appels Supabase', () => {
  const serveurMuet = async () => {
    const serveur = http.createServer(() => { /* ne répond jamais */ }).listen(0)
    await new Promise((resolve) => serveur.once('listening', resolve))
    return { serveur, url: `http://127.0.0.1:${serveur.address().port}` }
  }
  const fermer = (serveur) => new Promise((resolve) => {
    serveur.closeAllConnections()
    serveur.close(() => resolve())
  })

  test('requête abandonnée au-delà du délai (AbortError)', async () => {
    const { serveur, url } = await serveurMuet()
    const debut = Date.now()
    await assert.rejects(creerFetchAvecDelai(150)(url), (erreur) => erreur.name === 'AbortError')
    assert.ok(Date.now() - debut < 2000)
    await fermer(serveur)
  })

  test('client Supabase réel : échec rapide, sans nouvelles tentatives, converti en 503', async () => {
    const { serveur, url } = await serveurMuet()
    const client = createClient(url, 'cle-de-test', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: creerFetchAvecDelai(200) }
    })
    const debut = Date.now()
    const resultat = await client.from('users').select('*').limit(1)
    const duree = Date.now() - debut
    await fermer(serveur)

    assert.ok(resultat.error)
    assert.equal(estDelaiDepasse(resultat.error), true)
    assert.ok(duree < 1500, `${duree} ms : des nouvelles tentatives ont cumulé les délais`)
    assert.throws(() => donnees(resultat, 'test'), (erreur) => erreur.statut === 503 && erreur.expose === true)
  })
})

describe('utils/db — insertion tolérante au schéma réel', () => {
  const { creerFauxSupabase } = require('../helpers/fauxSupabase')
  const { extraireColonneAbsente, insererAvecColonnesOptionnelles } = requerir('src/utils/db')
  const { analyserCleSupabase } = requerir('src/utils/cleSupabase')

  test('nom de colonne extrait des messages PostgREST et PostgreSQL', () => {
    assert.equal(extraireColonneAbsente({ message: "Could not find the 'user_origin_type' column of 'users' in the schema cache" }), 'user_origin_type')
    assert.equal(extraireColonneAbsente({ message: 'column esim_profile.created_at does not exist' }), 'created_at')
    assert.equal(extraireColonneAbsente({ message: 'column "details" of relation "audit_log" does not exist' }), 'details')
    assert.equal(extraireColonneAbsente({ message: 'autre erreur' }), null)
  })

  test('seules les colonnes optionnelles absentes sont retirées, puis mémorisées', async () => {
    const client = creerFauxSupabase({ t1: [] }, { schemas: { t1: ['a', 'b', 'c'] } })
    const ligne = { a: 1, b: 2, c: 3, x: 4, y: 5 }
    const { data, error } = await insererAvecColonnesOptionnelles(client, 't1', ligne, ['b', 'x', 'y'])
    assert.equal(error, null)
    assert.deepEqual([data.a, data.b, data.c, 'x' in data, 'y' in data], [1, 2, 3, false, false])
    const essais = client.journal.filter((appel) => appel.operation === 'insert').length
    assert.equal(essais, 3) // x puis y découverts absents
    await insererAvecColonnesOptionnelles(client, 't1', ligne, ['b', 'x', 'y'])
    assert.equal(client.journal.filter((appel) => appel.operation === 'insert').length, essais + 1) // mémorisées
  })

  test('colonne indispensable absente : erreur remontée, rien de retiré', async () => {
    const client = creerFauxSupabase({ t2: [] }, { schemas: { t2: ['a'] } })
    const { error } = await insererAvecColonnesOptionnelles(client, 't2', { a: 1, obligatoire: 2 }, [])
    assert.equal(error.code, 'PGRST204')
  })

  test('type de clé Supabase', () => {
    assert.equal(analyserCleSupabase('sb_publishable_x').adapteeAuServeur, false)
    assert.equal(analyserCleSupabase('sb_secret_x').adapteeAuServeur, true)
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
