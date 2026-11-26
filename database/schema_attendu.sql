-- ════════════════════════════════════════════════════════════════════
-- Smart Roam — schéma de base attendu par le backend (PostgreSQL / Supabase)
--
-- DÉDUIT DU CODE : à confronter au schéma réel AVANT toute exécution.
-- Toutes les instructions sont non destructives (IF NOT EXISTS) : elles
-- créent ce qui manque sans modifier une table existante. Les index
-- uniques échouent si des doublons existent déjà : les nettoyer d'abord.
--
-- Légende : [optionnel] = le backend fonctionne sans (repli documenté).
-- Le backend doit utiliser la clé service_role (RLS contournée côté serveur).
-- ════════════════════════════════════════════════════════════════════

-- ── Référentiels ────────────────────────────────────────────────────
create table if not exists country (
  country_iso   char(2) primary key,              -- ISO 3166-1 alpha-2
  name_fr       text not null,
  data_region   text,                             -- ex. eu-west-1, af-south-1 (algo 14)
  did_enabled   boolean not null default false,   -- numéros virtuels disponibles
  roaming_zone  text                              -- [optionnel] EU_FREE = roaming UE gratuit (algo 05)
);

-- ── Utilisateurs et sessions ────────────────────────────────────────
create table if not exists users (
  user_id                 uuid primary key default gen_random_uuid(),
  phone_number            text not null,          -- E.164 (+237699123456)
  country_of_residence    char(2) references country (country_iso),
  kyc_status              text not null default 'PENDING',   -- PENDING | VERIFIED | REJECTED
  kyc_verified_at         timestamptz,
  plan_id                 uuid,
  data_region             text,
  residence_status        text,
  global_identity_status  text,
  user_origin_type        text,
  pin_hash                text,                   -- scrypt$v=1$N=…$poivre=…$sel$hash (algo 11)
  pin_salt                text,
  mfa_secret              text,
  display_name            text,                   -- nom affiché du profil miroir (algo 18)
  avatar_url              text,
  home_orange_affiliate   text,
  role                    text default 'USER',    -- [optionnel] USER | ADMIN (sinon ADMIN_USER_IDS)
  deleted_at              timestamptz,            -- suppression logique
  created_at              timestamptz not null default now()
);

-- [optionnel] sans cette table, les sessions sont conservées en mémoire (perdues au redémarrage)
create table if not exists session (
  session_id          uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users (user_id),
  device_id           text,
  access_token_hash   text,
  refresh_token_hash  text not null,              -- SHA-256 du refresh token (jamais en clair)
  expires_at          timestamptz not null,
  created_at          timestamptz not null default now()
);

-- [optionnel] appareils connus : sans elle, la règle anti-fraude DEVICE est ignorée (algo 07)
create table if not exists device (
  device_id     text not null,
  user_id       uuid not null references users (user_id),
  last_seen_at  timestamptz not null default now(),
  primary key (user_id, device_id)
);

-- ── Numéros virtuels ────────────────────────────────────────────────
create table if not exists did_pool (
  pool_id          uuid primary key default gen_random_uuid(),
  country_iso      char(2) not null references country (country_iso),
  range_start      text not null,                 -- premier numéro de la plage (+33700000000)
  range_end        text,                          -- dernier numéro de la plage
  total_numbers    integer not null check (total_numbers >= 0),
  allocated_count  integer not null default 0 check (allocated_count >= 0),
  status           text not null default 'ACTIVE',
  reorder_status   text,                          -- REORDER_PENDING | REORDER_CONFIRMED
  created_at       timestamptz not null default now()
);

create table if not exists virtual_number (
  number_id            uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users (user_id),
  did_number           text not null,
  country_iso          char(2) not null references country (country_iso),
  did_pool_id          uuid references did_pool (pool_id),
  status               text not null,             -- AWAITING_ARRIVAL | ACTIVE | PARKED | SUSPENDED
  is_permanent_owner   boolean not null default true,
  activated_at         timestamptz,               -- renseigné à l'arrivée (algo 01)
  suspended_at         timestamptz,               -- suspension anti-fraude (algo 07)
  mirror_display_name  text,
  mirror_avatar_url    text,
  mirror_synced_at     timestamptz,
  created_at           timestamptz not null default now()
);

