'use strict'

const { describe, test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const https = require('https')
const path = require('path')
const { preparer } = require('../helpers/contexte')

const U = 'a0000000-0000-4000-8000-000000000001'
const { faux, requerir } = preparer({ tables: { session: [], audit_log: [] } })
const jwt = require('jsonwebtoken')
const config = requerir('src/config')
const a09 = requerir('src/algorithms/algo09_chiffrementAES')
const a10 = requerir('src/algorithms/algo10_zeroTrustJWT')
const a11 = requerir('src/algorithms/algo11_hachagePIN')
const a12 = requerir('src/algorithms/algo12_certificatePinning')
const a13 = requerir('src/algorithms/algo13_detectionWAF')

const attendreRejet = async (promesse) => {
  try {
    await promesse
  } catch (erreur) {
    return erreur
  }
  assert.fail('une erreur était attendue')
}

describe('algo09 — chiffrement AES-256-GCM', () => {
  test('aller-retour avec données associées (AAD)', () => {
    a09.chargerTrousseau(`v1:${a09.genererNouvelleCle()}`)
    const message = a09.chiffrerMessage('IBAN FR76 3000 6000 0112', { donneesAssociees: U })
    assert.equal(message.version_cle, 'v1')
    assert.equal(a09.dechiffrerMessage(message, { donneesAssociees: U }), 'IBAN FR76 3000 6000 0112')
    assert.equal(a09.dechiffrerMessage(message, { donneesAssociees: 'autre' }), null)
  })

  test('données altérées ou clé inconnue → refus', () => {
    a09.chargerTrousseau(`v1:${a09.genererNouvelleCle()}`)
    const message = a09.chiffrerMessage('secret')
    const octets = Buffer.from(message.donnees_chiffrees, 'base64')
    octets[0] ^= 0xff
    assert.equal(a09.dechiffrerMessage({ ...message, donnees_chiffrees: octets.toString('base64') }), null)
    assert.equal(a09.dechiffrerMessage({ ...message, version_cle: 'v9' }), null)
  })

  test('rotation : anciens messages lisibles, nouvelle clé utilisée, alerte d\'âge', () => {
    const k1 = a09.genererNouvelleCle()
    a09.chargerTrousseau(`v1:${k1}`)
    const ancien = a09.chiffrerMessage('ancien secret')
    a09.chargerTrousseau(`v1:${k1},v2:${a09.genererNouvelleCle()}:2020-01-01`)
    assert.equal(a09.dechiffrerMessage(ancien), 'ancien secret')
    assert.equal(a09.chiffrerMessage('x').version_cle, 'v2')
    assert.equal(a09.verifierRotationCle().rotationRecommandee, true)
  })

  test('trousseau invalide → erreur explicite', () => {
    assert.throws(() => a09.analyserTrousseau('v1:trop-court'), /64 caractères/)
  })
})

describe('algo10 — jetons Zero Trust', () => {
  test('génération puis vérification', async () => {
    const tokens = await a10.genererTokens({ userId: U, role: 'USER', deviceId: 'iphone' })
    assert.equal(tokens.token_type, 'Bearer')
    assert.equal(tokens.expires_in, 15 * 60)
    const auth = a10.verifierToken(tokens.access_token)
    assert.equal(auth.userId, U)
    assert.equal(auth.deviceId, 'iphone')
    assert.equal(faux.tables.session.length, 1)
    assert.notEqual(faux.tables.session[0].refresh_token_hash, tokens.refresh_token) // stocké haché
  })

  test('opération sensible : durée réduite à 5 minutes', async () => {
    const tokens = await a10.genererTokens({ userId: U, operationSensible: true })
    assert.equal(tokens.expires_in, 5 * 60)
  })

  test('signature forgée, algorithme « none » et jeton expiré refusés', () => {
    const payload = { sub: U, role: 'ADMIN', sid: 's', iat_ms: Date.now() }
    const forge = jwt.sign(payload, 'autre-secret', { algorithm: 'HS256', issuer: config.jwt.emetteur })
    assert.throws(() => a10.verifierToken(forge), (e) => e.statut === 401 && e.details.code === 'TOKEN_INVALIDE')

    const entete = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const corps = Buffer.from(JSON.stringify({ ...payload, iss: config.jwt.emetteur })).toString('base64url')
    assert.throws(() => a10.verifierToken(`${entete}.${corps}.`), (e) => e.statut === 401)

    const expire = jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 10 }, config.jwt.secret, { algorithm: 'HS256', issuer: config.jwt.emetteur })
    assert.throws(() => a10.verifierToken(expire), (e) => e.details.code === 'TOKEN_EXPIRE')
  })

  test('révocation d\'une session puis de toutes les sessions', async () => {
    const t1 = await a10.genererTokens({ userId: U })
    const sid = a10.verifierToken(t1.access_token).sessionId
    await a10.revoquerSession({ sessionId: sid, refreshToken: t1.refresh_token })
    assert.throws(() => a10.verifierToken(t1.access_token), (e) => e.details.code === 'SESSION_REVOQUEE')

    const t2 = await a10.genererTokens({ userId: U })
    await a10.revoquerTousTokens(U)
    assert.throws(() => a10.verifierToken(t2.access_token), (e) => e.details.code === 'TOKENS_REVOQUES')
    await new Promise((resolve) => setTimeout(resolve, 2))
    const t3 = await a10.genererTokens({ userId: U })
    assert.equal(a10.verifierToken(t3.access_token).userId, U)
  })

  test('rotation du refresh token et détection de réutilisation', async () => {
    const charger = async (id) => ({ user_id: id })
    const t1 = await a10.genererTokens({ userId: U })
    const t2 = await a10.renouvelerTokens(t1.refresh_token, charger)
    assert.notEqual(t2.refresh_token, t1.refresh_token)
    const erreur = await attendreRejet(a10.renouvelerTokens(t1.refresh_token, charger))
    assert.equal(erreur.statut, 401)
    assert.throws(() => a10.verifierToken(t2.access_token), (e) => e.details.code === 'TOKENS_REVOQUES')
  })

  test('jeton sensible : 5 minutes, marqué, révoqué avec sa session', async () => {
    const tokens = await a10.genererTokens({ userId: U, role: 'USER', deviceId: 'iphone', appareilConnu: true })
    const session = a10.verifierToken(tokens.access_token)
    assert.equal(session.sensible, false)
    assert.equal(session.appareilConnu, true)

    const sensible = a10.genererJetonSensible({ ...session })
    assert.equal(sensible.expires_in, 5 * 60)
    const auth = a10.verifierToken(sensible.access_token)
    assert.deepEqual([auth.sensible, auth.sessionId, auth.appareilConnu], [true, session.sessionId, true])

    await a10.revoquerSession({ sessionId: session.sessionId })
    assert.throws(() => a10.verifierToken(sensible.access_token), (e) => e.details.code === 'SESSION_REVOQUEE')
  })

  test('rôle : liste ADMIN_USER_IDS ou colonne role', () => {
    assert.equal(a10.determinerRole({ user_id: 'a0000000-0000-4000-8000-0000000000ad' }), 'ADMIN')
    assert.equal(a10.determinerRole({ user_id: U, role: 'admin' }), 'ADMIN')
    assert.equal(a10.determinerRole({ user_id: U }), 'USER')
  })

  test('table « session » absente → repli en mémoire', async () => {
    faux.forcerErreur('session', { code: 'PGRST205', message: 'Could not find the table \'public.session\'' })
    const tokens = await a10.genererTokens({ userId: U })
    const renouveles = await a10.renouvelerTokens(tokens.refresh_token, async (id) => ({ user_id: id }))
    assert.ok(renouveles.access_token)
    faux.retirerErreur('session')
  })
})

