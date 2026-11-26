'use strict'

const { describe, test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { preparer, demarrerApp, CLE_SERVICE } = require('../helpers/contexte')

const U = 'a0000000-0000-4000-8000-000000000001'
const U2 = 'b0000000-0000-4000-8000-000000000002'
const NFR = 'c0000000-0000-4000-8000-000000000001'
const NJP = 'c0000000-0000-4000-8000-000000000002'
const POOL = 'd0000000-0000-4000-8000-000000000001'
const REGLE = 'e0000000-0000-4000-8000-000000000001'

const { faux, requerir } = preparer({
  tables: {
    users: [
      { user_id: U, phone_number: '+237699000001', country_of_residence: 'CM', kyc_status: 'VERIFIED', display_name: 'Awa Mbarga' },
      { user_id: U2, phone_number: '237699000002', country_of_residence: 'CM', kyc_status: 'PENDING' }
    ],
    country: [
      { country_iso: 'CM', name_fr: 'Cameroun', data_region: 'af-south-1', did_enabled: true, roaming_zone: 'AFRICA' },
      { country_iso: 'FR', name_fr: 'France', data_region: 'eu-west-1', did_enabled: true, roaming_zone: 'EU_FREE' },
      { country_iso: 'JP', name_fr: 'Japon', data_region: null, did_enabled: true, roaming_zone: 'ASIA' }
    ],
    virtual_number: [
      { number_id: NFR, user_id: U, country_iso: 'FR', did_number: '+33700000001', status: 'AWAITING_ARRIVAL', created_at: '2026-01-01T00:00:00Z' },
      { number_id: NJP, user_id: U, country_iso: 'JP', did_number: '+81700000001', status: 'PARKED', created_at: '2026-01-02T00:00:00Z' }
    ],
    did_pool: [{ pool_id: POOL, country_iso: 'FR', status: 'ACTIVE', range_start: '+33700000000', range_end: '+33700000099', total_numbers: 100, allocated_count: 2, reorder_status: null }],
    mvno_partner: [{ partner_id: 'm1', name: 'TopMobile', country_iso: 'FR', agreement_status: 'ACTIVE', failover_priority: 1, coverage_score: 0.9 }],
    forwarding_rule: [{ rule_id: REGLE, user_id: U, number_id: NFR, trigger_condition: 'BUSY', action: 'VOICEMAIL', target_number: null, priority: 1, is_active: true }],
    fraud_profile: [{ profile_id: 'fp', user_id: U, avg_transaction_amount: 0, avg_daily_transactions: 0, typical_countries: [], total_alerts: 0 }],
    currency_exchange_corridor: [{ corridor_id: 'cor1', source_currency: 'XAF', target_currency: 'EUR', is_active: true, circuit_breaker_status: 'OPEN', last_rate_checked: null }],
    esim_profile: [],
    trip_declaration: [],
    travel_history: [],
    session: [],
    audit_log: [],
    currency_transaction: [],
    data_sovereignty_consent: [],
    fraud_alert: []
  },
  contraintesUniques: { virtual_number: ['did_number'], users: ['phone_number'] }
})
const { genererTokens, genererJetonSensible } = requerir('src/algorithms/algo10_zeroTrustJWT')

let app
let jeton
let jetonSensible // obtenu en production par POST /api/security/pin/verify
before(async () => {
  app = await demarrerApp(requerir)
  jeton = (await genererTokens({ userId: U, role: 'USER' })).access_token
  jetonSensible = genererJetonSensible({ userId: U, role: 'USER', sessionId: 'session-de-test' }).access_token
})
after(() => app.arreter())

const actionsAuditees = () => faux.tables.audit_log.map((ligne) => `${ligne.entity_type}:${ligne.action}:${ligne.actor_type}`)

describe('utilisateurs', () => {
  test('validations d\'inscription', async () => {
    assert.equal((await app.appel('POST', '/api/users/register', { corps: { phoneNumber: '237 699 000 002', countryResidence: 'cm' } })).statut, 409)
    assert.equal((await app.appel('POST', '/api/users/register', { corps: { phoneNumber: 'abc', countryResidence: 'CM' } })).statut, 400)
    assert.equal((await app.appel('POST', '/api/users/register', { corps: { phoneNumber: '+237699123456', countryResidence: 'ZZ' } })).statut, 400)
  })

  test('profil en liste blanche ; KYC : compte inexistant 404, statut invalide 400 ; numéros paginés', async () => {
    const profil = await app.appel('GET', `/api/users/${U}`, { jeton })
    assert.equal(profil.json.user.display_name, 'Awa Mbarga')
    assert.equal('pin_hash' in profil.json.user, false)
    assert.equal((await app.appel('PUT', '/api/users/c0000000-0000-4000-8000-00000000dead/kyc', { cle: CLE_SERVICE, corps: { kycStatus: 'VERIFIED' } })).statut, 404)
    assert.ok((await app.appel('PUT', `/api/users/${U2}/kyc`, { cle: CLE_SERVICE, corps: { kycStatus: 'SUPER' } })).json.valides)
    const numeros = await app.appel('GET', `/api/users/${U}/numbers?limit=1`, { jeton })
    assert.deepEqual([numeros.json.numeros.length, numeros.json.total, numeros.json.limit], [1, 2, 1])
  })
})

describe('forwarding', () => {
  test('création : cible obligatoire, pas de boucle, priorité 0 conservée', async () => {
    const base = { numberId: NFR, triggerCondition: 'ALWAYS', action: 'FORWARD' }
    assert.equal((await app.appel('POST', '/api/forwarding/rules/create', { jeton, corps: base })).statut, 400)
    const boucle = await app.appel('POST', '/api/forwarding/rules/create', { jeton, corps: { ...base, targetNumber: '+33 7 00 00 00 01' } })
    assert.match(boucle.json.erreur, /boucle/)
    const creee = await app.appel('POST', '/api/forwarding/rules/create', { jeton, corps: { numberId: NFR, triggerCondition: 'no_answer', action: 'reject', priority: 0 } })
    assert.deepEqual([creee.statut, creee.json.regle.priority, creee.json.regle.trigger_condition], [201, 0, 'NO_ANSWER'])
  })

  test('modification (PUT) puis évaluation d\'un appel par la plateforme', async () => {
    assert.equal((await app.appel('PUT', `/api/forwarding/rules/${REGLE}`, { jeton, corps: {} })).statut, 400)
    assert.equal((await app.appel('PUT', `/api/forwarding/rules/${REGLE}`, { jeton, corps: { action: 'FORWARD' } })).statut, 400)
    const modifiee = await app.appel('PUT', `/api/forwarding/rules/${REGLE}`, { jeton, corps: { action: 'FORWARD', targetNumber: '+237699000001' } })
    assert.equal(modifiee.json.regle.target_number, '+237699000001')
    faux.tables.virtual_number[0].status = 'ACTIVE'
    const appel = await app.appel('POST', '/api/forwarding/evaluate', { cle: CLE_SERVICE, corps: { numeroAppele: '+33700000001', numeroAppelant: 'anonymous', statutLigne: 'busy' } })
    assert.deepEqual([appel.json.decision, appel.json.destination, appel.json.codeSIP], ['FORWARD', '+237699000001', '302 Moved Temporarily'])
    assert.equal((await app.appel('POST', '/api/forwarding/evaluate', { cle: CLE_SERVICE, corps: { numeroAppele: '+33700000001', numeroAppelant: 'x', statutLigne: 'DANSE' } })).statut, 400)
    faux.tables.virtual_number[0].status = 'AWAITING_ARRIVAL'
  })
})

describe('profil miroir et consentements', () => {
  test('retrait par la chaîne "false", sans doublon, nom retiré du numéro', async () => {
    const retrait = await app.appel('POST', '/api/mirror/consent', { jeton, corps: { paysDestination: 'fr', dataType: 'PROFILE', isGranted: 'false' } })
    assert.equal(retrait.json.consentement.is_granted, false)
    assert.equal((await app.appel('POST', '/api/mirror/consent', { jeton, corps: { paysDestination: 'FR', dataType: 'PROFILE', isGranted: 'peut-être' } })).statut, 400)
    assert.equal(faux.tables.virtual_number[0].mirror_display_name, 'Utilisateur Orange')
    await app.appel('POST', '/api/mirror/consent', { jeton, corps: { paysDestination: 'FR', dataType: 'PROFILE' } })
    assert.equal(faux.tables.data_sovereignty_consent.length, 1)
    assert.ok(actionsAuditees().includes('CONSENT:CONSENTEMENT_RETIRE_PROFILE_FR:USER'))
  })

  test('synchronisation : nom réel, badge KYC, jamais le téléphone', async () => {
    const synchro = await app.appel('POST', '/api/mirror/sync', { jeton, corps: { numberId: NFR } })
    assert.deepEqual([synchro.json.numero.mirror_display_name, synchro.json.badgeKYC], ['Awa Mbarga', 'KYC_VERIFIE'])
    assert.doesNotMatch(JSON.stringify(synchro.json.profilMiroir), /699000001/)
  })
})

describe('géolocalisation', () => {
  test('validations et décodage', async () => {
    assert.equal((await app.appel('POST', '/api/geolocalisation/ssid', { jeton, corps: { ssid: 1234 } })).statut, 400)
    assert.equal((await app.appel('POST', '/api/geolocalisation/mccmnc', { jeton, corps: { mcc: '20' } })).statut, 400)
    const mcc = await app.appel('POST', '/api/geolocation/mccmnc', { jeton, corps: { mcc: '624', mnc: '07' } })
    assert.deepEqual([mcc.json.pays, mcc.json.confiance], ['CM', 80])
  })

  test('arrivée détectée à partir des signaux bruts → numéro activé', async () => {
    faux.tables.trip_declaration.push({ declaration_id: 'f0000000-0000-4000-8000-0000000000aa', user_id: U, destination_country: 'FR', status: 'PENDING', declaration_time: new Date().toISOString(), number_id: NFR })
    assert.equal((await app.appel('POST', '/api/geolocalisation/arrivee', { jeton, corps: {} })).statut, 400)
    // Cellule de départ connue, puis nouvelle cellule confirmée à l'arrivée (contribution Cell-ID de 30).
    assert.equal((await app.appel('POST', '/api/geolocalisation/cellid', { jeton, corps: { cellId: 'CM-624-02-1' } })).json.action, 'PREMIER_CELL_ID')
    const arrivee = await app.appel('POST', '/api/geolocalisation/arrivee', { jeton, corps: { mcc: '208', mnc: '01', ssid: 'CDG_WIFI', cellId: 4242, cellIdConfirmation: 4242, paysIP: 'fr' } })
    assert.deepEqual([arrivee.json.decision, arrivee.json.scoreConfiance], ['ARRIVEE_CONFIRMEE', 100])
    assert.equal(faux.tables.virtual_number[0].status, 'ACTIVE')
  })
})

describe('change de devises', () => {
  const demande = { deviseSource: 'XAF', deviseCible: 'EUR', montant: 100000 }

  test('aperçu au taux réel ; montant invalide refusé', async () => {
    const apercu = await app.appel('POST', '/api/currency/preview', { jeton, corps: demande })
    assert.equal(apercu.json.montantBrut, 152.45)
    assert.equal((await app.appel('POST', '/api/currency/preview', { jeton, corps: { ...demande, montant: 'abc' } })).statut, 400)
    assert.equal((await app.appel('POST', '/api/currency/confirm', { jeton: jetonSensible, corps: { ...demande, deviseSource: 'EUR', deviseCible: 'XAF' } })).statut, 400)
  })

  test('confirmation sans PIN confirmé → 401 CONFIRMATION_PIN_REQUISE', async () => {
    const refus = await app.appel('POST', '/api/currency/confirm', { jeton, corps: demande })
    assert.deepEqual([refus.statut, refus.json.code], [401, 'CONFIRMATION_PIN_REQUISE'])
    assert.equal(faux.tables.currency_transaction.length, 0)
  })

  test('confirmation idempotente : rejeu identique, corps différent refusé', async () => {
    const entetes = { 'idempotency-key': 'achat-2026-11-19-0001' }
    const premiere = await app.appel('POST', '/api/currency/confirm', { jeton: jetonSensible, entetes, corps: demande })
    assert.deepEqual([premiere.statut, premiere.json.controleFraude.statut], [201, 'NORMAL'])
    const rejeu = await app.appel('POST', '/api/currency/confirm', { jeton: jetonSensible, entetes, corps: demande })
    assert.equal(rejeu.entetes.get('idempotent-replayed'), 'true')
    assert.equal(rejeu.json.transaction.transaction_id, premiere.json.transaction.transaction_id)
    assert.equal(faux.tables.currency_transaction.length, 1)
    assert.equal((await app.appel('POST', '/api/currency/confirm', { jeton: jetonSensible, entetes, corps: { ...demande, montant: 200000 } })).statut, 422)
  })

  test('anti-fraude : montant anormal bloqué, aucune transaction créée', async () => {
    faux.tables.fraud_profile[0].avg_transaction_amount = 1000
    const bloquee = await app.appel('POST', '/api/currency/confirm', { jeton: jetonSensible, corps: { ...demande, montant: 900000 } })
    assert.equal(bloquee.statut, 403)
    assert.equal(faux.tables.currency_transaction.length, 1)
  })

  test('historique paginé et corridors', async () => {
    const historique = await app.appel('GET', `/api/currency/history/${U}?limit=1`, { jeton })
    assert.deepEqual([historique.json.total, historique.json.limit], [1, 1])
    assert.equal((await app.appel('GET', '/api/currency/corridors', { jeton })).json.total, 1)
  })
})

describe('eSIM, déclarations et prédiction', () => {
  test('eSIM : pays cohérent, provisioning unique, partenaire absent', async () => {
    assert.equal((await app.appel('POST', '/api/esim/provision', { jeton, corps: { numberId: NFR, paysISO: 'JP' } })).statut, 400)
    const esim = await app.appel('POST', '/api/esim/provision', { jeton, corps: { numberId: NFR, paysISO: 'FR', plan: 'month' } })
    assert.equal(esim.statut, 201)
    assert.match(esim.json.esim.iccid, /^8933\d{15}$/)
    const echeance = Date.parse(esim.json.esim.expire_le) - Date.parse(esim.json.esim.activated_at)
    assert.equal(Math.round(echeance / 86400000), 30) // forfait MONTH
    assert.equal((await app.appel('POST', '/api/esim/provision', { jeton, corps: { numberId: NFR, paysISO: 'FR' } })).statut, 200)
    assert.equal((await app.appel('POST', '/api/esim/provision', { jeton, corps: { numberId: NJP, paysISO: 'JP' } })).statut, 503)
  })

  test('déclaration : création, idempotence, annulation avec mise en parking', async () => {
    const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    assert.equal((await app.appel('POST', '/api/declarations/new', { jeton, corps: { paysISO: 'JP', dateDepart: '19/11/2026' } })).statut, 400)
    const creee = await app.appel('POST', '/api/declarations/new', { jeton, corps: { paysISO: 'JP', dateDepart: demain } })
    assert.deepEqual([creee.statut, creee.json.pays, creee.json.numeroVirtuel.status], [201, 'Japon', 'AWAITING_ARRIVAL'])
    assert.equal((await app.appel('POST', '/api/declarations/new', { jeton, corps: { paysISO: 'JP', dateDepart: demain } })).statut, 200)
    const id = 'f0000000-0000-4000-8000-0000000000bb'
    faux.tables.trip_declaration.find((d) => d.declaration_id === creee.json.declaration.declaration_id).declaration_id = id
    const annulee = await app.appel('PUT', `/api/declarations/${id}/cancel`, { jeton })
    assert.equal(annulee.json.declaration.status, 'CANCELLED')
    assert.equal(faux.tables.virtual_number.find((n) => n.number_id === NJP).status, 'PARKED')
    assert.match((await app.appel('PUT', `/api/declarations/${id}/cancel`, { jeton })).json.message, /déjà/)
  })

  test('prédiction : pays de résidence jamais suggéré ; retour de suggestion audité', async () => {
    faux.tables.travel_history = [
      { history_id: 'h1', user_id: U, country_iso: 'FR', arrival_detected_at: new Date().toISOString() },
      { history_id: 'h2', user_id: U, country_iso: 'FR', declaration_time: new Date().toISOString() },
      { history_id: 'h3', user_id: U, country_iso: 'CM', arrival_detected_at: new Date().toISOString() },
      { history_id: 'h4', user_id: U, country_iso: 'CM', arrival_detected_at: new Date().toISOString() }
    ]
    const suggestion = await app.appel('POST', '/api/prediction/suggest', { jeton })
    assert.deepEqual([suggestion.json.suggestion.paysISO, suggestion.json.suggestion.nomPays], ['FR', 'France'])
    await app.appel('POST', '/api/prediction/feedback', { jeton, corps: { paysISO: 'FR', acceptee: false } })
    assert.ok(faux.tables.audit_log.some((ligne) => ligne.action === 'SUGGESTION_REFUSEE_FR'))
  })
})

describe('stock (exploitation)', () => {
  test('réapprovisionnement : commande en attente exigée, addition numérique, plage étendue', async () => {
    assert.equal((await app.appel('PUT', `/api/stock/reorder/${POOL}`, { cle: CLE_SERVICE, corps: { quantite: 20000 } })).statut, 409)
    faux.tables.did_pool[0].reorder_status = 'REORDER_PENDING'
    assert.equal((await app.appel('PUT', `/api/stock/reorder/${POOL}`, { cle: CLE_SERVICE, corps: { quantite: 50 } })).statut, 400)
    const confirme = await app.appel('PUT', `/api/stock/reorder/${POOL}`, { cle: CLE_SERVICE, corps: { quantite: '20000' } })
    assert.equal(confirme.json.nouveauTotal, 20100)
    assert.equal(faux.tables.did_pool[0].range_end, '+33700020099')
  })

  test('contrôle par pays, JIT manuel, audit avec acteur', async () => {
    assert.equal((await app.appel('POST', '/api/stock/check', { cle: CLE_SERVICE, corps: { paysISO: 'BR' } })).statut, 404)
    assert.equal((await app.appel('POST', '/api/stock/check', { cle: CLE_SERVICE, corps: { paysISO: 'fr' } })).json.pools.length, 1)
    assert.ok(Array.isArray((await app.appel('POST', '/api/stock/jit/run', { cle: CLE_SERVICE })).json.rapport))
    assert.ok(actionsAuditees().some((a) => a.startsWith('STOCK:REAPPRO_CONFIRME') && a.endsWith(':SERVICE')))
  })

  test('pagination : limite hors bornes refusée', async () => {
    assert.equal((await app.appel('GET', '/api/stock/pools?limit=0', { cle: CLE_SERVICE })).statut, 400)
    assert.equal((await app.appel('GET', '/api/stock/pools?limit=500', { cle: CLE_SERVICE })).statut, 400)
  })
})
