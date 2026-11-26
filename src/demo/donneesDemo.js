'use strict'

// ════════════════════════════════════════════════════════════
// Jeu de données du MODE DÉMO — entièrement fictif.
//
//   Awa Ngono (Cameroun)   voyage chaque année à Paris à cette période ;
//                          son numéro français l'attend en parking.
//   Moussa Diop (Sénégal)  en mission à Bruxelles : numéro belge actif,
//                          eSIM data en cours, renvoi vers sa messagerie.
//   Support Orange (ADMIN) exploitation : stocks de numéros, fraude.
//
// Numéros français dans la plage 06 39 98 xx xx (réservée par l'ARCEP aux
// œuvres de fiction) ; autres numéros fictifs. Aucun appel ni SMS n'est
// émis en mode démo. Domaines partenaires en .invalid (RFC 2606).
// Les dates sont relatives à « maintenant » : la démo reste cohérente
// quel que soit le jour de la présentation (ex. prédiction saisonnière).
// ════════════════════════════════════════════════════════════

const { hacherPIN } = require('../algorithms/algo11_hachagePIN')
const { genererICCID, QUOTA_DATA_MO } = require('../algorithms/algo05_selectionReseauESIM')
const { calculerConversion, PARITES_FIXES_EUR } = require('../algorithms/algo17_conversionDevises')
const { resoudreRegionCloud } = require('../algorithms/algo14_cloisonnementSouverainete')

const MS_PAR_JOUR = 24 * 60 * 60 * 1000

const ID = Object.freeze({
  awa: 'de000000-0000-4000-8000-000000000001',
  moussa: 'de000000-0000-4000-8000-000000000002',
  support: 'de000000-0000-4000-8000-0000000000ad',
  poolFR: 'de000000-0000-4000-8001-000000000033',
  poolBE: 'de000000-0000-4000-8001-000000000032',
  poolMA: 'de000000-0000-4000-8001-000000000212',
  numeroAwaFR: 'de000000-0000-4000-8002-000000000001',
  numeroMoussaBE: 'de000000-0000-4000-8002-000000000002',
  voyageAwaFR: 'de000000-0000-4000-8003-000000000001',
  voyageMoussaBE: 'de000000-0000-4000-8003-000000000002',
  regleMoussa: 'de000000-0000-4000-8004-000000000001',
  partenaireFR1: 'de000000-0000-4000-8005-000000000001',
  partenaireFR2: 'de000000-0000-4000-8005-000000000002',
  partenaireBE: 'de000000-0000-4000-8005-000000000003',
  partenaireMA: 'de000000-0000-4000-8005-000000000004',
  profilFraudeAwa: 'de000000-0000-4000-8006-000000000001',
  profilFraudeMoussa: 'de000000-0000-4000-8006-000000000002'
})

// Comptes présentés publiquement par GET /api/demo (PIN compris : démo uniquement).
const COMPTES_DEMO = Object.freeze([
  {
    cle: 'awa',
    userId: ID.awa,
    nom: 'Awa Ngono',
    telephone: '+237690000001',
    pin: '2580',
    role: 'USER',
    pays: 'CM',
    deviceId: 'demo-telephone-awa',
    couleur: '#FF7900',
    presentation: 'Commerciale à Douala. Elle part à Paris chaque année à cette période : son numéro français l\'attend en parking.'
  },
  {
    cle: 'moussa',
    userId: ID.moussa,
    nom: 'Moussa Diop',
    telephone: '+221770000002',
    pin: '3691',
    role: 'USER',
    pays: 'SN',
    deviceId: 'demo-telephone-moussa',
    couleur: '#4BB4E6',
    presentation: 'Ingénieur à Dakar, en mission à Bruxelles : numéro belge actif, eSIM data en cours.'
  },
  {
    cle: 'support',
    userId: ID.support,
    nom: 'Support Orange (démo)',
    telephone: '+237690000099',
    pin: '1470',
    role: 'ADMIN',
    pays: 'CM',
    deviceId: 'demo-poste-support',
    couleur: '#595959',
    presentation: 'Exploitation : stocks de numéros, réapprovisionnement, levée des suspensions après fraude.'
  }
].map((compte) => Object.freeze(compte)))

