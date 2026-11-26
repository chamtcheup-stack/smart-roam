'use strict'

// ════════════════════════════════════════════════════════════
// Mode démo : scénario complet joué sur la vraie API (base en mémoire
// de src/demo, aucune injection), rejouabilité, outils de simulation,
// garde-fous (jamais en production, routes absentes hors démo).
// ════════════════════════════════════════════════════════════

const { describe, test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('child_process')
const { preparerDemo, demarrerApp, RACINE } = require('../helpers/contexte')

const { requerir } = preparerDemo()
const { initialiserDemo } = requerir('src/demo/pilotageDemo')
const { executerScenario } = requerir('src/demo/scenario')
const { COMPTES_DEMO, ID } = requerir('src/demo/donneesDemo')

const compte = (cle) => COMPTES_DEMO.find((c) => c.cle === cle)

let app
before(async () => {
  await initialiserDemo()
  app = await demarrerApp(requerir)
})
after(() => app.arreter())

const connecter = async (cle) => {
  const { telephone, pin, deviceId } = compte(cle)
  const reponse = await app.appel('POST', '/api/auth/login', { corps: { phoneNumber: telephone, pin, deviceId } })
  assert.equal(reponse.statut, 200)
  return reponse.json.tokens.access_token
}

// Exécute un court script Node dans un processus séparé (configuration différente).
const executerIsole = (script, env) => spawnSync(process.execPath, ['-e', script], {
  cwd: RACINE,
  env: { ...process.env, LOG_LEVEL: 'silent', ...env },
  encoding: 'utf8'
})

describe('mode démo — scénario commenté', () => {
  test('chaque étape réussit, avec les résultats attendus', async () => {
    const { reussi, rapport, resultats, etat } = await executerScenario(app.appel)
    assert.equal(reussi, true, JSON.stringify(rapport.find((etape) => !etape.ok)))
    assert.equal(resultats.prediction.paysISO, 'FR')
    assert.equal(resultats.prediction.probabiliteValeur, 0.775)
    assert.equal(resultats.numeroFR, '+33639980007') // numéro persistant réutilisé
    assert.equal(resultats.escale, 'ESCALE_IGNOREE')
    assert.equal(resultats.scoreArrivee, 100)
    assert.equal(resultats.esim.partenaire, 'Démo Alpha Mobile')
    assert.deepEqual(resultats.appels, ['RING', 'VOICEMAIL', 'FORWARD'])
    assert.equal(resultats.conversion.controleFraude, 'NORMAL')
    assert.equal(resultats.statutApresRetour, 'PARKED')
    assert.deepEqual(resultats.fraude, { statutTentative: 403, statutNumero: 'SUSPENDED' })
    assert.equal(resultats.support, 'ACTIVE')
    assert.deepEqual(resultats.stock, { avant: 0.905, apres: 0.4525 })
    assert.equal(etat.alertesFraude, 1)
    assert.ok(etat.evenementsAudit > 0)
  })

  test('rejouable : la remise à zéro restaure aussi les comptes créés pendant la démo', async () => {
    const { reussi, rapport } = await executerScenario(app.appel)
    assert.equal(reussi, true, JSON.stringify(rapport.find((etape) => !etape.ok)))
  })
})

describe('mode démo — outils et contrôles', () => {
  test('remise à zéro : les jetons déjà émis sont refusés', async () => {
    const jeton = await connecter('awa')
    assert.equal((await app.appel('GET', `/api/users/${ID.awa}`, { jeton })).statut, 200)
    assert.equal((await app.appel('POST', '/api/demo/reinitialiser')).statut, 200)
    const apres = await app.appel('GET', `/api/users/${ID.awa}`, { jeton })
    assert.deepEqual([apres.statut, apres.json.code], [401, 'TOKENS_REVOQUES'])
  })

  test('le mode démo est signalé sur chaque réponse', async () => {
    const sante = await app.appel('GET', '/api/health')
    assert.equal(sante.entetes.get('x-smart-roam-mode'), 'demo')
    assert.equal(sante.json.mode, 'demo')
    const info = await app.appel('GET', '/api/demo')
    assert.equal(info.json.comptes.length, 3)
    assert.ok(info.json.scenario.length >= 15)
  })

  test('signaux simulés : pays connus seulement, nouvelle antenne à chaque lecture', async () => {
    const premiere = await app.appel('GET', '/api/demo/signaux/FR')
    const seconde = await app.appel('GET', '/api/demo/signaux/fr')
    assert.deepEqual([premiere.json.signaux.mcc, premiere.json.signaux.ssid, premiere.json.signaux.paysIP], ['208', 'CDG_WIFI', 'FR'])
    assert.notEqual(premiere.json.signaux.cellId, seconde.json.signaux.cellId)
    assert.equal((await app.appel('GET', '/api/demo/signaux/JP')).statut, 404)
  })

  test('appel entrant simulé : authentifié, limité à ses propres numéros', async () => {
    assert.equal((await app.appel('POST', '/api/demo/appel-entrant', { corps: { numberId: ID.numeroAwaFR } })).statut, 401)
    const jeton = await connecter('awa')
    assert.equal((await app.appel('POST', '/api/demo/appel-entrant', { jeton, corps: { numberId: ID.numeroMoussaBE } })).statut, 404)
    assert.equal((await app.appel('POST', '/api/demo/appel-entrant', { jeton, corps: {} })).statut, 400)
    assert.equal((await app.appel('POST', '/api/demo/appel-entrant', { jeton, corps: { numberId: ID.numeroAwaFR, statutLigne: 'HORS_LIGNE' } })).statut, 400)
    // Numéro en parking entre deux voyages : l'appel n'aboutit pas.
    const parking = await app.appel('POST', '/api/demo/appel-entrant', { jeton, corps: { numberId: ID.numeroAwaFR } })
    assert.deepEqual([parking.statut, parking.json.decision, parking.json.statutNumero], [200, 'REJECT', 'PARKED'])
    // Le support peut simuler un appel vers n'importe quel numéro.
    const support = await connecter('support')
    const moussa = await app.appel('POST', '/api/demo/appel-entrant', { jeton: support, corps: { numeroAppele: '+32460990042', statutLigne: 'NO_ANSWER' } })
    assert.deepEqual([moussa.statut, moussa.json.decision], [200, 'VOICEMAIL'])
  })

  test('avatars fictifs en SVG', async () => {
    const reponse = await fetch(`${app.base}/api/demo/avatars/awa.svg`)
    assert.equal(reponse.status, 200)
    assert.match(reponse.headers.get('content-type'), /image\/svg\+xml/)
    assert.match(await reponse.text(), />AN<\/text>/)
    assert.equal((await fetch(`${app.base}/api/demo/avatars/inconnu.svg`)).status, 404)
  })

  test('aucune base réelle : la base de démo en mémoire remplace Supabase', () => {
    assert.equal(requerir('src/supabase'), requerir('src/demo/baseDemo'))
  })
})

describe('relecture : routes de l\'application mobile et corrections', () => {
  before(async () => {
    assert.equal((await app.appel('POST', '/api/demo/reinitialiser')).statut, 200)
  })

  test('liste publique des pays (inscription, destinations)', async () => {
    const reponse = await app.appel('GET', '/api/pays')
    assert.equal(reponse.statut, 200)
    assert.deepEqual(reponse.json.pays.find((p) => p.code === 'FR'), { code: 'FR', nom: 'France', numerosDisponibles: true, zoneRoaming: 'EU_FREE' })
    assert.equal(reponse.json.pays.find((p) => p.code === 'CM').numerosDisponibles, false)
  })

  test('connexion : rôle et nom affiché renvoyés', async () => {
    const { telephone, pin } = compte('support')
    const reponse = await app.appel('POST', '/api/auth/login', { corps: { phoneNumber: telephone, pin } })
    assert.deepEqual([reponse.json.user.role, reponse.json.user.display_name], ['ADMIN', 'Support Orange (démo)'])
  })

  test('nom affiché modifié : profils miroir déjà publiés resynchronisés', async () => {
    const jeton = await connecter('moussa')
    assert.equal((await app.appel('PUT', `/api/users/${ID.moussa}`, { jeton, corps: { displayName: '1234' } })).statut, 400)
    const reponse = await app.appel('PUT', `/api/users/${ID.moussa}`, { jeton, corps: { displayName: 'Moussa N\'Diaye' } })
    assert.deepEqual([reponse.statut, reponse.json.user.display_name, reponse.json.profilsMiroirSynchronises], [200, 'Moussa N\'Diaye', 1])
    const numeros = await app.appel('GET', `/api/users/${ID.moussa}/numbers`, { jeton })
    assert.equal(numeros.json.numeros[0].mirror_display_name, 'Moussa N\'Diaye')
    assert.equal((await app.appel('PUT', `/api/users/${ID.awa}`, { jeton, corps: { displayName: 'Intrus' } })).statut, 403)
  })

  test('consentements consultables, avec leur état', async () => {
    const jeton = await connecter('moussa')
    const reponse = await app.appel('GET', `/api/mirror/consents/${ID.moussa}`, { jeton })
    assert.equal(reponse.statut, 200)
    assert.deepEqual(reponse.json.consentements.map((c) => [c.destination_country, c.data_type, c.etat]), [['BE', 'PROFILE', 'ACCORDE']])
    assert.equal((await app.appel('GET', `/api/mirror/consents/${ID.awa}`, { jeton })).statut, 403)
  })

  test('déclaration vers le pays où l\'on se trouve déjà : voyage en cours renvoyé', async () => {
    const jeton = await connecter('moussa')
    const reponse = await app.appel('POST', '/api/declarations/new', { jeton, corps: { paysISO: 'BE', dateDepart: new Date().toISOString().slice(0, 10) } })
    assert.deepEqual([reponse.statut, reponse.json.declaration.status], [200, 'CONFIRMED'])
    assert.match(reponse.json.message, /déjà en voyage/)
  })

  test('annulation : le numéro reste actif s\'il sert à un autre voyage en cours', async () => {
    const base = requerir('src/demo/baseDemo')
    const doublon = 'de000000-0000-4000-8003-0000000000ff'
    base.tables.trip_declaration.push({
      declaration_id: doublon, user_id: ID.moussa, destination_country: 'BE', status: 'PENDING', number_id: ID.numeroMoussaBE,
      departure_date: new Date().toISOString().slice(0, 10), return_date: null, declaration_time: new Date().toISOString()
    })
    const jeton = await connecter('moussa')
    const reponse = await app.appel('PUT', `/api/declarations/${doublon}/cancel`, { jeton })
    assert.equal(reponse.json.declaration.status, 'CANCELLED')
    assert.equal(base.tables.virtual_number.find((n) => n.number_id === ID.numeroMoussaBE).status, 'ACTIVE')
  })

  test('suggestion refusée : non reproposée pendant 7 jours', async () => {
    const jeton = await connecter('awa')
    assert.equal((await app.appel('POST', '/api/prediction/suggest', { jeton, corps: {} })).json.suggestion.paysISO, 'FR')
    const retour = await app.appel('POST', '/api/prediction/feedback', { jeton, corps: { paysISO: 'FR', acceptee: false } })
    assert.match(retour.json.message, /7 jours/)
    assert.equal((await app.appel('POST', '/api/prediction/suggest', { jeton, corps: {} })).json.suggestion, null)
  })

  test('voyage déclaré, encore à Douala : attente du départ, numéro inchangé', async () => {
    const jeton = await connecter('awa')
    const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    assert.equal((await app.appel('POST', '/api/declarations/new', { jeton, corps: { paysISO: 'FR', dateDepart: demain } })).statut, 201)
    const { json: simulation } = await app.appel('GET', '/api/demo/signaux/CM')
    const reponse = await app.appel('POST', '/api/geolocalisation/arrivee', { jeton, corps: simulation.signaux })
    assert.equal(reponse.json.decision, 'PAS_ENCORE_PARTI')
    assert.equal(reponse.json.reessayerDansSecondes, undefined)
  })

  test('déconnexion sans refresh token : la session ne peut plus être renouvelée', async () => {
    const { telephone, pin } = compte('awa')
    const connexion = await app.appel('POST', '/api/auth/login', { corps: { phoneNumber: telephone, pin } })
    const { access_token: jeton, refresh_token: refreshToken } = connexion.json.tokens
    assert.equal((await app.appel('POST', '/api/auth/logout', { jeton })).statut, 200)
    const refresh = await app.appel('POST', '/api/auth/refresh', { corps: { refreshToken } })
    assert.deepEqual([refresh.statut, refresh.json.code], [401, 'REFRESH_INVALIDE'])
  })

  test('CORS : en-têtes utiles exposés aux applications web', async () => {
    const reponse = await fetch(`${app.base}/api/health`, { headers: { origin: 'http://localhost:8081' } })
    assert.equal(reponse.headers.get('access-control-allow-origin'), 'http://localhost:8081')
    assert.match(reponse.headers.get('access-control-expose-headers'), /Idempotent-Replayed.*X-Request-Id.*X-Smart-Roam-Mode/)
  })
})

describe('vérification du numéro par SMS (OTP)', () => {
  before(async () => {
    assert.equal((await app.appel('POST', '/api/demo/reinitialiser')).statut, 200)
  })

  const demanderCode = (phoneNumber, motif) => app.appel('POST', '/api/auth/otp', { corps: { phoneNumber, motif } })

  test('inscription : code exigé, code faux refusé, bon code accepté une seule fois', async () => {
    const telephone = '+2250700000077'
    const sms = await demanderCode(telephone, 'INSCRIPTION')
    assert.equal(sms.statut, 200)
    assert.match(sms.json.codeDemo, /^\d{6}$/)
    assert.equal(sms.json.expireDansSecondes, 300)

    const sansCode = await app.appel('POST', '/api/users/register', { corps: { phoneNumber: telephone, countryResidence: 'CI' } })
    assert.deepEqual([sansCode.statut, sansCode.json.code], [400, 'OTP_REQUIS'])
    const faux = sms.json.codeDemo === '000000' ? '111111' : '000000'
    const codeFaux = await app.appel('POST', '/api/users/register', { corps: { phoneNumber: telephone, countryResidence: 'CI', otpCode: faux } })
    assert.deepEqual([codeFaux.statut, codeFaux.json.code, codeFaux.json.essaisRestants], [400, 'CODE_INCORRECT', 4])
    const inscription = await app.appel('POST', '/api/users/register', { corps: { phoneNumber: telephone, countryResidence: 'CI', otpCode: sms.json.codeDemo } })
    assert.equal(inscription.statut, 201)
    // Numéro désormais enregistré : plus aucun code d'inscription envoyé.
    assert.equal((await demanderCode(telephone, 'INSCRIPTION')).statut, 409)
  })

  test('quotas : un code par minute pour un même numéro', async () => {
    const telephone = '+2250700000078'
    assert.equal((await demanderCode(telephone, 'INSCRIPTION')).statut, 200)
    const trop = await demanderCode(telephone, 'INSCRIPTION')
    assert.equal(trop.statut, 429)
    assert.ok(Number(trop.entetes.get('retry-after')) > 0)
  })

  test('PIN oublié : nouveau PIN après code SMS, anciennes sessions fermées', async () => {
    const { telephone, pin } = compte('moussa')
    const ancienJeton = await connecter('moussa')
    const sms = await demanderCode(telephone, 'PIN_OUBLIE')
    assert.match(sms.json.codeDemo, /^\d{6}$/)

    const trivial = await app.appel('POST', '/api/auth/pin-oublie', { corps: { phoneNumber: telephone, otpCode: sms.json.codeDemo, nouveauPin: '1234' } })
    assert.equal(trivial.statut, 400)
    const reinitialise = await app.appel('POST', '/api/auth/pin-oublie', { corps: { phoneNumber: telephone, otpCode: sms.json.codeDemo, nouveauPin: '7391' } })
    assert.equal(reinitialise.statut, 200)

    assert.equal((await app.appel('GET', `/api/users/${ID.moussa}`, { jeton: ancienJeton })).statut, 401)
    assert.equal((await app.appel('POST', '/api/auth/login', { corps: { phoneNumber: telephone, pin } })).statut, 401)
    assert.equal((await app.appel('POST', '/api/auth/login', { corps: { phoneNumber: telephone, pin: '7391' } })).statut, 200)
    // Code à usage unique.
    const rejeu = await app.appel('POST', '/api/auth/pin-oublie', { corps: { phoneNumber: telephone, otpCode: sms.json.codeDemo, nouveauPin: '8264' } })
    assert.deepEqual([rejeu.statut, rejeu.json.code], [400, 'CODE_EXPIRE_OU_ABSENT'])
  })

  test('PIN oublié pour un numéro inconnu : même réponse, aucun code envoyé', async () => {
    const reponse = await demanderCode('+2250700000099', 'PIN_OUBLIE')
    assert.equal(reponse.statut, 200)
    assert.equal(reponse.json.codeDemo, undefined)
  })

  test('configuration : fournisseur « demo » réservé à la démo, « console » interdit en production', () => {
    const horsDemo = executerIsole('require("./src/config")', { NODE_ENV: 'development', DEMO_MODE: 'false', OTP_PROVIDER: 'demo' })
    assert.match(horsDemo.stderr, /réservé au mode démo/)
    const production = executerIsole('require("./src/config")', { NODE_ENV: 'production', DEMO_MODE: 'false', OTP_PROVIDER: 'console', JWT_SECRET: 'x'.repeat(48) })
    assert.match(production.stderr, /interdit en production/)
    const sansFournisseur = executerIsole('process.stdout.write(JSON.stringify(require("./src/config").avertissements))', {
      NODE_ENV: 'production', DEMO_MODE: 'false', OTP_PROVIDER: 'aucun', JWT_SECRET: 'x'.repeat(48)
    })
    assert.match(sansFournisseur.stdout, /Aucun fournisseur SMS/)
  })
})

describe('mode démo — garde-fous', () => {
  test('interdit en production', () => {
    const resultat = executerIsole('require("./src/config")', { NODE_ENV: 'production', DEMO_MODE: 'true', JWT_SECRET: 'x'.repeat(48) })
    assert.notEqual(resultat.status, 0)
    assert.match(resultat.stderr, /interdit en production/)
  })

  test('hors mode démo, /api/demo n\'existe pas', () => {
    const script = [
      'const { creerApp } = require("./src/app")',
      'const serveur = creerApp().listen(0, "127.0.0.1", async () => {',
      '  const reponse = await fetch(`http://127.0.0.1:${serveur.address().port}/api/demo`)',
      '  process.stdout.write(String(reponse.status) + " " + String(reponse.headers.get("x-smart-roam-mode")))',
      '  serveur.close()',
      '})'
    ].join('\n')
    const resultat = executerIsole(script, { NODE_ENV: 'test', DEMO_MODE: 'false', SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_KEY: 'cle-de-test' })
    assert.equal(resultat.stdout, '404 null', resultat.stderr)
  })
})