describe('algo11 — hachage des PIN', () => {
  test('format scrypt auto-descriptif avec poivre', async () => {
    const { hash } = await a11.hacherPIN('4821')
    assert.match(hash, /^scrypt\$v=1\$N=32768,r=8,p=3\$poivre=1\$/)
    assert.equal((await a11.verifierPIN('4821', hash)).valide, true)
    assert.equal((await a11.verifierPIN('4822', hash)).valide, false)
  })

  test('paramètres obsolètes → valide mais re-hachage demandé', async () => {
    const sel = crypto.randomBytes(16)
    const entree = crypto.createHmac('sha256', config.pinPepper).update('4821').digest()
    const derive = crypto.scryptSync(entree, sel, 32, { N: 16384, r: 8, p: 1 })
    const ancien = `scrypt$v=1$N=16384,r=8,p=1$poivre=1$${sel.toString('base64')}$${derive.toString('base64')}`
    assert.deepEqual(await a11.verifierPIN('4821', ancien), { valide: true, doitRehacher: true })
  })

  test('ancien format SHA-256 (contrôleur historique) migré', async () => {
    const sel = crypto.randomBytes(16).toString('hex')
    const ancien = crypto.createHash('sha256').update(`4821${sel}`).digest('hex')
    assert.deepEqual(await a11.verifierPIN('4821', ancien, sel), { valide: true, doitRehacher: true })
    assert.equal((await a11.verifierPIN('0000', ancien, sel)).valide, false)
  })

  test('PIN triviaux détectés', () => {
    for (const pin of ['0000', '1234', '4321', '9999']) assert.equal(a11.estPINTrivial(pin), true)
    assert.equal(a11.estPINTrivial('4821'), false)
  })

  test('compte sans PIN : refus au même coût de calcul', async () => {
    assert.deepEqual(await a11.verifierPINUtilisateur(null, '4821'), { valide: false, doitRehacher: false })
  })
})

