# Smart Roam — API backend

API REST (Node.js / Express 5 / Supabase) de **Smart Roam** : numéros virtuels par pays, activation automatique à l'arrivée, renvoi d'appels, eSIM locales, conversion de devises Orange Money, profil miroir et souveraineté des données.

> Le frontend (`mon-app/`) est un projet Vite séparé, non couvert par ce document.

---

## Démarrage rapide

Prérequis : **Node.js ≥ 22**.

```bash
npm install
cp .env.example .env        # puis renseigner SUPABASE_URL, SUPABASE_KEY, JWT_SECRET…
npm run dev                 # rechargement automatique (node --watch)
npm start                   # production
npm test                    # 135 tests, sans réseau ni base réelle
```

Vérification : `GET http://localhost:3000/api/health` (processus) et `GET /api/ready` (base joignable).

---

## Configuration (`.env`)

| Variable | Obligatoire | Rôle |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_KEY` | oui | Projet Supabase. Côté serveur, utiliser la clé **service_role** (jamais exposée au frontend). |
| `JWT_SECRET` | **oui en production** | Secret de signature des JWT (≥ 32 caractères). En développement, un secret éphémère est généré (avertissement). |
| `PIN_PEPPER` | recommandé | Poivre secret ajouté au hachage des PIN. |
| `SERVICE_API_KEY` | non | Clé des appels machine-à-machine (en-tête `x-api-key`), ex. plateforme SIP. |
| `ADMIN_USER_IDS` | non | `user_id` des administrateurs (séparés par des virgules). |
| `CORS_ORIGINS` | non | Origines navigateur autorisées. Vide en dev = `http://localhost:5173`. |
| `TRUST_PROXY` | derrière un proxy | `1`, `loopback`… pour que l'IP réelle du client soit utilisée (WAF, limitations). |
| `ENCRYPTION_KEYS` | si chiffrement utilisé | Trousseau AES-256-GCM `v1:<64 hex>[:AAAA-MM-JJ],v2:…` (dernière = courante). |
| `PARTNER_TLS_PINS`, `PARTNER_TLS_PINS_EXPIRES_AT` | non | Empreintes SPKI SHA-256 des partenaires (certificate pinning). |
| `ECB_RATES_ENABLED` | non | Taux de référence BCE pour les paires hors EUR/XAF/XOF (`true` par défaut). |
| `JIT_INTERVAL_MINUTES` | non | Fréquence du réapprovisionnement automatique des pools DID (`0` = désactivé). |
| `ICCID_ISSUER_ID`, `PORT`, `NODE_ENV`, `LOG_LEVEL` | non | Voir `.env.example`. |

---

## Architecture

```
server.js                  écoute HTTP, arrêt propre (SIGTERM/SIGINT), tâches planifiées
src/app.js                 construction de l'app : sécurité, WAF, routes, erreurs
src/config.js              lecture et validation de l'environnement (seul accès à process.env)
src/routes/                routeurs Express : authentification, rôles, propriété des données
src/controllers/           couche HTTP : validation des entrées, appel des algorithmes, réponses
src/algorithms/            règles métier (algos 01 à 20), indépendantes d'Express
src/middlewares/           auth (JWT / clé de service), erreurs JSON, sécurité, idempotence
src/utils/                 validation, accès base, journalisation sans PII, audit, limiteurs
src/taches/                planification du JIT Stock Manager
database/schema_attendu.sql   schéma attendu (déduit du code) + contraintes recommandées
test/                      tests unitaires et d'intégration (node:test, Supabase simulé)
```

| Algo | Rôle | Utilisé par |
|---|---|---|
| 01 · 08 | Fusion des signaux et scoring de confiance géographique | `POST /api/geolocalisation/arrivee` |
| 02 · 03 · 04 | Cell-ID, SSID d'aéroport, décodage MCC/MNC | géolocalisation |
| 05 | Choix du réseau et provisioning eSIM (failover, ICCID Luhn) | `POST /api/esim/provision` |
| 06 | Prédiction de destination | `/api/prediction` |
| 07 | Détection de fraude | `POST /api/currency/confirm` |
| 09 | Chiffrement AES-256-GCM (bibliothèque) | — |
| 10 · 11 | Jetons Zero Trust, hachage des PIN (scrypt) | `/api/auth`, `/api/security` |
| 12 | Certificate pinning des appels HTTPS sortants | agent HTTPS des partenaires |
| 13 | Pare-feu applicatif (WAF) | toutes les requêtes |
| 14 | Souveraineté des données (région cloud) | inscription |
| 15 · 20 | Attribution de numéro DID, déclaration de voyage | `/api/declarations` |
| 16 | Moteur de renvoi d'appels | `/api/forwarding` |
| 17 | Conversion de devises | `/api/currency` |
| 18 | Profil miroir et consentements | `/api/mirror` |
| 19 | JIT Stock Manager (réapprovisionnement) | `/api/stock`, tâche planifiée |

