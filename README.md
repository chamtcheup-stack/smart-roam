# Smart Roam — API backend

API REST (Node.js / Express 5 / Supabase) de **Smart Roam** : numéros virtuels par pays, activation automatique à l'arrivée, renvoi d'appels, eSIM locales, conversion de devises Orange Money, profil miroir et souveraineté des données.

> L'application mobile (Expo, Android / iOS / web) est dans [`mobile/`](mobile/README.md). L'ancien projet Vite `mon-app/` n'est plus utilisé par l'application mobile.

---

## Démarrage rapide

Prérequis : **Node.js ≥ 22**.

```bash
npm install
cp .env.example .env        # puis renseigner SUPABASE_URL, SUPABASE_KEY, JWT_SECRET…
npm run dev                 # rechargement automatique (node --watch)
npm start                   # production
npm test                    # 205 tests, sans réseau ni base réelle
npm run verifier:schema     # compare votre base Supabase au schéma attendu (lecture seule)
npm run demo                # démonstration commentée (données fictives, aucune base)
npm run demo:serveur        # API de démonstration pour l'application mobile
```

Vérification : `GET http://localhost:3000/api/health` (processus) et `GET /api/ready` (base joignable).

---

## Mode démo

Pour **montrer le fonctionnement sans base ni opérateur réels** : l'API complète tourne sur des données fictives en mémoire.

| Commande | Usage |
|---|---|
| `npm run demo` | Joue un scénario commenté de 18 étapes dans le terminal (`--pause` : attend « Entrée » entre les étapes). |
| `npm run demo:serveur` | Lance l'API de démonstration (port 3000) et affiche l'adresse à saisir dans l'application mobile. |
| `npm run demo -- --url http://localhost:3000` | Joue le scénario sur un serveur déjà lancé, pendant que l'application mobile est ouverte. |

Le scénario suit trois personnages fictifs :

- **Awa** est prévenue de son voyage à Paris, qui est prédit. Elle déclare le voyage, configure ses renvois et son profil miroir. Son escale à Casablanca est ignorée. À l'atterrissage à CDG, son numéro s'active et une eSIM est installée. Elle reçoit des appels, change des FCFA en euros avec confirmation par PIN, puis rentre à Douala, et son numéro passe en parking.
- **Moussa** se fait voler son téléphone : la tentative de fraude est bloquée et sa ligne suspendue. Le support la rétablit.
- **Le support Orange** voit le stock de numéros français s'épuiser : la commande et la livraison sont automatiques.

| Compte | Téléphone | PIN | Rôle |
|---|---|---|---|
| Awa Ngono (Cameroun) | `+237690000001` | `2580` | utilisateur |
| Moussa Diop (Sénégal) | `+221770000002` | `3691` | utilisateur |
| Support Orange (démo) | `+237690000099` | `1470` | administrateur |

**Outils de simulation** (`/api/demo`, présents uniquement en démo) :

- signaux réseau d'un pays (`GET /api/demo/signaux/FR`), à renvoyer tels quels à `/api/geolocalisation/arrivee` ;
- appel entrant (`POST /api/demo/appel-entrant`) ;
- maintenance immédiate ;
- état global ;
- remise à zéro (`POST /api/demo/reinitialiser`, qui oblige chaque appareil à se reconnecter).

Les codes SMS sont renvoyés dans la réponse (`codeDemo`).

Garanties :

- `DEMO_MODE=true` est **refusé si `NODE_ENV=production`** ;
- aucune connexion à Supabase, même si `SUPABASE_URL` est renseignée ;
- aucun appel sortant ;
- chaque réponse porte l'en-tête `X-Smart-Roam-Mode: demo`.

Les numéros français utilisent la plage 06 39 98 xx xx, que l'ARCEP réserve aux œuvres de fiction.

---

## Configuration (`.env`)

