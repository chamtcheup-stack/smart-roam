'use strict'

const { describe, test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { preparer } = require('../helpers/contexte')

const U = 'a0000000-0000-4000-8000-000000000001'
const U2 = 'b0000000-0000-4000-8000-000000000002'
const { faux, requerir } = preparer({ contraintesUniques: { virtual_number: ['did_number'] } })
const a05 = requerir('src/algorithms/algo05_selectionReseauESIM')
const a06 = requerir('src/algorithms/algo06_predictionAtterrissage')
const a07 = requerir('src/algorithms/algo07_detectionFraude')
const a14 = requerir('src/algorithms/algo14_cloisonnementSouverainete')
const a15 = requerir('src/algorithms/algo15_attributionDID')
const a16 = requerir('src/algorithms/algo16_moteurForwarding')
const a17 = requerir('src/algorithms/algo17_conversionDevises')
const a18 = requerir('src/algorithms/algo18_synchronisationMiroir')
const a19 = requerir('src/algorithms/algo19_jitStockManager')
const a20 = requerir('src/algorithms/algo20_declarationDestination')

const attendreRejet = async (promesse) => {
  try {
    await promesse
  } catch (erreur) {
    return erreur
  }
  assert.fail('une erreur était attendue')
}

const baseDeDonnees = () => ({
  users: [
    { user_id: U, phone_number: '+237699000001', country_of_residence: 'CM', kyc_status: 'VERIFIED', display_name: 'Awa Mbarga', avatar_url: 'https://cdn.example/awa.png' },
    { user_id: U2, phone_number: '+237699000002', country_of_residence: 'CM', kyc_status: 'PENDING' }
  ],
  country: [
    { country_iso: 'CM', name_fr: 'Cameroun', data_region: 'af-south-1', did_enabled: true, roaming_zone: 'AFRICA' },
    { country_iso: 'FR', name_fr: 'France', data_region: 'eu-west-1', did_enabled: true, roaming_zone: 'EU_FREE' },
    { country_iso: 'BE', name_fr: 'Belgique', data_region: 'eu-west-1', did_enabled: true, roaming_zone: 'EU_FREE' },
    { country_iso: 'SA', name_fr: 'Arabie saoudite', data_region: 'me-south-1', did_enabled: true },
    { country_iso: 'JP', name_fr: 'Japon', data_region: null, did_enabled: false }
  ],
  virtual_number: [
    { number_id: 'n-fr', user_id: U, country_iso: 'FR', did_number: '+33700000001', status: 'ACTIVE', created_at: '2026-01-01T00:00:00Z' },
    { number_id: 'n-sa', user_id: U, country_iso: 'SA', did_number: '+966500000001', status: 'ACTIVE', created_at: '2026-01-01T00:00:00Z' }
  ],
  did_pool: [{ pool_id: 'pool-fr', country_iso: 'FR', status: 'ACTIVE', range_start: '+33700000000', range_end: '+33700000099', total_numbers: 100, allocated_count: 8, reorder_status: null }],
  mvno_partner: [
    { partner_id: 'p-lent', name: 'LentMobile', country_iso: 'FR', agreement_status: 'ACTIVE', failover_priority: 1, coverage_score: 0.5, latency_ms: 900, cost_per_day_xaf: 4000 },
    { partner_id: 'p-top', name: 'TopMobile', country_iso: 'FR', agreement_status: 'ACTIVE', failover_priority: 2, coverage_score: 95, latency_ms: 80, cost_per_day_xaf: 1500 }
  ],
  fraud_profile: [{ profile_id: 'fp', user_id: U, avg_transaction_amount: 0, avg_daily_transactions: 0, typical_countries: [], total_alerts: 0 }],
  currency_exchange_corridor: [
    { corridor_id: 'xaf-eur', source_currency: 'XAF', target_currency: 'EUR', is_active: true, circuit_breaker_status: 'OPEN', last_rate_checked: null },
    { corridor_id: 'eur-xaf', source_currency: 'EUR', target_currency: 'XAF', is_active: true, circuit_breaker_status: 'TRIPPED', circuit_breaker_tripped_at: new Date().toISOString() },
    { corridor_id: 'xaf-usd', source_currency: 'XAF', target_currency: 'USD', is_active: true, circuit_breaker_status: 'OPEN' }
  ],
  esim_profile: [],
  trip_declaration: [],
  travel_history: [],
  data_sovereignty_consent: [],
  forwarding_rule: [],
  currency_transaction: [],
  fraud_alert: [],
  audit_log: []
})

beforeEach(() => {
  faux.reinitialiser(baseDeDonnees())
  a17.viderCachesTaux()
})

describe('algo05 — sélection du réseau eSIM', () => {
  test('ICCID : 19 chiffres, préfixe 89 + indicatif, clé de Luhn valide', () => {
    const iccid = a05.genererICCID('FR')
    assert.match(iccid, /^8933\d{15}$/)
    assert.equal(a05.verifierLuhn(iccid), true)
    assert.equal(a05.verifierLuhn('79927398713'), true)
    assert.equal(a05.verifierLuhn('79927398710'), false)
  })

  test('meilleur partenaire (couverture 0–100 normalisée)', () => {
    assert.equal(a05.classerPartenaires(faux.tables.mvno_partner)[0].partenaire.name, 'TopMobile')
  })

  test('provisioning chez le meilleur partenaire, puis bascule en cas d\'échec', async () => {
    const succes = await a05.selectionReseauEsim({ userId: U, numberId: 'n-fr', paysISO: 'FR' })
    assert.equal(succes.statut, 'SUCCES')
    assert.equal(succes.partenaire, 'TopMobile')
    assert.equal(faux.tables.esim_profile[0].iccid, succes.iccid)

    const appels = []
    const bascule = await a05.selectionReseauEsim({ userId: U, numberId: 'n-fr', paysISO: 'FR' }, {
      fournisseur: async ({ partenaire }) => {
        appels.push(partenaire.name)
        return { statut: partenaire.name === 'LentMobile' ? 'SUCCESS' : 'ERROR' }
      }
    })
    assert.equal(bascule.partenaire, 'LentMobile')
    assert.deepEqual(appels, ['TopMobile', 'LentMobile'])

    const echec = await a05.selectionReseauEsim({ userId: U, numberId: 'n-fr', paysISO: 'FR' }, { fournisseur: async () => ({ statut: 'ERROR' }) })
    assert.equal(echec.statut, 'ECHEC_PROVISIONING')
  })

  test('roaming UE gratuit et absence de partenaire', async () => {
    faux.tables.users[0].country_of_residence = 'BE'
    assert.equal((await a05.selectionReseauEsim({ userId: U, numberId: 'n-fr', paysISO: 'FR' })).statut, 'ROAMING_GRATUIT')
    assert.equal((await a05.selectionReseauEsim({ userId: U, numberId: 'n-fr', paysISO: 'JP' })).statut, 'AUCUN_PARTENAIRE')
  })
})

describe('algo06 — prédiction de destination', () => {
  const historique = [
    { country_iso: 'FR', arrival_detected_at: '2025-12-05T08:00:00Z' },
    { country_iso: 'FR', arrival_detected_at: '2024-12-12T08:00:00Z' },
    { country_iso: 'FR', declaration_time: '2025-11-20T08:00:00Z' },
    { country_iso: 'BE', arrival_detected_at: '2025-06-02T08:00:00Z' },
    { country_iso: 'CM', arrival_detected_at: '2025-08-01T08:00:00Z' }
  ]

  test('écart de mois circulaire', () => {
    assert.equal(a06.ecartMois(12, 1), 1)
    assert.equal(a06.ecartMois(3, 9), 6)
  })

  test('pays d\'origine exclu, déclarations comptées, suggestion ≥ 60 %', async () => {
    faux.tables.travel_history = historique.map((h, i) => ({ history_id: `h${i}`, user_id: U, ...h }))
    const resultat = await a06.predictionPreAtterrissage(U, { paysOrigine: 'CM', maintenant: new Date('2026-12-01T10:00:00Z') })
    assert.equal(resultat.totalVoyages, 5)
    assert.equal(resultat.suggestion.pays, 'FR')
    assert.ok(resultat.suggestion.probabilite >= a06.SEUIL_SUGGESTION)
    assert.ok(!resultat.destinationsScorees.some((d) => d.pays === 'CM'))
  })

  test('historique insuffisant', async () => {
    const resultat = await a06.predictionPreAtterrissage(U, { paysOrigine: 'CM' })
    assert.equal(resultat.raison, 'HISTORIQUE_INSUFFISANT')
  })
})

describe('algo07 — détection de fraude', () => {
  test('profil vierge : pas de suspension à la première transaction', async () => {
    assert.equal((await a07.detectionFraudeIA(U, { montant: 900000, pays: 'FR' })).statut, 'NORMAL')
  })

  test('règles déterministes et plafond du score statistique', async () => {
    Object.assign(faux.tables.fraud_profile[0], { avg_transaction_amount: 10000, avg_daily_transactions: 1, typical_countries: ['CM', 'FR'] })

    const montant = await a07.detectionFraudeIA(U, { montant: 60000, pays: 'FR' })
    assert.equal(montant.statut, 'SUSPENDU')
    assert.equal(montant.typeAnomalie, 'AMOUNT')
    assert.equal(faux.tables.virtual_number[0].status, 'SUSPENDED')
    assert.equal(faux.tables.fraud_alert.length, 1)

    const statistique = await a07.detectionFraudeIA(U, { montant: 35000, pays: 'FR' })
    assert.deepEqual([statistique.statut, statistique.typeAnomalie], ['ALERTE', 'ML_DETECTION'])

    const localisation = await a07.detectionFraudeIA(U, { montant: 9000, pays: 'JP' })
    assert.equal(localisation.typeAnomalie, 'LOCATION')

    assert.equal((await a07.detectionFraudeIA(U, { montant: 10500, pays: 'FR' })).statut, 'NORMAL')
  })

  test('fréquence : plus de 20 transactions dans l\'heure', async () => {
    Object.assign(faux.tables.fraud_profile[0], { avg_transaction_amount: 10000, avg_daily_transactions: 30, typical_countries: ['FR'] })
    faux.tables.currency_transaction = Array.from({ length: 21 }, (_, i) => ({ transaction_id: `t${i}`, user_id: U, status: 'CONFIRMED', created_at: new Date().toISOString() }))
    assert.equal((await a07.detectionFraudeIA(U, { montant: 10000, pays: 'FR' })).typeAnomalie, 'FREQUENCY')
  })

  test('apprentissage : moyenne lissée et pays ajouté', async () => {
    Object.assign(faux.tables.fraud_profile[0], { avg_transaction_amount: 10000, typical_countries: ['CM'] })
    await a07.apprendreTransaction(U, { montant: 20000, pays: 'SN' })
    assert.equal(faux.tables.fraud_profile[0].avg_transaction_amount, 11000)
    assert.deepEqual(faux.tables.fraud_profile[0].typical_countries, ['CM', 'SN'])
  })
})

describe('algo14 — souveraineté des données', () => {
  test('résolution : base prioritaire, pays non référencé signalé', () => {
    assert.equal(a14.resoudreRegionCloud('NG', undefined, 'af-south-1').region, 'af-south-1')
    assert.equal(a14.resoudreRegionCloud('NG').loi, 'NON_REFERENCE')
    assert.equal(a14.verifierConformiteRegion('eu-west-1', 'af-south-1'), false)
    assert.equal(a14.verifierConformiteRegion('eu-central-1', 'eu-west-1'), true)
  })

  test('écriture routée vers la bonne région, violation bloquée', async () => {
    const ecriture = await a14.routerEcriture(U, 'PROFILE')
    assert.equal(ecriture.regionCible, 'af-south-1')
    assert.equal(faux.tables.users[0].data_region, 'af-south-1')
    const violation = await a14.routerEcriture(U, 'PROFILE', { regionDemandee: 'us-east-1' })
    assert.equal(violation.raison, 'VIOLATION_SOUVERAINETE')
  })
})

describe('algo15 — attribution des numéros DID', () => {
  test('calcul du numéro : largeur conservée, plage respectée', () => {
    assert.equal(a15.calculerProchainNumero('+33700000000', 8), '+33700000008')
    assert.equal(a15.calculerProchainNumero('+33700000000', 100, '+33700000099'), null)
  })

  test('attributions simultanées → numéros distincts (compare-and-swap)', async () => {
    const numeros = await Promise.all(['u1', 'u2', 'u3'].map((id) => a15.attribuerNumeroDID(id, 'FR')))
    assert.equal(new Set(numeros.map((n) => n.did_number)).size, 3)
    assert.equal(faux.tables.did_pool[0].allocated_count, 11)
    assert.equal(faux.tables.did_pool[0].reorder_status, null) // 11 % : sous le seuil de 90 %
  })

  test('alerte de réapprovisionnement au franchissement de 90 %', async () => {
    faux.tables.did_pool[0].allocated_count = 89
    await a15.attribuerNumeroDID('u90', 'FR')
    assert.equal(faux.tables.did_pool[0].allocated_count, 90)
    assert.equal(faux.tables.did_pool[0].reorder_status, 'REORDER_PENDING')
  })

  test('numéro existant en base → rang suivant ; pas d\'activation à la création', async () => {
    faux.tables.virtual_number.push({ number_id: 'histo', user_id: 'x', country_iso: 'FR', did_number: '+33700000008', status: 'PARKED' })
    const numero = await a15.attribuerNumeroDID('nouveau', 'FR')
    assert.equal(numero.did_number, '+33700000009')
    assert.equal(numero.activated_at, undefined)
  })

  test('numéro persistant : ACTIVE conservé, SUSPENDED refusé, PARKED réactivé', async () => {
    assert.equal((await a15.attribuerNumeroDID(U, 'FR')).status, 'ACTIVE')
    faux.tables.virtual_number[0].status = 'SUSPENDED'
    assert.equal((await attendreRejet(a15.attribuerNumeroDID(U, 'FR'))).statut, 409)
    faux.tables.virtual_number[0].status = 'PARKED'
    assert.equal((await a15.attribuerNumeroDID(U, 'FR')).status, 'AWAITING_ARRIVAL')
  })
})

describe('algo16 — moteur de forwarding', () => {
  const regles = [
    { rule_id: 'r1', number_id: 'autre', trigger_condition: 'ALWAYS', action: 'REJECT', priority: 1 },
    { rule_id: 'r2', number_id: null, trigger_condition: 'BUSY', action: 'VOICEMAIL', priority: 2 },
    { rule_id: 'r3', number_id: 'n-fr', trigger_condition: 'NO_ANSWER', action: 'FORWARD', target_number: null, priority: 3 },
    { rule_id: 'r4', number_id: 'n-fr', trigger_condition: 'NO_ANSWER', action: 'FORWARD', target_number: '+33700000001', priority: 4 },
    { rule_id: 'r5', number_id: 'n-fr', trigger_condition: 'NO_ANSWER', action: 'FORWARD', target_number: '+237699000001', priority: 5 }
  ]

  test('règles filtrées par numéro appelé, règles inapplicables ignorées', () => {
    const duNumero = a16.filtrerReglesDuNumero(regles, 'n-fr')
    assert.equal(duNumero.length, 4)
    const occupe = a16.choisirRegle(duNumero, { statutLigne: 'OCCUPE', userId: U, numeroAppele: '+33700000001' })
    assert.equal(occupe.destination, `VOICEMAIL_${U}`)
    const sansReponse = a16.choisirRegle(duNumero, { statutLigne: 'SANS_REPONSE', userId: U, numeroAppele: '+33700000001' })
    assert.equal(sansReponse.regle.rule_id, 'r5') // r3 sans cible et r4 en boucle ignorées
  })

  test('statut de ligne normalisé', () => {
    assert.equal(a16.normaliserStatutLigne('Sans_Reponse'), 'SANS_REPONSE')
    assert.equal(a16.normaliserStatutLigne('busy'), 'OCCUPE')
    assert.equal(a16.normaliserStatutLigne(undefined), 'LIBRE')
  })

  test('moteur complet : DID sans « + », cache invalidé, DID inconnu rejeté', async () => {
    faux.tables.forwarding_rule.push({ rule_id: 'r9', user_id: U, number_id: 'n-fr', trigger_condition: 'ALWAYS', action: 'FORWARD', target_number: '+237699000001', is_active: true, priority: 1 })
    a16.invaliderCacheRegles(U)
    const renvoi = await a16.moteurRegleForwarding('33700000001', '+33611111111', 'LIBRE')
    assert.deepEqual([renvoi.decision, renvoi.codeSIP], ['FORWARD', '302 Moved Temporarily'])
    const inconnu = await a16.moteurRegleForwarding('+33799999999', 'anonymous')
    assert.deepEqual([inconnu.decision, inconnu.codeSIP], ['REJECT', '486 Busy Here'])
  })
})

describe('algo17 — conversion de devises', () => {
  test('parité fixe XAF→EUR et arrondis par devise', async () => {
    const devis = await a17.preparerConversion({ deviseSource: 'XAF', deviseCible: 'EUR', montant: 100000 })
    assert.deepEqual([devis.montantBrut, devis.commission, devis.montantNet, devis.sourceTaux], [152.45, 2.29, 150.16, 'PARITE_FIXE'])
    assert.equal(devis.montantEquivalentXAF, 100000)
    assert.equal(a17.arrondir(1.005, 2), 1.01)
  })

  test('plafonds AML (500 XAF – 10 000 000 XAF)', async () => {
    assert.match((await attendreRejet(a17.preparerConversion({ deviseSource: 'XAF', deviseCible: 'EUR', montant: 400 }))).message, /faible/)
    assert.match((await attendreRejet(a17.preparerConversion({ deviseSource: 'XAF', deviseCible: 'EUR', montant: 20000000 }))).message, /plafond/)
  })

  test('circuit breaker : bloqué < 60 min, réarmé au-delà', async () => {
    assert.equal((await attendreRejet(a17.preparerConversion({ deviseSource: 'EUR', deviseCible: 'XAF', montant: 100 }))).statut, 503)
    faux.tables.currency_exchange_corridor[1].circuit_breaker_tripped_at = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    const devis = await a17.preparerConversion({ deviseSource: 'EUR', deviseCible: 'XAF', montant: 100 })
    assert.equal(devis.montantBrut, 65596)
    assert.equal(faux.tables.currency_exchange_corridor[1].circuit_breaker_status, 'OPEN')
  })

  test('fluctuation > 3 % → disjonction', async () => {
    faux.tables.currency_exchange_corridor[0].last_rate_checked = 0.0016
    assert.equal((await attendreRejet(a17.preparerConversion({ deviseSource: 'XAF', deviseCible: 'EUR', montant: 100000 }))).statut, 503)
    assert.equal(faux.tables.currency_exchange_corridor[0].circuit_breaker_status, 'TRIPPED')
  })

  test('taux croisés BCE (document XML injecté, aucun appel réseau)', async () => {
    const xml = "<Cube><Cube time='2026-11-18'><Cube currency='USD' rate='1.0800'/></Cube></Cube>"
    const taux = await a17.recupererTauxChange('XAF', 'USD', { forcer: true, recuperer: async () => ({ ok: true, text: async () => xml }) })
    assert.ok(Math.abs(taux.taux - 1.08 / 655.957) < 1e-12)
    assert.equal(taux.source, 'BCE')
  })
})

describe('algo18 — profil miroir', () => {
  test('nom affiché réel (jamais le téléphone) + base contractuelle de 30 jours', async () => {
    const resultat = await a18.synchroniserProfilMiroir(U, 'n-fr')
    assert.equal(resultat.profilMiroir.display_name, 'Awa Mbarga')
    assert.doesNotMatch(JSON.stringify(resultat.profilMiroir), /699000001/)
    assert.equal(resultat.profilMiroir.avatar_url, null)
    const consentement = faux.tables.data_sovereignty_consent[0]
    assert.equal(consentement.legal_basis, 'CONTRACTUAL')
    assert.ok(Date.parse(consentement.expires_at) - Date.now() > 29 * 86400000)
  })

  test('refus explicite respecté (aucun consentement recréé)', async () => {
    faux.tables.data_sovereignty_consent.push({ user_id: U, destination_country: 'FR', data_type: 'PROFILE', is_granted: false, granted_at: new Date().toISOString() })
    const resultat = await a18.synchroniserProfilMiroir(U, 'n-fr')
    assert.equal(resultat.profilMiroir.display_name, 'Utilisateur Orange')
    assert.equal(faux.tables.data_sovereignty_consent.length, 1)
  })

  test('avatar interdit en Arabie saoudite, numéro d\'autrui introuvable', async () => {
    faux.tables.data_sovereignty_consent.push({ user_id: U, destination_country: 'SA', data_type: 'AVATAR', is_granted: true, granted_at: new Date().toISOString(), expires_at: '2099-01-01T00:00:00Z' })
    const resultat = await a18.synchroniserProfilMiroir(U, 'n-sa')
    assert.equal(resultat.statut, 'SYNCHRONISE_PARTIEL')
    assert.equal(resultat.profilMiroir.avatar_url, null)
    assert.equal((await a18.synchroniserProfilMiroir(U2, 'n-fr')).statut, 'NUMERO_INTROUVABLE')
  })
})

describe('algo19 — JIT Stock Manager', () => {
  beforeEach(() => {
    faux.tables.did_pool.push({ pool_id: 'pool-sa', country_iso: 'SA', status: 'ACTIVE', range_end: '+966500000999', total_numbers: 1000, allocated_count: 950, reorder_status: null })
    faux.tables.mvno_partner.push({ partner_id: 'm-sa', name: 'SaudiNet', country_iso: 'SA', agreement_status: 'ACTIVE', failover_priority: 1 })
  })

  test('commande à 95 % d\'occupation, plage étendue sans concaténation', async () => {
    const commandes = []
    const rapport = await a19.JITStockManager({ appelerApi: async (endpoint, commande) => { commandes.push(commande); return { statut: 'ACCEPTEE' } } })
    const sa = rapport.find((ligne) => ligne.poolId === 'pool-sa')
    assert.deepEqual([sa.action, sa.quantite], ['COMMANDE_PASSEE', 10000])
    assert.equal(commandes[0].debut, '+966500001000')
    const deuxieme = await a19.JITStockManager({ appelerApi: async () => ({ statut: 'ACCEPTEE' }) })
    assert.equal(deuxieme.find((ligne) => ligne.poolId === 'pool-sa').action, 'COMMANDE_DEJA_EN_COURS')
  })

  test('commande refusée → statut restauré ; seuil de 7 jours', async () => {
    const rapport = await a19.JITStockManager({ paysISO: 'SA', appelerApi: async () => ({ statut: 'REFUSEE' }) })
    assert.equal(rapport[0].action, 'ECHEC_COMMANDE')
    assert.equal(faux.tables.did_pool.find((p) => p.pool_id === 'pool-sa').reorder_status, null)
    assert.equal(a19.besoinReapprovisionnement(0.1, 6.5), true)
    assert.equal(a19.besoinReapprovisionnement(0.1, 8), false)
  })
})

describe('algo20 — déclaration de destination', () => {
  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

  test('règles de dates et pays supporté', async () => {
    assert.equal((await attendreRejet(a20.declarerDestination({ userId: U2, paysISO: 'FR', dateDepart: '2020-01-01' }))).statut, 400)
    assert.equal((await attendreRejet(a20.declarerDestination({ userId: U2, paysISO: 'FR', dateDepart: demain, dateRetour: '2020-01-01' }))).statut, 400)
    assert.match((await attendreRejet(a20.declarerDestination({ userId: U2, paysISO: 'JP', dateDepart: demain }))).message, /disponible/)
  })

  test('création avec numéro attribué, puis idempotence', async () => {
    const creee = await a20.declarerDestination({ userId: U2, paysISO: 'FR', dateDepart: demain })
    assert.equal(creee.statut, 'CREEE')
    assert.equal(creee.declaration.number_id, creee.numeroVirtuel.number_id)
    assert.equal(faux.tables.travel_history.length, 1)
    const existante = await a20.declarerDestination({ userId: U2, paysISO: 'FR', dateDepart: demain })
    assert.equal(existante.statut, 'EXISTANTE')
  })
})