// Numéros utiles au scénario.
const NUMEROS_DEMO = Object.freeze({
  awaFR: '+33639980007', // numéro français persistant d'Awa
  soeurAwaParis: '+33639980042', // renvoi en cas de non-réponse
  moussaBE: '+32460990042',
  correspondantParis: '+33639980311'
})

const AFFILIATIONS = Object.freeze({ CM: 'Orange Cameroun', SN: 'Orange Sénégal' })

const transactionPassee = ({ userId, deviseSource, deviseCible, montant, date }) => {
  const taux = PARITES_FIXES_EUR[deviseCible] / PARITES_FIXES_EUR[deviseSource]
  const { montantBrut, commission, montantNet } = calculerConversion({ montant, tauxChange: taux, deviseCible })
  return {
    user_id: userId,
    source_currency: deviseSource,
    target_currency: deviseCible,
    source_amount: montant,
    gross_amount: montantBrut,
    commission_amount: commission,
    net_amount: montantNet,
    exchange_rate: Number(taux.toPrecision(8)),
    rate_source: 'PARITE_FIXE',
    rate_timestamp: date,
    status: 'CONFIRMED',
    created_at: date
  }
}

// Construit toutes les tables (PIN hachés avec la configuration courante).
const construireDonneesDemo = async ({ maintenant = new Date() } = {}) => {
  const t = maintenant.getTime()
  const date = (jours) => new Date(t + jours * MS_PAR_JOUR).toISOString()
  const jour = (jours) => date(jours).slice(0, 10)
  const region = (pays) => resoudreRegionCloud(pays).region

  const hachages = await Promise.all(COMPTES_DEMO.map((compte) => hacherPIN(compte.pin)))

  const users = COMPTES_DEMO.map((compte, i) => ({
    user_id: compte.userId,
    phone_number: compte.telephone,
    country_of_residence: compte.pays,
    kyc_status: 'VERIFIED',
    kyc_verified_at: date(-400),
    data_region: region(compte.pays),
    pin_hash: hachages[i].hash,
    pin_salt: hachages[i].sel,
    deleted_at: null,
    plan_id: null,
    residence_status: 'RESIDENT',
    global_identity_status: 'SYNCED',
    user_origin_type: 'ORANGE_NATIVE',
    display_name: compte.nom,
    avatar_url: `/api/demo/avatars/${compte.cle}.svg`,
    home_orange_affiliate: AFFILIATIONS[compte.pays] || null,
    role: compte.role,
    created_at: date(-800)
  }))

  const pays = [
    { country_iso: 'CM', name_fr: 'Cameroun', did_enabled: false, roaming_zone: 'CEMAC' },
    { country_iso: 'SN', name_fr: 'Sénégal', did_enabled: false, roaming_zone: 'UEMOA' },
    { country_iso: 'CI', name_fr: 'Côte d\'Ivoire', did_enabled: false, roaming_zone: 'UEMOA' },
    { country_iso: 'FR', name_fr: 'France', did_enabled: true, roaming_zone: 'EU_FREE' },
    { country_iso: 'BE', name_fr: 'Belgique', did_enabled: true, roaming_zone: 'EU_FREE' },
    { country_iso: 'MA', name_fr: 'Maroc', did_enabled: true, roaming_zone: null }
  ].map((ligne) => ({ ...ligne, data_region: region(ligne.country_iso) }))

  // Pool français à 90,5 % : le JIT Stock Manager doit commander (algo 19).
  const pools = [
    { pool_id: ID.poolFR, country_iso: 'FR', range_start: '+33639980000', range_end: '+33639989999', total_numbers: 10000, allocated_count: 9050, status: 'ACTIVE', reorder_status: null },
    { pool_id: ID.poolBE, country_iso: 'BE', range_start: '+32460990000', range_end: '+32460990999', total_numbers: 1000, allocated_count: 120, status: 'ACTIVE', reorder_status: null },
    { pool_id: ID.poolMA, country_iso: 'MA', range_start: '+212600990000', range_end: '+212600990999', total_numbers: 1000, allocated_count: 3, status: 'ACTIVE', reorder_status: null }
  ]

  const numeros = [
    {
      number_id: ID.numeroAwaFR,
      user_id: ID.awa,
      did_number: NUMEROS_DEMO.awaFR,
      country_iso: 'FR',
      did_pool_id: ID.poolFR,
      status: 'PARKED', // conservé entre deux voyages
      is_permanent_owner: true,
      activated_at: date(-154),
      suspended_at: null,
      mirror_display_name: 'Awa Ngono',
      mirror_avatar_url: null,
      mirror_synced_at: date(-154),
      created_at: date(-721)
    },
    {
      number_id: ID.numeroMoussaBE,
      user_id: ID.moussa,
      did_number: NUMEROS_DEMO.moussaBE,
      country_iso: 'BE',
      did_pool_id: ID.poolBE,
      status: 'ACTIVE',
      is_permanent_owner: true,
      activated_at: date(-3),
      suspended_at: null,
      mirror_display_name: 'Moussa Diop',
      mirror_avatar_url: null,
      mirror_synced_at: date(-3),
      created_at: date(-5)
    }
  ]

  const voyages = [
    {
      declaration_id: ID.voyageAwaFR,
      user_id: ID.awa,
      destination_country: 'FR',
      departure_date: jour(-154),
      return_date: jour(-140),
      status: 'COMPLETED',
      number_id: ID.numeroAwaFR,
      vault_prepared: false,
      has_own_esim: false,
      declaration_time: date(-157),
      arrival_confirmed_at: date(-154),
      return_confirmed_at: date(-140)
    },
    {
      declaration_id: ID.voyageMoussaBE,
      user_id: ID.moussa,
      destination_country: 'BE',
      departure_date: jour(-3),
      return_date: jour(11),
      status: 'CONFIRMED',
      number_id: ID.numeroMoussaBE,
      vault_prepared: false,
      has_own_esim: false,
      declaration_time: date(-5),
      arrival_confirmed_at: date(-3),
      return_confirmed_at: null
    }
  ]

  // Historique d'Awa : Paris à cette période il y a 1 et 2 ans, Paris il y a
  // 5 mois, Dakar il y a 3 mois. Multiples de 7 jours : même jour de semaine
  // qu'aujourd'hui → prédiction « France » à 77,5 % (algo 06).
  const voyagePasse = (userId, paysISO, joursArrivee, methode = 'AUTO') => ({
    user_id: userId,
    country_iso: paysISO,
    declared_destination: paysISO,
    declaration_time: date(joursArrivee - 3),
    arrival_detected_at: date(joursArrivee),
    detection_method: methode,
    created_at: date(joursArrivee - 3)
  })
  const historique = [
    voyagePasse(ID.awa, 'FR', -721),
    voyagePasse(ID.awa, 'FR', -364),
    voyagePasse(ID.awa, 'FR', -154),
    voyagePasse(ID.awa, 'SN', -98, 'MANUAL'),
    voyagePasse(ID.moussa, 'BE', -210),
    voyagePasse(ID.moussa, 'BE', -3)
  ]

  const partenaires = [
    { partner_id: ID.partenaireFR1, name: 'Démo Alpha Mobile', country_iso: 'FR', agreement_status: 'ACTIVE', failover_priority: 1, coverage_score: 92, latency_ms: 45, cost_per_day_xaf: 1500, esim_sm_dp_url: 'https://smdp.alpha.demo.invalid', api_endpoint: 'https://api.alpha.demo.invalid/commandes', sip_endpoint: 'sip:commandes@alpha.demo.invalid' },
    { partner_id: ID.partenaireFR2, name: 'Démo Bêta Télécom', country_iso: 'FR', agreement_status: 'ACTIVE', failover_priority: 2, coverage_score: 85, latency_ms: 30, cost_per_day_xaf: 900, esim_sm_dp_url: 'https://smdp.beta.demo.invalid', api_endpoint: 'https://api.beta.demo.invalid/commandes', sip_endpoint: 'sip:commandes@beta.demo.invalid' },
    { partner_id: ID.partenaireBE, name: 'Démo Gamma Belgique', country_iso: 'BE', agreement_status: 'ACTIVE', failover_priority: 1, coverage_score: 88, latency_ms: 40, cost_per_day_xaf: 1200, esim_sm_dp_url: 'https://smdp.gamma.demo.invalid', api_endpoint: 'https://api.gamma.demo.invalid/commandes', sip_endpoint: 'sip:commandes@gamma.demo.invalid' },
    { partner_id: ID.partenaireMA, name: 'Démo Delta Maroc', country_iso: 'MA', agreement_status: 'ACTIVE', failover_priority: 1, coverage_score: 80, latency_ms: 60, cost_per_day_xaf: 1100, esim_sm_dp_url: 'https://smdp.delta.demo.invalid', api_endpoint: 'https://api.delta.demo.invalid/commandes', sip_endpoint: 'sip:commandes@delta.demo.invalid' }
  ]

  const corridors = [['XAF', 'EUR'], ['EUR', 'XAF'], ['XAF', 'XOF'], ['XOF', 'XAF'], ['XOF', 'EUR'], ['EUR', 'XOF']]
    .map(([source, cible], i) => ({
      corridor_id: `de000000-0000-4000-8007-00000000000${i + 1}`,
      source_currency: source,
      target_currency: cible,
      is_active: true,
      circuit_breaker_status: 'OPEN',
      circuit_breaker_tripped_at: null,
      last_rate_checked: null
    }))

  const transactions = [
    transactionPassee({ userId: ID.awa, deviseSource: 'XAF', deviseCible: 'EUR', montant: 150000, date: date(-152) }),
    transactionPassee({ userId: ID.awa, deviseSource: 'XAF', deviseCible: 'EUR', montant: 40000, date: date(-145) }),
    transactionPassee({ userId: ID.moussa, deviseSource: 'XOF', deviseCible: 'EUR', montant: 60000, date: date(-2) })
  ]

  const profilsFraude = [
    { profile_id: ID.profilFraudeAwa, user_id: ID.awa, avg_transaction_amount: 60000, avg_daily_transactions: 0.1, typical_countries: ['CM', 'FR', 'SN'], typical_hours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], anomaly_score: 0, total_alerts: 0, last_alert_at: null, model_version: '1.0' },
    { profile_id: ID.profilFraudeMoussa, user_id: ID.moussa, avg_transaction_amount: 40000, avg_daily_transactions: 0.2, typical_countries: ['SN', 'BE'], typical_hours: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], anomaly_score: 0, total_alerts: 0, last_alert_at: null, model_version: '1.0' }
  ]

  return {
    users,
    country: pays,
    did_pool: pools,
    virtual_number: numeros,
    trip_declaration: voyages,
    travel_history: historique,
    forwarding_rule: [
      { rule_id: ID.regleMoussa, user_id: ID.moussa, number_id: ID.numeroMoussaBE, trigger_condition: 'NO_ANSWER', action: 'VOICEMAIL', target_number: null, priority: 1, is_active: true, created_at: date(-5) }
    ],
    esim_profile: [
      { user_id: ID.moussa, number_id: ID.numeroMoussaBE, iccid: genererICCID('BE'), provider_id: ID.partenaireBE, country_iso: 'BE', plan_type: 'WEEK', data_quota_mb: QUOTA_DATA_MO.WEEK, data_used_mb: 312, status: 'ACTIVE', activated_at: date(-3) }
    ],
    mvno_partner: partenaires,
    currency_exchange_corridor: corridors,
    currency_transaction: transactions,
    data_sovereignty_consent: [
      { user_id: ID.moussa, destination_country: 'BE', data_type: 'PROFILE', is_granted: true, granted_at: date(-3), expires_at: date(27), legal_basis: 'RGPD_CONSENT' }
    ],
    fraud_profile: profilsFraude,
    fraud_alert: [],
    device: COMPTES_DEMO.map((compte, i) => ({ user_id: compte.userId, device_id: compte.deviceId, last_seen_at: date(-1 - i) })),
    session: [],
    audit_log: []
  }
}

module.exports = { ID, COMPTES_DEMO, NUMEROS_DEMO, construireDonneesDemo }