describe('algo12 — certificate pinning', () => {
  const dossier = path.join(__dirname, '..', 'fixtures', 'tls')
  const certificat = fs.readFileSync(path.join(dossier, 'certificat-test-localhost.pem'))
  const cle = fs.readFileSync(path.join(dossier, 'cle-test-localhost.pem'))
  const empreinte = crypto.createHash('sha256')
    .update(new crypto.X509Certificate(certificat).publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64')
  let serveur
  let port

  before(async () => {
    serveur = https.createServer({ cert: certificat, key: cle }, (req, res) => res.end('ok')).listen(0)
    await new Promise((resolve) => serveur.once('listening', resolve))
    port = serveur.address().port
  })
  after(() => new Promise((resolve) => serveur.close(resolve)))

  const appeler = (agent) => new Promise((resolve) => {
    const requete = https.request({ host: 'localhost', port, path: '/', agent, ca: certificat }, (reponse) => {
      reponse.resume()
      reponse.on('end', () => resolve('OK'))
    })
    requete.on('error', (erreur) => resolve(erreur.message))
    requete.end()
  })

  test('empreinte SPKI reconnue (format HPKP « sha256/ »)', async () => {
    assert.equal(await appeler(a12.creerAgentHttpsEpingle({ pins: [`sha256/${empreinte}`], expirationPins: null })), 'OK')
  })

  test('empreinte inconnue → connexion refusée (MITM)', async () => {
    assert.match(await appeler(a12.creerAgentHttpsEpingle({ pins: ['A'.repeat(43) + '='], expirationPins: null })), /PIN_NON_RECONNU/)
  })

  test('empreintes expirées ou absentes → refus', async () => {
    assert.match(await appeler(a12.creerAgentHttpsEpingle({ pins: [empreinte], expirationPins: '2020-01-01' })), /PINS_EXPIRES/)
    assert.match(await appeler(a12.creerAgentHttpsEpingle({ pins: [], expirationPins: null })), /AUCUNE_EMPREINTE/)
  })

  test('domaine incorrect → refus', () => {
    const x509 = new crypto.X509Certificate(certificat)
    const resultat = a12.verifierCertificatePinningSSL({
      hote: 'autre.example',
      certificat: { valid_from: x509.validFrom, valid_to: x509.validTo, subject: { CN: 'localhost' }, subjectaltname: 'DNS:localhost', pubkey: Buffer.from('x') },
      pins: [empreinte],
      expirationPins: null
    })
    assert.equal(resultat.raison, 'DOMAINE_INCORRECT')
  })
})

describe('algo13 — pare-feu applicatif', () => {
  beforeEach(() => a13.reinitialiserEtatWAF())

  const etatVierge = () => ({ seconde: 0, compteSeconde: 0, minute: 0, compteMinute: 0, baselineMinute: 0, blocages: [], bloqueJusqua: 0 })

  test('rate limit : 100 requêtes/s autorisées, la 101e bloquée, remise à zéro', () => {
    const etat = etatVierge()
    const t = 1800000000500
    for (let i = 0; i < 100; i++) a13.enregistrerRequete(etat, t)
    assert.equal(a13.evaluerRegleRateLimit(etat.compteSeconde).declenchee, false)
    a13.enregistrerRequete(etat, t)
    assert.equal(a13.evaluerRegleRateLimit(etat.compteSeconde).declenchee, true)
    a13.enregistrerRequete(etat, t + 1000)
    assert.equal(etat.compteSeconde, 1)
  })

  test('pic de trafic détecté par rapport à la moyenne mobile', () => {
    const etat = etatVierge()
    const t = 1800000000000
    for (let minute = 0; minute < 10; minute++) for (let i = 0; i < 5; i++) a13.enregistrerRequete(etat, t + minute * 60000 + i)
    for (let i = 0; i < 80; i++) a13.enregistrerRequete(etat, t + 10 * 60000 + i)
    assert.match(a13.evaluerRegleSpike(etat.baselineMinute, etat.compteMinute).raison, /^SPIKE_TRAFIC_X1[56]$/)
  })

  test('réputation : CAPTCHA après 3 blocages en 24 h', () => {
    const maintenant = Date.now()
    const reputation = a13.calculerReputation({ blocages: [maintenant, maintenant, maintenant] }, maintenant)
    assert.equal(a13.evaluerRegleReputation(reputation).decision, 'CAPTCHA')
  })

  test('injections détectées sans faux positifs sur des données légitimes', () => {
    for (const attaque of ["x' OR '1'='1", 'UNION SELECT password', '1; DROP TABLE users', "admin'--", 'pg_sleep(5)']) {
      assert.equal(a13.detecterInjectionSQL(attaque), true, attaque)
    }
    for (const attaque of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'javascript:void(0)']) {
      assert.equal(a13.detecterInjectionXSS(attaque), true, attaque)
    }
    for (const legitime of ['Jean-Pierre', '2026-11-19', '+33 6 12 34 56 78', 'l\'aéroport d\'Orly', 'Côte d\'Ivoire']) {
      assert.equal(a13.detecterInjectionSQL(legitime) || a13.detecterInjectionXSS(legitime), false, legitime)
    }
  })

  test('injection → IP bloquée 1 h, puis liste noire ; la simulation ne modifie rien', async () => {
    const requete = { ip: '203.0.113.7', originalUrl: '/api/x', body: { q: "' OR '1'='1" } }
    const simulation = await a13.evaluerRequeteWAF(requete, { simulation: true })
    assert.equal(simulation.decision, 'BLOCK')
    assert.equal((await a13.evaluerRequeteWAF({ ip: '203.0.113.7', originalUrl: '/' })).decision, 'ALLOW')

    const reelle = await a13.evaluerRequeteWAF(requete)
    assert.equal(reelle.raison, 'INJECTION_SQL_DETECTEE')
    assert.equal(reelle.reessayerDansSecondes, 3600)
    const suivante = await a13.evaluerRequeteWAF({ ip: '203.0.113.7', originalUrl: '/' })
    assert.equal(suivante.raison, 'IP_EN_LISTE_NOIRE')
    assert.equal((await a13.evaluerRequeteWAF({ ip: '203.0.113.8', originalUrl: '/' })).decision, 'ALLOW')
  })
})
