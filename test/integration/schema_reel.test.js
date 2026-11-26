'use strict'

// ════════════════════════════════════════════════════════════
// Reproduction du schéma RÉEL de la base de production, d'après
// « npm run verifier:schema » du 21/11/2026 : colonnes attendues moins
// celles signalées manquantes, table session absente, clé publishable.
// La base simulée rejette toute colonne inconnue comme PostgREST : ce test
// garantit que le backend fonctionne réellement sur cette base.
// ════════════════════════════════════════════════════════════

const { describe, test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('child_process')
const { preparer, demarrerApp, RACINE } = require('../helpers/contexte')

const { SCHEMA_ATTENDU } = require('../../src/outils/schemaAttendu')

// Colonnes signalées manquantes dans la base réelle.
const MANQUANTES = {
  users: ['user_origin_type', 'display_name', 'avatar_url', 'role'],
  country: ['roaming_zone'],
  travel_history: ['created_at'],
  mvno_partner: ['coverage_score', 'latency_ms', 'cost_per_day_xaf', 'api_endpoint'],
  audit_log: ['details']
}
const schemaReel = Object.fromEntries(SCHEMA_ATTENDU.map(({ table, colonnes }) => [
  table,
  Object.keys(colonnes).filter((colonne) => !(MANQUANTES[table] || []).includes(colonne))
]))

const { faux, requerir } = preparer({
  schemas: schemaReel,
  contraintesUniques: { users: ['phone_number'], virtual_number: ['did_number'] },
  tables: {
    users: [],
    country: [
      { country_iso: 'CM', name_fr: 'Cameroun', data_region: 'af-south-1', did_enabled: true },
      { country_iso: 'FR', name_fr: 'France', data_region: 'eu-west-1', did_enabled: true }
    ],
    did_pool: [{ pool_id: 'd0000000-0000-4000-8000-000000000001', country_iso: 'FR', status: 'ACTIVE', range_start: '+33700000000', range_end: '+33700000999', total_numbers: 1000, allocated_count: 0, reorder_status: null }],
    mvno_partner: [{ partner_id: 'm0000000-0000-4000-8000-000000000001', name: 'TopMobile', country_iso: 'FR', agreement_status: 'ACTIVE', failover_priority: 1, sip_endpoint: 'sip:commandes@topmobile.example', esim_sm_dp_url: 'https://smdp.topmobile.example' }],
    virtual_number: [],
    trip_declaration: [],
    travel_history: [],
    esim_profile: [],
    fraud_profile: [],
    device: [],
    audit_log: [],
    data_sovereignty_consent: []
  }
})
faux.forcerErreur('session', { code: 'PGRST205', message: 'Could not find the table \'public.session\' in the schema cache' })

const { verifierSchema } = requerir('src/outils/verificationSchema')
const { journaliserAudit } = requerir('src/utils/audit')
const { executerMaintenance } = requerir('src/taches/maintenance')

let app
before(async () => { app = await demarrerApp(requerir) })
after(() => app.arreter())

const insertionsUsers = () => faux.journal.filter((appel) => appel.table === 'users' && appel.operation === 'insert').length

describe('base réelle du 21/11/2026', () => {
  test('diagnostic : plus aucun écart bloquant, impacts expliqués', async () => {
    const rapport = await verifierSchema(faux)
    assert.deepEqual(rapport.bloquants, [])
    assert.equal(rapport.conforme, true)
    const users = rapport.tables.find((t) => t.table === 'users')
    assert.equal(users.statut, 'INCOMPLETE')
    assert.ok(users.colonnesManquantes.every((c) => !c.obligatoire && c.impact))
    assert.equal(rapport.tables.find((t) => t.table === 'esim_profile').statut, 'OK')
    assert.equal(rapport.tables.find((t) => t.table === 'session').statut, 'ABSENTE')
  })

  test('parcours complet : inscription, PIN, connexion, déclaration, eSIM', async () => {
    // Inscription : user_origin_type absent est ignoré, le reste est conservé.
    const inscription = await app.appel('POST', '/api/users/register', { corps: { phoneNumber: '+237699555001', countryResidence: 'CM' } })
    assert.equal(inscription.statut, 201)
    const utilisateur = faux.tables.users[0]
    assert.equal('user_origin_type' in utilisateur, false)
    assert.deepEqual([utilisateur.residence_status, utilisateur.global_identity_status], ['RESIDENT', 'PENDING_SYNC'])
    assert.equal(insertionsUsers(), 2) // un essai refusé, puis l'insertion réduite

    // Seconde inscription : la colonne absente est mémorisée, aucun essai inutile.
    assert.equal((await app.appel('POST', '/api/users/register', { corps: { phoneNumber: '+237699555002', countryResidence: 'CM' } })).statut, 201)
    assert.equal(insertionsUsers(), 3)

    const jetonInscription = inscription.json.tokens.access_token
    assert.equal((await app.appel('POST', '/api/security/pin/create', { jeton: jetonInscription, corps: { pin: '4821' } })).statut, 200)

    // Connexion : table session absente → sessions en mémoire, refresh fonctionnel.
    const connexion = await app.appel('POST', '/api/auth/login', { corps: { phoneNumber: '+237699555001', pin: '4821', deviceId: 'tecno-1' } })
    assert.equal(connexion.statut, 200)
    const refresh = await app.appel('POST', '/api/auth/refresh', { corps: { refreshToken: connexion.json.tokens.refresh_token } })
    assert.equal(refresh.statut, 200)
    const jeton = refresh.json.tokens.access_token

    // Déclaration de voyage : numéro attribué, historique sans created_at.
    const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const declaration = await app.appel('POST', '/api/declarations/new', { jeton, corps: { paysISO: 'FR', dateDepart: demain } })
    assert.equal(declaration.statut, 201)
    assert.equal(faux.tables.travel_history.length, 1)
    const numberId = declaration.json.numeroVirtuel.number_id

    // eSIM : roaming_zone absente (pas de roaming UE gratuit), partenaire sans score.
    const esim = await app.appel('POST', '/api/esim/provision', { jeton, corps: { numberId, paysISO: 'FR' } })
    assert.equal(esim.statut, 201)
    assert.equal(esim.json.partenaire, 'TopMobile')

    // Liste des eSIM triée par activated_at (created_at n'existe pas).
    const liste = await app.appel('GET', `/api/esim/${utilisateur.user_id}`, { jeton })
    assert.equal(liste.statut, 200)
    assert.equal(liste.json.esims.length, 1)
    assert.ok(liste.json.esims[0].expire_le)
  })

  test('audit : seule la colonne absente (details) est ignorée, l\'IP est conservée', async () => {
    faux.tables.audit_log = []
    await journaliserAudit({ entite: 'TEST', action: 'AVEC_DETAILS', extra: { ip_address: '198.51.100.7', details: { a: 1 } } })
    await journaliserAudit({ entite: 'TEST', action: 'SANS_DETAILS', extra: { ip_address: '198.51.100.8' } })
    assert.deepEqual(faux.tables.audit_log.map((l) => [l.action, l.ip_address, 'details' in l]), [
      ['AVEC_DETAILS', '198.51.100.7', false],
      ['SANS_DETAILS', '198.51.100.8', false]
    ])
  })

  test('maintenance : expiration des eSIM sur activated_at, table session absente tolérée', async () => {
    const rapport = await executerMaintenance()
    assert.equal(typeof rapport.esimExpirees, 'number')
    assert.equal(rapport.sessionsPurgees, 0)
    assert.ok(rapport.voyages)
  })

  test('clé publishable : avertissement au démarrage du serveur', () => {
    const sortie = execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("./src/config").avertissements))'], {
      cwd: RACINE,
      env: { ...process.env, NODE_ENV: 'test', SUPABASE_KEY: 'sb_publishable_exemple' },
      encoding: 'utf8'
    })
    assert.match(sortie, /clé publique/)
  })
})
