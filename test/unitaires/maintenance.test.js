'use strict'

const { describe, test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { preparer } = require('../helpers/contexte')

const U = 'a0000000-0000-4000-8000-000000000001'
const MAINTENANT = new Date('2026-11-21T12:00:00Z')
const ilYa = (jours) => new Date(MAINTENANT.getTime() - jours * 86400000)
const jour = (jours) => ilYa(jours).toISOString().slice(0, 10)

const { faux, requerir } = preparer()
const maintenance = requerir('src/taches/maintenance')
const planificateur = requerir('src/taches/planificateur')
const { verifierSchema, verifierTable, analyserCleSupabase } = requerir('src/outils/verificationSchema')
const { SCHEMA_ATTENDU } = requerir('src/outils/schemaAttendu')
const { creerFauxSupabase } = require('../helpers/fauxSupabase')

describe('maintenance — voyages échus', () => {
  beforeEach(() => faux.reinitialiser({
    trip_declaration: [
      // retour dépassé de 3 jours, arrivé : clôturé
      { declaration_id: 'v1', user_id: U, status: 'CONFIRMED', return_date: jour(3), number_id: 'n1' },
      // retour d'hier : délai de grâce de 2 jours, conservé
      { declaration_id: 'v2', user_id: U, status: 'CONFIRMED', return_date: jour(1), number_id: 'n2' },
      // jamais arrivé, retour dépassé : annulé
      { declaration_id: 'v3', user_id: U, status: 'PENDING', return_date: jour(5), number_id: 'n3' },
      // jamais arrivé, sans date de retour, départ il y a 40 jours : annulé
      { declaration_id: 'v4', user_id: U, status: 'PENDING', return_date: null, departure_date: jour(40), number_id: 'n4' },
      // départ il y a 10 jours, sans retour : conservé
      { declaration_id: 'v5', user_id: U, status: 'PENDING', return_date: null, departure_date: jour(10), number_id: 'n5' },
      // autre voyage actif utilisant le numéro n3 : n3 ne doit pas être parqué
      { declaration_id: 'v6', user_id: U, status: 'PENDING', return_date: null, departure_date: jour(2), number_id: 'n3' },
      // voyage terminé auparavant : ignoré
      { declaration_id: 'v7', user_id: U, status: 'COMPLETED', return_date: jour(90), number_id: 'n7' }
    ],
    virtual_number: ['n1', 'n2', 'n3', 'n4', 'n5', 'n7'].map((id) => ({
      number_id: id, user_id: U, status: id === 'n1' ? 'ACTIVE' : 'AWAITING_ARRIVAL'
    })),
    esim_profile: [],
    session: [],
    audit_log: []
  }))

  const statut = (table, cle, id) => faux.tables[table].find((ligne) => ligne[cle] === id).status

  test('clôture, annulation et délai de grâce', async () => {
    const rapport = await maintenance.cloturerVoyagesEchus(MAINTENANT)
    assert.deepEqual(rapport, { voyagesTermines: 1, voyagesAnnules: 2, numerosParkes: 2 })
    assert.equal(statut('trip_declaration', 'declaration_id', 'v1'), 'COMPLETED')
    assert.equal(statut('trip_declaration', 'declaration_id', 'v2'), 'CONFIRMED')
    assert.equal(statut('trip_declaration', 'declaration_id', 'v3'), 'CANCELLED')
    assert.equal(statut('trip_declaration', 'declaration_id', 'v4'), 'CANCELLED')
    assert.equal(statut('trip_declaration', 'declaration_id', 'v5'), 'PENDING')
    assert.equal(statut('trip_declaration', 'declaration_id', 'v7'), 'COMPLETED')
  })

  test('numéros mis en parking seulement s\'ils ne servent à aucun autre voyage actif', async () => {
    await maintenance.cloturerVoyagesEchus(MAINTENANT)
    assert.equal(statut('virtual_number', 'number_id', 'n1'), 'PARKED')
    assert.equal(statut('virtual_number', 'number_id', 'n4'), 'PARKED')
    assert.equal(statut('virtual_number', 'number_id', 'n3'), 'AWAITING_ARRIVAL') // utilisé par v6
    assert.equal(statut('virtual_number', 'number_id', 'n2'), 'AWAITING_ARRIVAL')
  })

  test('idempotente : une seconde exécution ne change rien', async () => {
    await maintenance.cloturerVoyagesEchus(MAINTENANT)
    assert.deepEqual(await maintenance.cloturerVoyagesEchus(MAINTENANT), { voyagesTermines: 0, voyagesAnnules: 0, numerosParkes: 0 })
  })
})

describe('maintenance — forfaits eSIM et sessions', () => {
  beforeEach(() => faux.reinitialiser({
    trip_declaration: [],
    virtual_number: [],
    esim_profile: [
      { iccid: 'e1', status: 'ACTIVE', plan_type: 'DAY', activated_at: ilYa(2).toISOString() },
      { iccid: 'e2', status: 'ACTIVE', plan_type: 'WEEK', activated_at: ilYa(3).toISOString() },
      { iccid: 'e3', status: 'ACTIVE', plan_type: 'WEEK', activated_at: ilYa(8).toISOString() },
      { iccid: 'e4', status: 'ACTIVE', plan_type: 'MONTH', activated_at: ilYa(29).toISOString() },
      { iccid: 'e5', status: 'ACTIVE', plan_type: 'BYOE', activated_at: ilYa(400).toISOString() }
    ],
    session: [
      { refresh_token_hash: 's1', expires_at: ilYa(1).toISOString() },
      { refresh_token_hash: 's2', expires_at: new Date(MAINTENANT.getTime() + 86400000).toISOString() }
    ],
    audit_log: []
  }))

  test('forfaits échus expirés, BYOE jamais', async () => {
    assert.equal(await maintenance.expirerForfaitsESIM(MAINTENANT), 2)
    const statuts = Object.fromEntries(faux.tables.esim_profile.map((e) => [e.iccid, e.status]))
    assert.deepEqual(statuts, { e1: 'EXPIRED', e2: 'ACTIVE', e3: 'EXPIRED', e4: 'ACTIVE', e5: 'ACTIVE' })
  })

  test('sessions expirées purgées ; table absente tolérée', async () => {
    assert.equal(await maintenance.purgerSessionsExpirees(MAINTENANT), 1)
    assert.deepEqual(faux.tables.session.map((s) => s.refresh_token_hash), ['s2'])
    faux.forcerErreur('session', { code: 'PGRST205', message: 'Could not find the table' })
    assert.equal(await maintenance.purgerSessionsExpirees(MAINTENANT), 0)
  })

  test('une étape en échec n\'empêche pas les suivantes', async () => {
    faux.forcerErreur('trip_declaration', { code: 'XX000', message: 'panne' })
    const rapport = await maintenance.executerMaintenance({ maintenant: MAINTENANT })
    assert.equal(rapport.voyages, null)
    assert.equal(rapport.esimExpirees, 2)
    assert.equal(rapport.sessionsPurgees, 1)
  })

  test('planificateur : exécutions sans chevauchement, désactivé par défaut en test', async () => {
    const [premiere, seconde] = await Promise.all([planificateur.executerMaintenance(), planificateur.executerMaintenance()])
    assert.ok(premiere)
    assert.equal(seconde, null)
    assert.equal(planificateur.demarrerTachesPlanifiees(), false)
  })
})

describe('vérification du schéma réel', () => {
  // Schéma complet attendu, moins quelques éléments retirés pour le test.
  const colonnesDe = (table) => Object.keys(SCHEMA_ATTENDU.find((t) => t.table === table).colonnes)
  const schemaReel = Object.fromEntries(SCHEMA_ATTENDU.map(({ table }) => [table, colonnesDe(table)]))

  test('base conforme', async () => {
    const client = creerFauxSupabase({}, { schemas: schemaReel })
    const rapport = await verifierSchema(client)
    assert.equal(rapport.conforme, true)
    assert.ok(rapport.tables.every((t) => t.statut === 'OK'))
  })

  test('colonne indispensable manquante → bloquant ; colonne optionnelle → avertissement', async () => {
    const schemas = {
      ...schemaReel,
      users: colonnesDe('users').filter((c) => c !== 'deleted_at' && c !== 'role'),
      trip_declaration: colonnesDe('trip_declaration').filter((c) => c !== 'has_own_esim')
    }
    const client = creerFauxSupabase({}, { schemas })
    const rapport = await verifierSchema(client)
    assert.equal(rapport.conforme, false)
    assert.deepEqual(rapport.bloquants, ['users'])
    const users = rapport.tables.find((t) => t.table === 'users')
    assert.deepEqual(users.colonnesManquantes.map(({ nom, obligatoire }) => ({ nom, obligatoire })), [
      { nom: 'deleted_at', obligatoire: true },
      { nom: 'role', obligatoire: false }
    ])
    assert.equal(users.colonnesManquantes[0].impact, null)
    assert.match(users.colonnesManquantes[1].impact, /ADMIN_USER_IDS/) // impact expliqué
    assert.equal(rapport.tables.find((t) => t.table === 'trip_declaration').statut, 'INCOMPLETE')
  })

  test('table optionnelle absente : signalée sans bloquer ; table indispensable absente : bloquante', async () => {
    const client = creerFauxSupabase({}, { schemas: schemaReel })
    client.forcerErreur('session', { code: 'PGRST205', message: 'Could not find the table' })
    client.forcerErreur('currency_transaction', { code: '42P01', message: 'relation does not exist' })
    const rapport = await verifierSchema(client)
    const session = rapport.tables.find((t) => t.table === 'session')
    assert.deepEqual([session.statut, session.optionnelle], ['ABSENTE', true])
    assert.deepEqual(rapport.bloquants, ['currency_transaction'])
  })

  test('accès refusé (RLS / droits) signalé', async () => {
    const client = creerFauxSupabase({}, { schemas: schemaReel })
    client.forcerErreur('users', { code: '42501', message: 'permission denied' })
    const resultat = await verifierTable(client, SCHEMA_ATTENDU.find((t) => t.table === 'users'))
    assert.equal(resultat.statut, 'ACCES_REFUSE')
  })

  test('aucune écriture ni lecture de lignes (SELECT … LIMIT 0 uniquement)', async () => {
    const client = creerFauxSupabase({ users: [{ user_id: 'x', phone_number: '+33600000000' }] }, { schemas: schemaReel })
    await verifierSchema(client)
    assert.ok(client.journal.every((appel) => appel.operation === 'select'))
  })

  test('type de clé Supabase détecté sans l\'afficher', () => {
    const jwt = (role) => `entete.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`
    assert.equal(analyserCleSupabase(jwt('service_role')).adapteeAuServeur, true)
    assert.equal(analyserCleSupabase(jwt('anon')).adapteeAuServeur, false)
    assert.equal(analyserCleSupabase('sb_secret_abc').type, 'secret')
    assert.equal(analyserCleSupabase('sb_publishable_abc').adapteeAuServeur, false)
    assert.equal(analyserCleSupabase('n-importe-quoi').type, 'inconnu')
  })
})