---

## Authentification et autorisations

1. **Inscription** `POST /api/users/register` → renvoie des jetons.
2. **Premier PIN** `POST /api/security/pin/create` (avec ces jetons).
3. **Connexion** `POST /api/auth/login` `{ phoneNumber, pin, deviceId? }` → `access_token` (15 min) + `refresh_token` (7 jours).
4. Appels : en-tête `Authorization: Bearer <access_token>`.
5. **Renouvellement** `POST /api/auth/refresh` : le refresh token est à usage unique ; sa réutilisation révoque toutes les sessions.
6. **Déconnexion** `POST /api/auth/logout` (session) ou `/logout-all` (toutes).

| Rôle | Obtention | Droits |
|---|---|---|
| `USER` | connexion | ses propres données uniquement (`userId` déduit du jeton) |
| `ADMIN` | `ADMIN_USER_IDS` ou `users.role = 'ADMIN'` | tous les comptes, opérations d'exploitation |
| `SERVICE` | en-tête `x-api-key: <SERVICE_API_KEY>` | appels machine-à-machine (évaluation d'appel, stock, KYC) |

Changer de PIN exige l'ancien PIN et révoque les sessions. Cinq échecs de PIN ou de connexion verrouillent le compte 15 minutes.

---

## Endpoints

🌐 public · 👤 utilisateur (ses données) · 🛡️ ADMIN/SERVICE · 🔑 idempotent (`Idempotency-Key` recommandé)

| Méthode | Chemin | Accès | Description |
|---|---|---|---|
| GET | `/api/health`, `/api/ready` | 🌐 | Supervision (processus / base) |
| POST | `/api/auth/login`, `/api/auth/refresh` | 🌐 | Connexion, renouvellement des jetons |
| POST | `/api/auth/logout`, `/api/auth/logout-all` | 👤 | Déconnexion |
| POST | `/api/users/register` | 🌐 | Inscription |
| GET / DELETE | `/api/users/:userId` | 👤 | Profil (liste blanche de champs) / suppression logique |
| GET | `/api/users/:userId/numbers` | 👤 | Numéros virtuels (paginé) |
| PUT | `/api/users/:userId/kyc` | 🛡️ | Statut KYC |
| POST | `/api/security/pin/create`, `/pin/verify` | 👤 | PIN : création / changement, vérification |
| POST | `/api/security/waf/analyze` | 🛡️ | Simulation du WAF sur une charge utile |
| POST | `/api/declarations/new` | 👤 🔑 | Déclarer un voyage (attribue le numéro) |
| GET | `/api/declarations/:userId` | 👤 | Déclarations (paginé) |
| PUT | `/api/declarations/:declarationId/cancel` | 👤 | Annuler (numéro mis en parking) |
| POST | `/api/geolocalisation/arrivee` | 👤 | Signaux bruts `{ mcc, mnc, ssid, cellId, cellIdConfirmation, paysIP }` → arrivée / retour |
| POST | `/api/geolocalisation/ssid`, `/mccmnc`, `/cellid` | 👤 | Analyses unitaires (alias `/api/geolocation`) |
| POST | `/api/forwarding/rules/create` | 👤 | Créer une règle de renvoi |
| GET | `/api/forwarding/rules/:userId` | 👤 | Règles (paginé) |
| PUT / DELETE | `/api/forwarding/rules/:ruleId` | 👤 | Modifier / désactiver une règle |
| POST | `/api/forwarding/evaluate` | 🛡️ | Décision de routage d'un appel entrant (code SIP) |
| POST | `/api/esim/provision` | 👤 🔑 | Provisionner l'eSIM du pays du numéro |
| GET | `/api/esim/:userId` | 👤 | eSIM (paginé) |
| GET | `/api/currency/corridors` | 👤 | Corridors ouverts |
| POST | `/api/currency/preview` | 👤 | Devis de conversion |
| POST | `/api/currency/confirm` | 👤 🔑 | Conversion (contrôle anti-fraude inclus) |
| GET | `/api/currency/history/:userId` | 👤 | Transactions (paginé) |
| POST | `/api/mirror/sync`, `/api/mirror/consent` | 👤 | Profil miroir, consentements |
| GET | `/api/mirror/:userId` | 👤 | Profils miroir (paginé) |
| POST | `/api/prediction/suggest`, `/feedback` | 👤 | Destination suggérée, réponse de l'utilisateur |
| GET | `/api/prediction/history/:userId` | 👤 | Historique de voyages (paginé) |
| GET | `/api/stock/pools` | 🛡️ | État des pools DID (paginé) |
| POST | `/api/stock/check`, `/api/stock/jit/run` | 🛡️ | Analyse JIT d'un pays / de tous les pools |
| PUT | `/api/stock/reorder/:poolId` | 🛡️ | Confirmer un réapprovisionnement |

---

## Conventions

- **Erreurs** : JSON `{ "erreur": "…", …détails }`. Une erreur 500 ne renvoie jamais de détail interne, mais une `reference` à retrouver dans les journaux.
- **Codes** : 400 validation · 401 authentification · 403 droits · 404 introuvable (ou ressource d'un autre compte) · 409 conflit · 422 clé d'idempotence réutilisée · 429 limitation (`Retry-After`) · 503 service tiers indisponible.
- **Pagination** : `?limit=` (1–200, défaut 50) et `?offset=` ; réponse `{ …, total, limit, offset }`.
- **Idempotence** : en-tête `Idempotency-Key` (8–128 caractères). Une requête rejouée renvoie la même réponse (`Idempotent-Replayed: true`).
- **Formats** : téléphones E.164, pays ISO 3166-1 alpha-2, devises ISO 4217, dates ISO 8601.

---

## Sécurité

- JWT HS256 épinglé, révocation immédiate, refresh tokens hachés et rotatifs.
- PIN : scrypt (N=2¹⁵, r=8, p=3) avec poivre et comparaison en temps constant. Les anciens hachages SHA-256 sont migrés automatiquement à la connexion.
- WAF : 100 req/s par IP, détection d'injections SQL/XSS, blocages temporaires, détection de pics, réputation. Plus des limitations dédiées sur l'inscription, la connexion et les PIN.
- En-têtes de sécurité, CORS restreint, corps limité à 100 ko, `x-powered-by` désactivé.
- Journaux sans données personnelles (numéros masqués, secrets retirés). Journal d'audit des opérations sensibles dans `audit_log` : KYC, PIN, connexions, consentements, transactions, stock.

---

## Base de données

Le schéma attendu est décrit dans [`database/schema_attendu.sql`](database/schema_attendu.sql), **déduit du code** : à comparer au schéma réel avant toute exécution.

Le backend tolère l'absence des éléments optionnels :

- **Table `session`** : les sessions sont gardées en mémoire.
- **Table `audit_log`** : l'audit est désactivé.
- **Table `device`** : la règle anti-fraude correspondante est ignorée.
- **Colonnes optionnelles** : les insertions se font sans elles.

Chaque repli est signalé dans les journaux.

Contraintes uniques fortement recommandées : `users.phone_number`, `virtual_number.did_number`, `esim_profile.iccid`. Les deux dernières complètent l'attribution atomique des numéros.

---

## Limites connues et intégrations à brancher

| Sujet | État actuel | À prévoir |
|---|---|---|
| Vérification du numéro à l'inscription | aucune (KYC `PENDING`) | OTP par SMS avant la délivrance des jetons |
| SM-DP+ (eSIM) et commandes aux partenaires MVNO | **simulés** (avertissement journalisé) | intégrations GSMA ES2+ et API partenaires (avec `creerAgentHttpsEpingle`) |
| Notifications utilisateur (fraude, voyage) | journalisées | push / SMS |
| Pays de l'adresse IP | fourni par le client (`paysIP`) | GeoIP côté serveur |
| Limiteurs, WAF, idempotence, révocations | en mémoire (un processus) | magasin partagé (Redis) en multi-instances |
| Suppression de compte | logique (`deleted_at`) | politique de conservation / anonymisation RGPD |
| Consentement contractuel par défaut pour le nom (algo 18) | appliqué pendant 30 jours si aucun choix n'existe | à valider par le DPO |

---

## Tests

```bash
npm test
```

Tests unitaires (utilitaires et 20 algorithmes) et d'intégration HTTP (socle, authentification, parcours métier), exécutés contre une base Supabase **simulée en mémoire** (`test/helpers/fauxSupabase.js`). Aucun accès réseau ni écriture dans la vraie base, et le fichier `.env` n'est jamais lu en test.

Le certificat de `test/fixtures/tls/` est un certificat autosigné `localhost`, réservé aux tests du certificate pinning.
