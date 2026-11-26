-- ════════════════════════════════════════════════════════════════════
-- Smart Roam — alignement de la base Supabase sur le backend
-- Établi d'après « npm run verifier:schema » du 21/11/2026.
--
-- À exécuter dans l'éditeur SQL de Supabase, SECTION PAR SECTION, dans
-- l'ordre, après lecture. Aucune instruction ne supprime de données.
-- Après exécution : redémarrer le backend, puis relancer
-- « npm run verifier:schema ».
-- ════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
-- SECTION 0 — DIAGNOSTIC (lecture seule, à lancer en premier)
-- ════════════════════════════════════════════════════════════════════

-- 0.1 La RLS est-elle activée ? Avec une clé publique (publishable) et
--     rls_activee = false, toute la table est lisible et modifiable par
--     quiconque détient cette clé.
select c.relname as table_publique, c.relrowsecurity as rls_activee
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- 0.2 Index uniques existants sur les colonnes critiques.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('users', 'virtual_number', 'esim_profile')
  and indexdef ilike '%unique%';

-- 0.3 Doublons qui empêcheraient la section 2 (chaque requête doit renvoyer 0 ligne).
select phone_number, count(*) from public.users group by phone_number having count(*) > 1;
select did_number, count(*) from public.virtual_number group by did_number having count(*) > 1;
select iccid, count(*) from public.esim_profile where iccid is not null group by iccid having count(*) > 1;


-- ════════════════════════════════════════════════════════════════════
-- SECTION 1 — RECOMMANDÉ : table des sessions
-- Sans elle, les sessions sont gardées en mémoire : tous les utilisateurs
-- sont déconnectés à chaque redémarrage ou déploiement du backend.
-- Le type de user_id est repris de users.user_id (uuid ou entier).
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  type_identifiant text;
begin
  select format_type(a.atttypid, a.atttypmod) into type_identifiant
  from pg_attribute a
  where a.attrelid = 'public.users'::regclass and a.attname = 'user_id';

  execute format($ddl$
    create table if not exists public.session (
      session_id          uuid primary key default gen_random_uuid(),
      user_id             %s not null references public.users (user_id) on delete cascade,
      device_id           text,
      access_token_hash   text,
      refresh_token_hash  text not null,
      expires_at          timestamptz not null,
      created_at          timestamptz not null default now()
    )$ddl$, type_identifiant);
end $$;

create unique index if not exists session_refresh_hash_uq on public.session (refresh_token_hash);
create index if not exists session_user_idx on public.session (user_id);


-- ════════════════════════════════════════════════════════════════════
-- SECTION 2 — RECOMMANDÉ : contraintes uniques
-- À exécuter seulement si les requêtes 0.3 n'ont renvoyé aucune ligne.
-- Garantissent qu'un numéro de téléphone, un numéro virtuel ou un ICCID
-- n'existent qu'une fois, même en cas de requêtes simultanées.
-- ════════════════════════════════════════════════════════════════════
create unique index if not exists users_phone_number_uq on public.users (phone_number);
create unique index if not exists virtual_number_did_uq on public.virtual_number (did_number);
create unique index if not exists esim_profile_iccid_uq on public.esim_profile (iccid) where iccid is not null;


-- ════════════════════════════════════════════════════════════════════
-- SECTION 3 — OPTIONNEL : colonnes qui activent des fonctionnalités
-- Le backend fonctionne sans elles, en mode dégradé.
-- ════════════════════════════════════════════════════════════════════

-- 3.1 Profil miroir : nom et photo affichés aux correspondants
--     (sans eux : toujours « Utilisateur Orange », sans photo).
alter table public.users add column if not exists display_name text;
alter table public.users add column if not exists avatar_url text;

-- 3.2 Administrateurs déclarés en base (sinon via ADMIN_USER_IDS) et
--     origine du compte, prévue par le code d'origine.
alter table public.users add column if not exists role text default 'USER';
alter table public.users add column if not exists user_origin_type text default 'ORANGE_NATIVE';

-- 3.3 Roaming UE gratuit (« roam like at home ») : sans cette colonne, une eSIM
--     est proposée même entre deux pays de l'UE. Codes : UE 27 + EEE.
alter table public.country add column if not exists roaming_zone text;
update public.country
set roaming_zone = 'EU_FREE'
where roaming_zone is null
  and country_iso in ('AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
                      'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
                      'IS', 'LI', 'NO');

-- 3.4 Choix du partenaire eSIM par score (couverture 60 %, latence 30 %,
--     coût 10 %) au lieu de la seule failover_priority. À renseigner ensuite.
alter table public.mvno_partner add column if not exists coverage_score numeric;
alter table public.mvno_partner add column if not exists latency_ms integer;
alter table public.mvno_partner add column if not exists cost_per_day_xaf numeric;
alter table public.mvno_partner add column if not exists api_endpoint text;

-- 3.5 Détails des alertes de sécurité et dates de création (traçabilité).
alter table public.audit_log add column if not exists details jsonb;
alter table public.travel_history add column if not exists created_at timestamptz default now();
alter table public.esim_profile add column if not exists created_at timestamptz default now();


-- ════════════════════════════════════════════════════════════════════
-- SECTION 4 — SÉCURITÉ (CRITIQUE) : activer la RLS sur toutes les tables
--
-- PRÉREQUIS ABSOLU : SUPABASE_KEY du backend = clé SECRÈTE (sb_secret_…),
-- backend redémarré. La clé secrète contourne la RLS : le backend continue
-- de fonctionner. La clé publique (publishable) n'a plus aucun accès direct
-- aux données : tout passe par l'API et ses contrôles.
--
-- ⚠ Si une autre application (mobile, frontend) interroge Supabase
--   directement avec la clé publique, elle perdra l'accès : il faudra lui
--   écrire des politiques RLS ou la faire passer par l'API.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Contrôle : toutes les lignes doivent afficher rls_activee = true.
select c.relname as table_publique, c.relrowsecurity as rls_activee
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;
