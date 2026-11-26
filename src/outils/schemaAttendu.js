'use strict'

// ════════════════════════════════════════════════════════════
// Schéma attendu par le backend (déduit du code), source unique pour
// la vérification « npm run verifier:schema ». Documenté aussi dans
// database/schema_attendu.sql.
//
//   table optionnelle : le backend fonctionne sans (repli documenté)
//   colonne : true  = indispensable (le backend échoue sans elle)
//             texte = optionnelle ; le texte décrit l'impact de son absence
// ════════════════════════════════════════════════════════════

const SANS_SCORE = 'partenaires départagés uniquement par failover_priority'

const SCHEMA_ATTENDU = Object.freeze([
  {
    table: 'users',
    colonnes: {
      user_id: true, phone_number: true, country_of_residence: true, kyc_status: true,
      kyc_verified_at: true, data_region: true, pin_hash: true, pin_salt: true, deleted_at: true,
      plan_id: 'forfait non enregistré à l\'inscription',
      residence_status: 'statut de résidence non enregistré',
      global_identity_status: 'statut de synchronisation d\'identité non enregistré',
      user_origin_type: 'origine du compte (ORANGE_NATIVE) non enregistrée',
      display_name: 'profil miroir : le nom affiché est toujours « Utilisateur Orange »',
      avatar_url: 'profil miroir : aucune photo affichée',
      home_orange_affiliate: 'profil miroir : filiale d\'origine absente',
      role: 'administrateurs déclarés uniquement par ADMIN_USER_IDS'
    }
  },
  {
    table: 'country',
    colonnes: {
      country_iso: true, name_fr: true, data_region: true, did_enabled: true,
      roaming_zone: 'roaming UE gratuit jamais détecté : une eSIM est proposée même entre pays de l\'UE'
    }
  },
  {
    table: 'did_pool',
    colonnes: {
      pool_id: true, country_iso: true, range_start: true, total_numbers: true,
      allocated_count: true, status: true, reorder_status: true,
      range_end: 'plage non étendue lors des réapprovisionnements'
    }
  },
  {
    table: 'virtual_number',
    colonnes: {
      number_id: true, user_id: true, did_number: true, country_iso: true, did_pool_id: true,
      status: true, is_permanent_owner: true, activated_at: true, suspended_at: true,
      mirror_display_name: true, mirror_avatar_url: true, mirror_synced_at: true, created_at: true
    }
  },
  {
    table: 'forwarding_rule',
    colonnes: {
      rule_id: true, user_id: true, number_id: true, trigger_condition: true,
      action: true, target_number: true, priority: true, is_active: true
    }
  },
  {
    table: 'trip_declaration',
    colonnes: {
      declaration_id: true, user_id: true, destination_country: true, departure_date: true,
      return_date: true, status: true, number_id: true, vault_prepared: true,
      declaration_time: true, arrival_confirmed_at: true, return_confirmed_at: true,
      has_own_esim: 'mode BYOE (eSIM personnelle du voyageur) indisponible'
    }
  },
  {
    table: 'travel_history',
    colonnes: {
      user_id: true, country_iso: true, declared_destination: true, declaration_time: true,
      arrival_detected_at: true, detection_method: true,
      created_at: 'aucun (date de secours uniquement)'
    }
  },
  {
    table: 'esim_profile',
    colonnes: {
      user_id: true, number_id: true, iccid: true, country_iso: true, plan_type: true,
      data_quota_mb: true, data_used_mb: true, status: true, activated_at: true,
      provider_id: 'partenaire de chaque eSIM non enregistré'
    }
  },
  {
    table: 'currency_exchange_corridor',
    colonnes: {
      corridor_id: true, source_currency: true, target_currency: true, is_active: true,
      circuit_breaker_status: true, circuit_breaker_tripped_at: true, last_rate_checked: true
    }
  },
  {
    table: 'currency_transaction',
    colonnes: {
      transaction_id: true, user_id: true, source_currency: true, target_currency: true,
      source_amount: true, gross_amount: true, commission_amount: true, net_amount: true,
      exchange_rate: true, rate_source: true, status: true, created_at: true,
      rate_timestamp: 'horodatage du taux appliqué non conservé'
    }
  },
  {
    table: 'data_sovereignty_consent',
    colonnes: {
      user_id: true, destination_country: true, data_type: true, is_granted: true,
      granted_at: true, expires_at: true, legal_basis: true
    }
  },
  {
    table: 'fraud_profile',
    colonnes: {
      user_id: true, avg_transaction_amount: true, avg_daily_transactions: true,
      typical_countries: true, typical_hours: true, anomaly_score: true, total_alerts: true,
      last_alert_at: true, model_version: true,
      profile_id: 'alertes de fraude non reliées au profil'
    }
  },
  {
    table: 'mvno_partner',
    optionnelle: 'sans partenaire, eSIM et réapprovisionnement indisponibles',
    colonnes: {
      partner_id: true, name: true, country_iso: true, agreement_status: true, failover_priority: true,
      coverage_score: SANS_SCORE,
      latency_ms: SANS_SCORE,
      cost_per_day_xaf: SANS_SCORE,
      esim_sm_dp_url: 'aucun tant que le SM-DP+ est simulé',
      api_endpoint: 'commandes de numéros adressées à sip_endpoint',
      sip_endpoint: 'point d\'accès des commandes de numéros inconnu'
    }
  },
  {
    table: 'session',
    optionnelle: 'sessions conservées en mémoire : tous les utilisateurs sont déconnectés à chaque redémarrage',
    colonnes: { user_id: true, device_id: true, access_token_hash: true, refresh_token_hash: true, expires_at: true }
  },
  {
    table: 'device',
    optionnelle: 'règle anti-fraude « appareil inconnu » désactivée',
    colonnes: { user_id: true, device_id: true, last_seen_at: true }
  },
  {
    table: 'fraud_alert',
    optionnelle: 'alertes de fraude non conservées (journalisées seulement)',
    colonnes: {
      user_id: true, alert_type: true, anomaly_score: true, action_taken: true,
      profile_id: 'alerte non reliée au profil de fraude',
      triggered_by: 'détail de la transaction en cause non conservé'
    }
  },
  {
    table: 'audit_log',
    optionnelle: 'journal d\'audit désactivé',
    colonnes: {
      user_id: true, entity_type: true, action: true, actor_type: true,
      ip_address: 'adresse IP non conservée dans l\'audit',
      data_region: 'région de stockage non conservée dans l\'audit',
      details: 'détails des alertes de certificate pinning non conservés'
    }
  }
].map((entree) => Object.freeze(entree)))

module.exports = { SCHEMA_ATTENDU }