create table if not exists forwarding_rule (
  rule_id            uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users (user_id),
  number_id          uuid references virtual_number (number_id),  -- NULL = règle globale
  trigger_condition  text not null,               -- ALWAYS | BUSY | NO_ANSWER | NEVER
  action             text not null,               -- FORWARD | VOICEMAIL | REJECT | RING
  target_number      text,                        -- obligatoire pour FORWARD
  priority           integer not null default 1,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

-- ── Voyages ─────────────────────────────────────────────────────────
create table if not exists trip_declaration (
  declaration_id       uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users (user_id),
  destination_country  char(2) not null references country (country_iso),
  departure_date       date not null,
  return_date          date,
  status               text not null default 'PENDING',  -- PENDING | CONFIRMED | COMPLETED | CANCELLED
  number_id            uuid references virtual_number (number_id),
  vault_prepared       boolean not null default false,
  has_own_esim         boolean not null default false,    -- [optionnel] mode BYOE (algo 05)
  declaration_time     timestamptz not null default now(),
  arrival_confirmed_at timestamptz,
  return_confirmed_at  timestamptz
);

create table if not exists travel_history (
  history_id            uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users (user_id),
  country_iso           char(2) not null,
  declared_destination  char(2),
  declaration_time      timestamptz,
  arrival_detected_at   timestamptz,              -- renseigné à l'arrivée (algo 01)
  detection_method      text,                     -- MANUAL | AUTO
  created_at            timestamptz not null default now()
);

-- ── eSIM ────────────────────────────────────────────────────────────
-- [optionnel] sans partenaire, l'eSIM est indisponible (503)
create table if not exists mvno_partner (
  partner_id         uuid primary key default gen_random_uuid(),
  name               text not null,
  country_iso        char(2) not null references country (country_iso),
  agreement_status   text not null default 'ACTIVE',
  failover_priority  integer not null default 1,
  coverage_score     numeric,                     -- 0–1 ou 0–100
  latency_ms         integer,                     -- [optionnel]
  cost_per_day_xaf   numeric,
  esim_sm_dp_url     text,
  api_endpoint       text,
  sip_endpoint       text
);

create table if not exists esim_profile (
  esim_id        uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (user_id),
  number_id      uuid references virtual_number (number_id),
  iccid          text,                            -- 19 chiffres, clé de Luhn
  provider_id    uuid references mvno_partner (partner_id),  -- [optionnel]
  country_iso    char(2) not null,
  plan_type      text not null,                   -- DAY | WEEK | MONTH | BYOE
  data_quota_mb  integer,
  data_used_mb   integer default 0,
  status         text not null default 'ACTIVE',
  activated_at   timestamptz,                     -- [optionnel]
  created_at     timestamptz not null default now()
);

-- ── Change de devises ───────────────────────────────────────────────
create table if not exists currency_exchange_corridor (
  corridor_id                 uuid primary key default gen_random_uuid(),
  source_currency             char(3) not null,
  target_currency             char(3) not null,
  is_active                   boolean not null default true,
  circuit_breaker_status      text default 'OPEN',   -- OPEN | TRIPPED
  circuit_breaker_tripped_at  timestamptz,
  last_rate_checked           numeric
);

create table if not exists currency_transaction (
  transaction_id     uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users (user_id),
  source_currency    char(3) not null,
  target_currency    char(3) not null,
  source_amount      numeric not null,
  gross_amount       numeric not null,
  commission_amount  numeric not null,
  net_amount         numeric not null,
  exchange_rate      numeric not null,
  rate_source        text,                        -- PARITE_FIXE | BCE
  rate_timestamp     timestamptz,                 -- [optionnel]
  status             text not null,
  created_at         timestamptz not null default now()
);

-- ── Consentements et fraude ─────────────────────────────────────────
create table if not exists data_sovereignty_consent (
  consent_id           uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users (user_id),
  destination_country  char(2) not null,
  data_type            text not null,             -- PROFILE | LOCATION | TRANSACTION | AVATAR
  is_granted           boolean not null,
  granted_at           timestamptz,
  expires_at           timestamptz,
  legal_basis          text                       -- RGPD_CONSENT | CONTRACTUAL
);

create table if not exists fraud_profile (
  profile_id              uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references users (user_id),
  avg_transaction_amount  numeric not null default 0,
  avg_daily_transactions  numeric not null default 0,
  typical_countries       jsonb not null default '[]',
  typical_hours           jsonb not null default '[]',
  anomaly_score           numeric not null default 0,
  total_alerts            integer not null default 0,
  last_alert_at           timestamptz,
  model_version           text,
  updated_at              timestamptz
);

create table if not exists fraud_alert (
  alert_id       uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (user_id),
  profile_id     uuid references fraud_profile (profile_id),  -- [optionnel]
  alert_type     text not null,                   -- AMOUNT | FREQUENCY | LOCATION | DEVICE | ML_DETECTION
  anomaly_score  numeric not null,
  triggered_by   jsonb,                           -- [optionnel]
  action_taken   text,                            -- ALERT_ONLY | SUSPEND_NUMBER
  created_at     timestamptz not null default now()
);

-- [optionnel] sans cette table, le journal d'audit est désactivé (avertissement au démarrage)
create table if not exists audit_log (
  log_id       bigint generated always as identity primary key,
  user_id      uuid,
  entity_type  text not null,
  action       text not null,
  actor_type   text,                              -- USER | ADMIN | SERVICE | SYSTEM | ANONYME
  ip_address   text,                              -- [optionnel]
  data_region  text,                              -- [optionnel]
  details      jsonb,                             -- [optionnel]
  created_at   timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════
-- Contraintes recommandées (vérifier l'absence de doublons au préalable)
-- ════════════════════════════════════════════════════════════════════
create unique index if not exists users_phone_number_uq        on users (phone_number);
create unique index if not exists virtual_number_did_uq        on virtual_number (did_number);
create unique index if not exists esim_profile_iccid_uq        on esim_profile (iccid) where iccid is not null;
create unique index if not exists session_refresh_hash_uq      on session (refresh_token_hash);
create unique index if not exists fraud_profile_user_uq        on fraud_profile (user_id);
create unique index if not exists consent_user_pays_type_uq    on data_sovereignty_consent (user_id, destination_country, data_type);

-- Index de performance des requêtes du backend
create index if not exists virtual_number_user_pays_idx   on virtual_number (user_id, country_iso);
create index if not exists forwarding_rule_user_idx       on forwarding_rule (user_id, is_active, priority);
create index if not exists trip_declaration_user_idx      on trip_declaration (user_id, status);
create index if not exists travel_history_user_idx        on travel_history (user_id);
create index if not exists currency_transaction_user_idx  on currency_transaction (user_id, created_at desc);
create index if not exists audit_log_created_idx          on audit_log (created_at desc);
