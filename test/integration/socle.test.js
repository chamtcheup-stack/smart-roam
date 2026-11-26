'use strict'

const { describe, test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { preparer, demarrerApp } = require('../helpers/contexte')

const { faux, requerir } = preparer({
  tables: { country: [{ country_iso: 'CM', data_region: 'af-south-1', did_enabled: true }], users: [], session: [], fraud_profile: [] }
})
const { reinitialiserEtatWAF } = requerir('src/algorithms/algo13_detectionWAF')

let app
before(async () => { app = await demarrerApp(requerir) })
after(() => app.arreter())
beforeEach(() => reinitialiserEtatWAF())

describe('supervision', () => {
  test('GET / et liveness', async () => {
    assert.equal((await app.appel('GET', '/')).json.message, 'Serveur Smart Roam opérationnel')
    assert.equal((await app.appel('GET', '/api/health')).json.statut, 'ok')
  })

  test('readiness : 200 si la base répond, 503 sinon', async () => {
    assert.equal((await app.appel('GET', '/api/ready')).statut, 200)
    faux.forcerErreur('country', { code: '08006', message: 'connexion perdue' })
    const indisponible = await app.appel('GET', '/api/ready')
    faux.retirerErreur('country')
    assert.deepEqual([indisponible.statut, indisponible.json.base], [503, 'injoignable'])
  })
})

describe('erreurs au format JSON', () => {
  test('route inconnue → 404 JSON', async () => {
    const reponse = await app.appel('GET', '/api/inexistant?x=1')
    assert.equal(reponse.statut, 404)
    assert.deepEqual(reponse.json, { erreur: 'Route introuvable', methode: 'GET', chemin: '/api/inexistant' })
  })

  test('JSON malformé → 400 JSON (et non une page HTML)', async () => {
    const reponse = await app.appel('POST', '/api/auth/login', { brut: '{"phoneNumber": ' })
    assert.deepEqual([reponse.statut, reponse.json.erreur], [400, 'Corps de requête JSON invalide'])
  })

  test('requête sans corps (Express 5) → 400 explicite, pas de plantage', async () => {
    const reponse = await app.appel('POST', '/api/auth/login')
    assert.equal(reponse.statut, 400)
    assert.deepEqual(reponse.json.manquants, ['phoneNumber', 'pin'])
  })

  test('erreur de base → 500 générique avec référence, sans détail SQL', async () => {
    faux.forcerErreur('users', { code: 'XX000', message: 'relation interne colonne +33612345678' })
    const reponse = await app.appel('POST', '/api/users/register', { corps: { phoneNumber: '+237699111222', countryResidence: 'CM' } })
    faux.retirerErreur('users')
    assert.equal(reponse.statut, 500)
    assert.equal(reponse.json.erreur, 'Erreur serveur')
    assert.ok(reponse.json.reference)
    assert.doesNotMatch(JSON.stringify(reponse.json), /relation|612345/)
  })
})

describe('traçage des requêtes', () => {
  test('identifiant de requête généré, ou repris s\'il est valide', async () => {
    const genere = await app.appel('GET', '/api/health')
    assert.match(genere.entetes.get('x-request-id'), /^[0-9a-f-]{36}$/)
    const repris = await app.appel('GET', '/api/health', { entetes: { 'x-request-id': 'proxy-1234-abcd' } })
    assert.equal(repris.entetes.get('x-request-id'), 'proxy-1234-abcd')
    const invalide = await app.appel('GET', '/api/health', { entetes: { 'x-request-id': '<script>' } })
    assert.notEqual(invalide.entetes.get('x-request-id'), '<script>')
  })

  test('la référence d\'une erreur 500 est l\'identifiant de requête', async () => {
    faux.forcerErreur('users', { code: 'XX000', message: 'panne' })
    const reponse = await app.appel('POST', '/api/users/register', {
      entetes: { 'x-request-id': 'requete-erreur-0001' },
      corps: { phoneNumber: '+237699111333', countryResidence: 'CM' }
    })
    faux.retirerErreur('users')
    assert.deepEqual([reponse.statut, reponse.json.reference], [500, 'requete-erreur-0001'])
  })

  test('spécification OpenAPI servie hors production', async () => {
    const reponse = await fetch(`${app.base}/api/docs/openapi.yaml`)
    assert.equal(reponse.status, 200)
    assert.match(await reponse.text(), /^openapi: 3\.1\.0/)
  })

  test('base trop lente → 503 explicite', async () => {
    faux.forcerErreur('users', { code: '', message: 'AbortError: Délai de 8000 ms dépassé' })
    const reponse = await app.appel('POST', '/api/users/register', { corps: { phoneNumber: '+237699111444', countryResidence: 'CM' } })
    faux.retirerErreur('users')
    assert.equal(reponse.statut, 503)
    assert.match(reponse.json.erreur, /momentanément indisponible/)
  })
})

describe('durcissement HTTP', () => {
  test('en-têtes de sécurité, pas de x-powered-by, pas de cache', async () => {
    const { entetes } = await app.appel('GET', '/api/health')
    assert.equal(entetes.get('x-content-type-options'), 'nosniff')
    assert.equal(entetes.get('x-frame-options'), 'DENY')
    assert.equal(entetes.get('cache-control'), 'no-store')
    assert.equal(entetes.get('x-powered-by'), null)
  })

  test('CORS : origine de développement autorisée, origine inconnue refusée', async () => {
    const autorisee = await app.appel('GET', '/api/health', { entetes: { origin: 'http://localhost:5173' } })
    assert.equal(autorisee.entetes.get('access-control-allow-origin'), 'http://localhost:5173')
    const refusee = await app.appel('GET', '/api/health', { entetes: { origin: 'https://site-malveillant.example' } })
    assert.equal(refusee.entetes.get('access-control-allow-origin'), null)
  })
})

describe('pare-feu applicatif (middleware)', () => {
  test('injection SQL → 403, puis IP en liste noire avec Retry-After', async () => {
    const injection = await app.appel('POST', '/api/auth/login', { corps: { phoneNumber: "+33600000001' OR '1'='1", pin: '0000' } })
    assert.deepEqual([injection.statut, injection.json.raison], [403, 'INJECTION_SQL_DETECTEE'])
    const suivante = await app.appel('GET', '/api/health')
    assert.deepEqual([suivante.statut, suivante.json.raison], [403, 'IP_EN_LISTE_NOIRE'])
    assert.ok(Number(suivante.entetes.get('retry-after')) > 3000)
  })

  test('XSS dans l\'URL → 403', async () => {
    const reponse = await app.appel('GET', '/api/health?q=<script>alert(1)</script>')
    assert.deepEqual([reponse.statut, reponse.json.raison], [403, 'INJECTION_XSS_DETECTEE'])
  })

  test('requête légitime avec apostrophes et tirets → autorisée', async () => {
    const reponse = await app.appel('POST', '/api/auth/login', { corps: { phoneNumber: '+33 6-12-34-56-78', pin: '4821', deviceId: 'Téléphone d\'Awa' } })
    assert.equal(reponse.statut, 401) // identifiants inconnus, mais pas bloqué par le WAF
  })
})
