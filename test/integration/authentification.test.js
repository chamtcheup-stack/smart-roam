'use strict'

const { describe, test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { preparer, demarrerApp, CLE_SERVICE, ADMIN_ID } = require('../helpers/contexte')

const AUTRE = 'b0000000-0000-4000-8000-000000000002'
const REGLE_AUTRE = 'c0000000-0000-4000-8000-000000000003'

// TRUST_PROXY : chaque test présente sa propre IP (X-Forwarded-For),
// les limiteurs par adresse restent indépendants d'un test à l'autre.
const { faux, requerir } = preparer({
  env: { TRUST_PROXY: 'true', LIMITE_ECHECS_CONNEXION_IP_15MIN: '8' },
  tables: {
    country: [{ country_iso: 'CM', name_fr: 'Cameroun', data_region: 'af-south-1', did_enabled: true }],
    users: [
      { user_id: ADMIN_ID, phone_number: '+33600000001', country_of_residence: 'FR', kyc_status: 'VERIFIED' },
      { user_id: AUTRE, phone_number: '+33600000002', country_of_residence: 'FR', kyc_status: 'PENDING' }
    ],
    session: [],
    device: [],
    fraud_profile: [],
    audit_log: [],
    forwarding_rule: [{ rule_id: REGLE_AUTRE, user_id: AUTRE, number_id: null, trigger_condition: 'ALWAYS', action: 'RING', is_active: true, priority: 1 }],
    did_pool: []
  },
  contraintesUniques: { users: ['phone_number'] }
})
const { genererTokens, verifierToken } = requerir('src/algorithms/algo10_zeroTrustJWT')

let app
let ipSuivante = 10
const depuis = (options = {}) => ({ ...options, entetes: { 'x-forwarded-for': `198.51.100.${ipSuivante}`, ...options.entetes } })
const nouvelleIP = () => { ipSuivante += 1 }

const TELEPHONE = '+237699111222'
let moi
let jetonInscription

before(async () => {
  app = await demarrerApp(requerir)
  const inscription = await app.appel('POST', '/api/users/register', depuis({ corps: { phoneNumber: TELEPHONE, countryResidence: 'cm' } }))
  assert.equal(inscription.statut, 201)
  moi = inscription.json.user.user_id
  jetonInscription = inscription.json.tokens.access_token
  const pin = await app.appel('POST', '/api/security/pin/create', depuis({ jeton: jetonInscription, corps: { pin: '4821' } }))
  assert.equal(pin.statut, 200)
})
after(() => app.arreter())

const connexion = async (pin = '4821', telephone = TELEPHONE) =>
  app.appel('POST', '/api/auth/login', depuis({ corps: { phoneNumber: telephone, pin, deviceId: 'iphone-1' } }))

describe('inscription et PIN', () => {
  test('inscription : jetons fournis, doublon refusé, profil de fraude créé', async () => {
    nouvelleIP()
    assert.ok(jetonInscription)
    const doublon = await app.appel('POST', '/api/users/register', depuis({ corps: { phoneNumber: '237 699 111 222', countryResidence: 'CM' } }))
    assert.equal(doublon.statut, 409)
    assert.equal(faux.tables.fraud_profile.length, 1)
  })

  test('PIN stocké en scrypt poivré, jamais en clair', () => {
    const utilisateur = faux.tables.users.find((u) => u.user_id === moi)
    assert.match(utilisateur.pin_hash, /^scrypt\$v=1\$N=32768,r=8,p=3\$poivre=1\$/)
    assert.doesNotMatch(utilisateur.pin_hash, /4821/)
  })

  test('changement de PIN : ancien PIN exigé et vérifié, PIN identique refusé', async () => {
    nouvelleIP()
    const { json } = await connexion()
    const jeton = json.tokens.access_token
    assert.equal((await app.appel('POST', '/api/security/pin/create', depuis({ jeton, corps: { pin: '5937' } }))).statut, 400)
    assert.equal((await app.appel('POST', '/api/security/pin/create', depuis({ jeton, corps: { pin: '5937', ancienPin: '0001' } }))).statut, 403)
    assert.equal((await app.appel('POST', '/api/security/pin/create', depuis({ jeton, corps: { pin: '4821', ancienPin: '4821' } }))).statut, 400)
  })
})

describe('connexion et cycle de vie des jetons', () => {
  test('connexion réussie (numéro saisi avec espaces) ; compte inconnu → message générique', async () => {
    nouvelleIP()
    const reussie = await app.appel('POST', '/api/auth/login', depuis({ corps: { phoneNumber: '+237 699 111 222', pin: '4821' } }))
    assert.equal(reussie.statut, 200)
    assert.equal(reussie.json.user.user_id, moi)
    const inconnu = await connexion('4821', '+237699999999')
    assert.deepEqual([inconnu.statut, inconnu.json.erreur], [401, 'Numéro de téléphone ou PIN incorrect'])
  })

  test('refresh : rotation, puis réutilisation détectée → toutes les sessions révoquées', async () => {
    nouvelleIP()
    const { json } = await connexion()
    const rotation = await app.appel('POST', '/api/auth/refresh', depuis({ corps: { refreshToken: json.tokens.refresh_token } }))
    assert.equal(rotation.statut, 200)
    assert.notEqual(rotation.json.tokens.refresh_token, json.tokens.refresh_token)
    const reutilisation = await app.appel('POST', '/api/auth/refresh', depuis({ corps: { refreshToken: json.tokens.refresh_token } }))
    assert.equal(reutilisation.statut, 401)
    const apres = await app.appel('GET', `/api/users/${moi}`, depuis({ jeton: rotation.json.tokens.access_token }))
    assert.deepEqual([apres.statut, apres.json.code], [401, 'TOKENS_REVOQUES'])
  })

  test('logout : le jeton de la session est révoqué immédiatement', async () => {
    nouvelleIP()
    await new Promise((resolve) => setTimeout(resolve, 5))
    const { json } = await connexion()
    const jeton = json.tokens.access_token
    assert.equal((await app.appel('POST', '/api/auth/logout', depuis({ jeton, corps: { refreshToken: json.tokens.refresh_token } }))).statut, 200)
    const apres = await app.appel('GET', `/api/users/${moi}`, depuis({ jeton }))
    assert.deepEqual([apres.statut, apres.json.code], [401, 'SESSION_REVOQUEE'])
  })

  test('verrouillage après 5 échecs (429 + Retry-After) et audit', async () => {
    nouvelleIP()
    let derniere
    for (let i = 0; i < 6; i++) derniere = await connexion('1357', '+33600000002')
    assert.equal(derniere.statut, 429)
    assert.ok(Number(derniere.entetes.get('retry-after')) > 0)
    const actions = faux.tables.audit_log.map((ligne) => ligne.action)
    assert.ok(actions.includes('CONNEXION_ECHOUEE') && actions.includes('COMPTE_VERROUILLE') && actions.includes('CONNEXION_REUSSIE'))
  })

  test('IP partagée (CGNAT) : seuls les échecs sont comptés, les réussites restent possibles', async () => {
    nouvelleIP()
    for (let i = 0; i < 3; i++) assert.equal((await connexion()).statut, 200)
    const echecs = []
    for (let i = 0; i < 9; i++) echecs.push(await connexion('1357', `+2376990000${10 + i}`))
    assert.equal(echecs[7].statut, 401) // 8 échecs, sur 8 comptes différents
    assert.equal(echecs[8].statut, 429) // seuil d'échecs de cette IP atteint
    assert.match(echecs[8].json.erreur, /échecs de connexion depuis cette adresse/)
    nouvelleIP()
    assert.equal((await connexion()).statut, 200) // une autre IP n'est pas affectée
  })

  test('appareil enregistré à la connexion : nouveau, puis connu (règle anti-fraude DEVICE)', async () => {
    nouvelleIP()
    const appel = () => app.appel('POST', '/api/auth/login', depuis({ corps: { phoneNumber: TELEPHONE, pin: '4821', deviceId: 'pixel-neuf' } }))
    assert.equal(verifierToken((await appel()).json.tokens.access_token).appareilConnu, false)
    assert.equal(verifierToken((await appel()).json.tokens.access_token).appareilConnu, true)
    assert.ok(faux.tables.device.some((ligne) => ligne.user_id === moi && ligne.device_id === 'pixel-neuf'))
  })

  test('verrou progressif partagé entre vérification du PIN et connexion ; déverrouillage administrateur', async () => {
    nouvelleIP()
    const admin = (await genererTokens({ userId: ADMIN_ID, role: 'ADMIN' })).access_token
    const deverrouillage = await app.appel('POST', '/api/security/pin/unlock', depuis({ jeton: admin, corps: { userId: AUTRE } }))
    assert.equal(deverrouillage.json.etaitVerrouille, true) // verrouillé par le test précédent

    const jetonAutre = (await genererTokens({ userId: AUTRE, role: 'USER' })).access_token
    for (let i = 0; i < 3; i++) {
      const verification = await app.appel('POST', '/api/security/pin/verify', depuis({ jeton: jetonAutre, corps: { pin: '1357' } }))
      assert.equal(verification.json.valide, false)
    }
    assert.equal((await connexion('1357', '+33600000002')).statut, 401)
    assert.equal((await connexion('1357', '+33600000002')).statut, 429) // 3 + 2 échecs cumulés

    const utilisateurRefuse = await app.appel('POST', '/api/security/pin/unlock', depuis({ jeton: jetonAutre, corps: { userId: AUTRE } }))
    assert.equal(utilisateurRefuse.statut, 403)
    assert.equal((await app.appel('POST', '/api/security/pin/unlock', depuis({ cle: CLE_SERVICE, corps: { userId: AUTRE } }))).json.etaitVerrouille, true)
    assert.equal((await connexion('1357', '+33600000002')).statut, 401) // de nouveau autorisé à essayer
  })

  test('changement de PIN valide → anciennes sessions révoquées', async () => {
    nouvelleIP()
    const { json } = await connexion()
    const jeton = json.tokens.access_token
    const changement = await app.appel('POST', '/api/security/pin/create', depuis({ jeton, corps: { pin: '5937', ancienPin: '4821' } }))
    assert.equal(changement.statut, 200)
    assert.equal((await app.appel('GET', `/api/users/${moi}`, depuis({ jeton }))).statut, 401)
    assert.equal((await connexion('5937')).statut, 200)
  })
})

describe('autorisations (IDOR et rôles)', () => {
  let jeton
  before(async () => {
    jeton = (await genererTokens({ userId: moi, role: 'USER' })).access_token
  })

  test('sans jeton ou jeton falsifié → 401', async () => {
    nouvelleIP()
    assert.equal((await app.appel('GET', `/api/users/${moi}`, depuis())).statut, 401)
    assert.equal((await app.appel('GET', `/api/users/${moi}`, depuis({ jeton: 'abc.def.ghi' }))).json.code, 'TOKEN_INVALIDE')
  })

  test('données d\'un autre compte inaccessibles', async () => {
    nouvelleIP()
    assert.equal((await app.appel('GET', `/api/users/${moi}`, depuis({ jeton }))).statut, 200)
    assert.equal((await app.appel('GET', `/api/users/${AUTRE}`, depuis({ jeton }))).statut, 403)
    assert.equal((await app.appel('GET', `/api/forwarding/rules/${AUTRE}`, depuis({ jeton }))).statut, 403)
    assert.equal((await app.appel('DELETE', `/api/forwarding/rules/${REGLE_AUTRE}`, depuis({ jeton }))).statut, 404)
    assert.equal((await app.appel('POST', '/api/prediction/suggest', depuis({ jeton, corps: { userId: AUTRE } }))).statut, 403)
  })

  test('opérations privilégiées refusées à un utilisateur', async () => {
    nouvelleIP()
    assert.equal((await app.appel('PUT', `/api/users/${moi}/kyc`, depuis({ jeton, corps: { kycStatus: 'VERIFIED' } }))).statut, 403)
    assert.equal((await app.appel('GET', '/api/stock/pools', depuis({ jeton }))).statut, 403)
    assert.equal((await app.appel('POST', '/api/forwarding/evaluate', depuis({ jeton, corps: { numeroAppele: '+33700000000', numeroAppelant: '+33611111111' } }))).statut, 403)
    assert.equal((await app.appel('POST', '/api/security/waf/analyze', depuis({ jeton }))).statut, 403)
  })

  test('clé de service et administrateur', async () => {
    nouvelleIP()
    assert.equal((await app.appel('GET', '/api/stock/pools', depuis({ cle: 'mauvaise-cle' }))).statut, 401)
    assert.equal((await app.appel('GET', '/api/stock/pools', depuis({ cle: CLE_SERVICE }))).statut, 200)
    const admin = (await genererTokens({ userId: ADMIN_ID, role: 'ADMIN' })).access_token
    const kyc = await app.appel('PUT', `/api/users/${moi}/kyc`, depuis({ jeton: admin, corps: { kycStatus: 'VERIFIED' } }))
    assert.deepEqual([kyc.statut, kyc.json.kyc_status], [200, 'VERIFIED'])
    const analyse = await app.appel('POST', '/api/security/waf/analyze', depuis({ cle: CLE_SERVICE, corps: { payload: "x' OR '1'='1" } }))
    assert.equal(analyse.json.decision, 'BLOCK') // simulation : l'appelant n'est pas bloqué
    assert.equal((await app.appel('GET', '/api/health', depuis())).statut, 200)
  })

  test('suppression du compte : confirmation par PIN exigée, sessions révoquées', async () => {
    nouvelleIP()
    const { json } = await connexion('5937')
    const jetonSuppression = json.tokens.access_token
    const sansPIN = await app.appel('DELETE', `/api/users/${moi}`, depuis({ jeton: jetonSuppression }))
    assert.deepEqual([sansPIN.statut, sansPIN.json.code], [401, 'CONFIRMATION_PIN_REQUISE'])

    const verification = await app.appel('POST', '/api/security/pin/verify', depuis({ jeton: jetonSuppression, corps: { pin: '5937' } }))
    const sensible = verification.json.jetonSensible
    assert.equal(sensible.expires_in, 300)
    assert.equal(verifierToken(sensible.access_token).sensible, true)

    assert.equal((await app.appel('DELETE', `/api/users/${moi}`, depuis({ jeton: sensible.access_token }))).statut, 200)
    assert.equal((await app.appel('GET', `/api/users/${moi}`, depuis({ jeton: jetonSuppression }))).statut, 401)
    const admin = (await genererTokens({ userId: ADMIN_ID, role: 'ADMIN' })).access_token
    assert.equal((await app.appel('GET', `/api/users/${moi}`, depuis({ jeton: admin }))).statut, 404)
  })
})