| Variable | Obligatoire | Rôle |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_KEY` | oui | Projet Supabase. Côté serveur, utiliser la clé **service_role** (jamais exposée au frontend). |
| `JWT_SECRET` | **oui en production** | Secret de signature des JWT (≥ 32 caractères). En développement, un secret éphémère est généré (avertissement). |
| `PIN_PEPPER` | recommandé | Poivre secret ajouté au hachage des PIN. |
| `SERVICE_API_KEY` | non | Clé des appels machine-à-machine (en-tête `x-api-key`), ex. plateforme SIP. |
| `ADMIN_USER_IDS` | non | `user_id` des administrateurs (séparés par des virgules). |
| `CORS_ORIGINS` | non | Origines navigateur autorisées. Vide en dev = Vite (`localhost:5173`) et Expo web (`localhost:8081`). |
| `OTP_PROVIDER` | **oui en production** | Fournisseur des codes SMS : `aucun` (défaut en production : inscription impossible tant qu'un fournisseur réel n'est pas branché), `console` (développement), `demo` (mode démo). |
| `OTP_REQUIRED` | non | Code SMS exigé à l'inscription (`true` par défaut en production et en démo). |
| `DEMO_MODE` | non | `true` : mode démo (données fictives en mémoire). Refusé en production. |
| `TRUST_PROXY` | derrière un proxy | `1`, `loopback`… pour que l'IP réelle du client soit utilisée (WAF, limitations). |
| `ENCRYPTION_KEYS` | si chiffrement utilisé | Trousseau AES-256-GCM `v1:<64 hex>[:AAAA-MM-JJ],v2:…` (dernière = courante). |
| `PARTNER_TLS_PINS`, `PARTNER_TLS_PINS_EXPIRES_AT` | non | Empreintes SPKI SHA-256 des partenaires (certificate pinning). |
| `ECB_RATES_ENABLED` | non | Taux de référence BCE pour les paires hors EUR/XAF/XOF (`true` par défaut). |
| `JIT_INTERVAL_MINUTES` | non | Fréquence du réapprovisionnement automatique des pools DID (`0` = désactivé). |
| `MAINTENANCE_INTERVAL_MINUTES` | non | Clôture des voyages échus, expiration des forfaits eSIM, purge des sessions (`60` par défaut). |
| `SUPABASE_TIMEOUT_MS` | non | Délai maximal d'une requête vers la base (`8000`) : au-delà, réponse 503 au lieu d'une requête bloquée. |
| `LIMITE_CONNEXIONS_IP_15MIN`, `LIMITE_ECHECS_CONNEXION_IP_15MIN`, `LIMITE_INSCRIPTIONS_IP_HEURE`, `WAF_MAX_REQUETES_SECONDE` | non | Seuils par adresse IP, élevés par défaut : les opérateurs mobiles partagent une IP entre des milliers d'abonnés (CGNAT). |
| `LOG_FORMAT` | non | `texte` ou `json` (une ligne JSON par évènement, pour un outil de supervision). |
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
src/taches/                tâches planifiées : JIT Stock Manager, maintenance
src/demo/                  mode démo : base en mémoire, données fictives, simulateurs, scénario
src/outils/                schéma attendu et vérification du schéma réel
scripts/verifier-schema.js commande « npm run verifier:schema »
docs/openapi.yaml          spécification OpenAPI 3.1 (servie hors production sur /api/docs/openapi.yaml)
database/schema_attendu.sql   schéma attendu (déduit du code) + contraintes recommandées
test/                      tests unitaires et d'intégration (node:test, Supabase simulé)
.github/workflows/         intégration continue (tests sur Node 22 et 24, audit des dépendances)
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

1. **Code SMS** `POST /api/auth/otp` `{ phoneNumber, motif: "INSCRIPTION" }`. Ce code prouve que l'utilisateur possède le numéro. Il comporte 6 chiffres, reste valable 5 minutes et accepte 5 essais au plus. Un même numéro reçoit au plus 1 code par minute et 5 par heure.
2. **Inscription** `POST /api/users/register` `{ phoneNumber, countryResidence, otpCode }` → renvoie des jetons.
3. **Premier PIN** `POST /api/security/pin/create` (avec ces jetons).
4. **Connexion** `POST /api/auth/login` `{ phoneNumber, pin, deviceId? }` → `access_token` (15 min) + `refresh_token` (7 jours). La réponse indique aussi le `role` et le `display_name`.
5. Appels : en-tête `Authorization: Bearer <access_token>`.
6. **Renouvellement** `POST /api/auth/refresh` : le refresh token est à usage unique ; sa réutilisation révoque toutes les sessions.
7. **Déconnexion** `POST /api/auth/logout` (la session et son refresh token sont fermés, même sans le refresh token) ou `/logout-all` (toutes).
8. **PIN oublié** : `POST /api/auth/otp` (motif `PIN_OUBLIE`), puis `POST /api/auth/pin-oublie` `{ phoneNumber, otpCode, nouveauPin }`. Toutes les sessions sont fermées.

| Rôle | Obtention | Droits |
|---|---|---|
| `USER` | connexion | ses propres données uniquement (`userId` déduit du jeton) |
| `ADMIN` | `ADMIN_USER_IDS` ou `users.role = 'ADMIN'` | tous les comptes, opérations d'exploitation |
| `SERVICE` | en-tête `x-api-key: <SERVICE_API_KEY>` | appels machine-à-machine (évaluation d'appel, stock, KYC) |

Changer de PIN exige l'ancien PIN et révoque les sessions.

**Confirmation par PIN des opérations sensibles** (conversion de devises, suppression du compte) :
`POST /api/security/pin/verify` renvoie un `jetonSensible` valable 5 minutes, rattaché à la session.
Sans lui, ces opérations répondent `401` avec le code `CONFIRMATION_PIN_REQUISE`.

**Verrou progressif anti-force brute**, partagé par la connexion et la vérification du PIN :
après 5 échecs, le compte est verrouillé 15 min, puis 1 h, 4 h et 24 h aux verrouillages suivants.
Le niveau est oublié après 24 h sans incident. Un PIN à 4 chiffres ne peut ainsi plus être essayé
qu'environ 25 fois par jour. Le support lève un verrou avec `POST /api/security/pin/unlock` (ADMIN / SERVICE).
Par adresse IP, seuls les **échecs** de connexion sont comptés : des milliers d'abonnés derrière une même IP
d'opérateur peuvent se connecter normalement.

---

## Endpoints

🌐 public · 👤 utilisateur (ses données) · 🛡️ ADMIN/SERVICE · 🔐 PIN confirmé (jeton sensible) · 🔑 idempotent (`Idempotency-Key` recommandé)

Spécification complète : [`docs/openapi.yaml`](docs/openapi.yaml). Un test vérifie qu'elle reste alignée sur les routes réelles.

| Méthode | Chemin | Accès | Description |
|---|---|---|---|
| GET | `/api/health`, `/api/ready` | 🌐 | Supervision (processus / base) |
| GET | `/api/pays` | 🌐 | Pays référencés (résidence, destinations avec numéro disponible) |
| POST | `/api/auth/otp` | 🌐 | Code de vérification par SMS (inscription, PIN oublié) |
| POST | `/api/auth/login`, `/api/auth/refresh` | 🌐 | Connexion, renouvellement des jetons |
| POST | `/api/auth/pin-oublie` | 🌐 | Nouveau PIN après code SMS |
| POST | `/api/auth/logout`, `/api/auth/logout-all` | 👤 | Déconnexion |
| POST | `/api/users/register` | 🌐 | Inscription (code SMS exigé en production) |
| GET / PUT / DELETE | `/api/users/:userId` | 👤 / 👤 / 👤 🔐 | Profil et rôle / nom affiché (profils miroir resynchronisés) / suppression logique |
| GET | `/api/users/:userId/numbers` | 👤 | Numéros virtuels (paginé) |
| PUT | `/api/users/:userId/kyc` | 🛡️ | Statut KYC |
| POST | `/api/security/pin/create`, `/pin/verify` | 👤 | PIN : création / changement, vérification |
| POST | `/api/security/pin/unlock` | 🛡️ | Lever le verrouillage anti-force brute d'un compte |
| POST | `/api/security/waf/analyze` | 🛡️ | Simulation du WAF sur une charge utile |
| GET | `/api/security/fraud-alerts` | 🛡️ | Alertes de fraude (filtre `?userId=`) |
| PUT | `/api/security/numbers/:numberId/reactivate` | 🛡️ | Lever la suspension anti-fraude d'un numéro |
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
| POST | `/api/currency/confirm` | 👤 🔐 🔑 | Conversion (contrôle anti-fraude inclus) |
| GET | `/api/currency/history/:userId` | 👤 | Transactions (paginé) |
| POST | `/api/mirror/sync`, `/api/mirror/consent` | 👤 | Profil miroir, consentements |
| GET | `/api/mirror/:userId` | 👤 | Profils miroir (paginé) |
| GET | `/api/mirror/consents/:userId` | 👤 | Consentements, avec leur état (accordé / refusé / expiré) |
| POST | `/api/prediction/suggest`, `/feedback` | 👤 | Destination suggérée, réponse de l'utilisateur |
| GET | `/api/prediction/history/:userId` | 👤 | Historique de voyages (paginé) |
| GET | `/api/stock/pools` | 🛡️ | État des pools DID (paginé) |
| POST | `/api/stock/check`, `/api/stock/jit/run` | 🛡️ | Analyse JIT d'un pays / de tous les pools |
| PUT | `/api/stock/reorder/:poolId` | 🛡️ | Confirmer un réapprovisionnement |
| GET / POST | `/api/demo/…` | 🌐 / 👤 | **Mode démo uniquement** : comptes, signaux simulés, appel entrant, maintenance, état, remise à zéro |

---

## Conventions

- **Erreurs** : JSON `{ "erreur": "…", …détails }`. Une erreur 500 ne renvoie jamais de détail interne, mais une `reference` égale à l'en-tête `X-Request-Id`, présent dans toutes les lignes de journal de la requête.
- **Traçage** : chaque réponse porte un `X-Request-Id` (repris s'il est fourni par un proxy, généré sinon).
- **Codes** : 400 validation · 401 authentification (ou `CONFIRMATION_PIN_REQUISE`) · 403 droits · 404 introuvable (ou ressource d'un autre compte) · 409 conflit · 422 clé d'idempotence réutilisée · 429 limitation ou verrouillage (`Retry-After`) · 503 base trop lente ou service tiers indisponible.
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

## Exploitation

- **Maintenance planifiée** (toutes les 60 min par défaut) :
  - un voyage confirmé dont la date de retour est dépassée de 2 jours est clôturé ;
  - un voyage jamais commencé est annulé ;
  - les numéros devenus inutiles sont mis en parking ;
  - les forfaits eSIM DAY / WEEK / MONTH échus expirent ;
  - les sessions expirées sont purgées.

  Toutes ces mises à jour sont conditionnelles : elles n'écrasent jamais une arrivée détectée entre-temps.
- **Réapprovisionnement** : dès qu'un pool de numéros atteint 90 %, il est marqué `REORDER_REQUIRED`. La commande est ensuite passée au partenaire en arrière-plan : le pool passe `REORDER_PENDING`, sans risque de double commande. En cas d'échec, le JIT planifié retente.
- **Fraude avérée** : le numéro est suspendu et **toutes les sessions du compte sont fermées** (un téléphone volé est déconnecté). Le support consulte l'alerte et lève la suspension par l'API.
- **Concurrence** : les conversions, déclarations et provisionings eSIM d'un même utilisateur sont exécutés l'un après l'autre (contrôle anti-fraude non contournable par des requêtes simultanées).
- **Base lente** : chaque requête Supabase a un délai maximal (`SUPABASE_TIMEOUT_MS`), sans nouvelles tentatives qui cumuleraient les délais.
- **Journaux** : identifiant de requête sur chaque ligne, journal d'accès (méthode, chemin, statut, durée), format JSON optionnel (`LOG_FORMAT=json`).
- **Pool de threads** : `UV_THREADPOOL_SIZE` vaut 16 par défaut. Le hachage des PIN ne bloque plus le reste de l'API lors d'un afflux de connexions.

## Base de données

Le schéma attendu est décrit dans [`database/schema_attendu.sql`](database/schema_attendu.sql), **déduit du code**.

**Avant la mise en production, lancez `npm run verifier:schema`.** La commande compare votre base à ce que le code attend.
Elle est en lecture seule (`SELECT … LIMIT 0`, aucune donnée lue) et vérifie aussi que la clé utilisée est bien une clé serveur.
Code de sortie : 0 conforme, 1 écart bloquant, 2 base injoignable.

Le backend tolère l'absence des éléments optionnels :

- **Table `session`** : les sessions sont gardées en mémoire.
- **Table `audit_log`** : l'audit est désactivé.
- **Table `device`** : la règle anti-fraude correspondante est ignorée.
- **Colonnes optionnelles** : les insertions se font sans elles.

Chaque repli est signalé dans les journaux.

Contraintes uniques fortement recommandées : `users.phone_number`, `virtual_number.did_number`, `esim_profile.iccid`. Les deux dernières complètent l'attribution atomique des numéros.

### Aligner une base existante

Pour une base existante, suivez [`database/migrations/001_alignement_supabase.sql`](database/migrations/001_alignement_supabase.sql) (non destructive), **dans cet ordre** :

1. Mettre la **clé secrète** (`sb_secret_…`) dans `SUPABASE_KEY`, puis redémarrer le backend. Une clé `publishable` est publique : avec la RLS, le backend ne peut pas écrire ; sans RLS, n'importe qui peut lire et modifier la base.
2. **Section 0** : diagnostics en lecture seule (état de la RLS, contraintes uniques, doublons).
3. **Sections 1 et 2** : table `session` (sinon déconnexion de tous à chaque redémarrage) et contraintes uniques.
4. **Section 3**, facultative : colonnes qui activent le nom et la photo du profil miroir, le roaming UE gratuit et le score des partenaires.
5. **Section 4** : activer la RLS sur toutes les tables.
6. Redémarrer le backend et relancer `npm run verifier:schema`.

Le backend s'adapte au schéma réel : une colonne optionnelle absente est simplement ignorée, et mémorisée pour ne plus être envoyée. Les autres données de la ligne sont conservées.

---

## Limites connues et intégrations à brancher

| Sujet | État actuel | À prévoir |
|---|---|---|
| Envoi des SMS (codes OTP) | mécanisme complet ; **aucun fournisseur réel** (`OTP_PROVIDER=aucun` en production) | brancher l'API SMS (ex. Orange) dans `src/utils/otp.js` |
| SM-DP+ (eSIM) et commandes aux partenaires MVNO | **simulés** (avertissement journalisé) | intégrations GSMA ES2+ et API partenaires (avec `creerAgentHttpsEpingle`) |
| Notifications utilisateur (fraude, voyage) | journalisées | push / SMS |
| Pays de l'adresse IP | fourni par le client (`paysIP`) | GeoIP côté serveur |
| Limiteurs, verrous, WAF, idempotence, révocations, codes OTP, suggestions refusées, exclusion par utilisateur | en mémoire (un processus) | magasin partagé (Redis) en multi-instances |
| Conversion de devises | enregistrée en base, **aucun débit Orange Money** | API Orange Money (débit, solde) |
| Opérations en plusieurs étapes | sans transaction SQL (états partiels possibles en cas de panne) | fonctions PostgreSQL appelées par RPC |
| Suppression de compte | logique (`deleted_at`) | politique de conservation / anonymisation RGPD |
| Consentement contractuel par défaut pour le nom (algo 18) | appliqué pendant 30 jours si aucun choix n'existe | à valider par le DPO |

---

## Tests

```bash
npm test
```

La suite comprend :

- des tests unitaires (utilitaires et 20 algorithmes) ;
- des tests d'intégration HTTP : socle, authentification, parcours métier, reproduction du schéma réel ;
- le mode démo : scénario complet joué deux fois, outils de simulation, OTP, garde-fous.

Tous s'exécutent contre la base **en mémoire** du mode démo (`src/demo/baseMemoire.js`, fidèle aux erreurs de PostgREST). Aucun accès réseau ni écriture dans la vraie base, et le fichier `.env` n'est jamais lu en test.

Le certificat de `test/fixtures/tls/` est un certificat autosigné `localhost`, réservé aux tests du certificate pinning.
