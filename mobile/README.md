# Smart Roam — application mobile

Application Expo (React Native, TypeScript, Expo Router) du service Smart Roam, pour Android, iOS et le web. Elle utilise l'API du dossier parent (`../`).

## Essayer en mode démo sur son téléphone

1. Sur l'ordinateur, à la racine du dépôt, lancer l'API de démonstration :

   ```bash
   npm run demo:serveur
   ```

   La commande affiche l'adresse « Réseau local » à saisir dans l'application, par exemple `http://192.168.1.20:3000`. Les données sont fictives et aucune base réelle n'est utilisée.

2. Dans ce dossier, lancer l'application :

   ```bash
   npm install
   npx expo start
   ```

3. Installer **Expo Go** sur le téléphone (Play Store ou App Store), puis scanner le QR code. Le téléphone doit être sur **le même Wi-Fi** que l'ordinateur.
4. L'application détecte seule l'adresse de l'ordinateur. Si l'accueil affiche « Serveur injoignable », touchez « Changer d'adresse » et saisissez l'adresse « Réseau local ».
5. Sur l'accueil, touchez un **compte de démonstration** : Awa (voyageuse), Moussa (en mission) ou Support Orange (administrateur).

L'onglet **Démo** permet de :

- simuler une arrivée dans un pays (réseau, Wi-Fi d'aéroport, antenne relais) ;
- lancer les tâches automatiques ;
- consulter l'état global ;
- tout remettre à zéro.

Sur la fiche d'un numéro, on peut aussi simuler un appel entrant.

Pour une présentation, le scénario commenté peut être joué sur ce même serveur, une étape à chaque appui sur Entrée :

```bash
npm run demo -- --url http://localhost:3000 --pause
```

Le scénario remet d'abord la démo à zéro, ce qui déconnecte l'application. Reconnectez-vous ensuite pour voir le résultat :

- le voyage d'Awa est terminé ;
- l'alerte de fraude de Moussa est visible côté support ;
- le stock français a été réapprovisionné.

Navigateur : `npx expo start --web` ouvre l'application sur `http://localhost:8081`.

## Écrans

| Espace | Contenu |
|---|---|
| Accueil | Voyage en cours ou destination suggérée, numéros, détection d'arrivée |
| Voyages | Déclaration (destination, dates), liste, annulation |
| Numéros | Statut, règles de renvoi d'appels, profil miroir (nom, photo, consentement), eSIM |
| Argent | Devis de change, confirmation par PIN, historique |
| Profil | Nom affiché, consentements RGPD, changement de PIN, déconnexion, serveur |
| Démo | Outils de simulation (mode démo uniquement) |
| Support | Stocks de numéros, réapprovisionnement, alertes de fraude, levée de suspension (administrateurs) |

Création de compte et PIN oublié passent par un **code SMS**, affiché à l'écran en mode démo.

## Architecture

```
src/app/          écrans (Expo Router : un fichier = une route)
src/api/          client HTTP (renouvellement des jetons), appels de l'API, types, requêtes partagées
src/session/      session (jetons dans le stockage sécurisé), adresse du serveur, mode démo
src/composants/   confirmation par PIN, état du serveur, jauge de stock
src/ui/           thème clair / sombre, composants d'interface
src/utils/        formats (téléphones, dates, montants), règles du PIN, signaux réseau
```

Sécurité :

- les jetons sont gardés dans le trousseau sécurisé du téléphone (Keychain, Keystore), et dans `localStorage` sur le web ;
- le jeton de confirmation par PIN reste en mémoire seulement, 4 minutes ;
- un changement de compte vide le cache des données.

## Vérifications

```bash
npm run typecheck          # TypeScript strict
npx expo lint              # ESLint (configuration Expo)
npm run export:web         # construction complète (dossier dist/)
```

## Limites actuelles

- **Détection réelle de l'arrivée** :
  - le MCC/MNC du réseau n'est lisible que sur Android ;
  - le SSID du Wi-Fi exige une permission de localisation, que cette version ne demande pas ;
  - le Cell-ID n'est pas exposé par Expo et demandera un module natif ;
  - le pays de l'adresse IP demandera un service GeoIP côté serveur.

  En mode démo, l'onglet Démo simule ces signaux.
- **Notifications push** (fraude, arrivée) : non branchées.
- **Publication sur les stores** : il faut un compte Google Play et Apple Developer, les identifiants d'application (`android.package`, `ios.bundleIdentifier` dans `app.json`), l'icône, l'écran de démarrage et une API en **HTTPS**. Une API en HTTP n'est acceptée qu'en développement avec Expo Go.
