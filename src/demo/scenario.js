'use strict'

// ════════════════════════════════════════════════════════════
// Scénario commenté du mode démo :
//   - le voyage d'Awa (Douala → escale à Casablanca → Paris → Douala) ;
//   - le vol du téléphone de Moussa à Bruxelles (anti-fraude, support) ;
//   - la vue exploitation d'Orange (stocks de numéros, tâches planifiées).
// Chaque étape passe par l'API publique, exactement comme l'application
// mobile. Utilisé par « npm run demo » et par les tests d'intégration.
// ════════════════════════════════════════════════════════════

const crypto = require('crypto')
const { COMPTES_DEMO, NUMEROS_DEMO, ID } = require('./donneesDemo')

const MS_PAR_JOUR = 24 * 60 * 60 * 1000

class EchecEtape extends Error {}

const compte = (cle) => COMPTES_DEMO.find((c) => c.cle === cle)

const attendre = (reponse, statutAttendu, quoi) => {
  if (reponse.statut !== statutAttendu) {
    const detail = reponse.json ? (reponse.json.erreur || reponse.json.message || JSON.stringify(reponse.json)) : 'réponse vide'
    throw new EchecEtape(`${quoi} : HTTP ${reponse.statut} au lieu de ${statutAttendu} (${detail})`)
  }
  return reponse.json
}

const verifier = (condition, message) => {
  if (!condition) throw new EchecEtape(message)
}

const formaterNumero = (numero) => {
  const groupes = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(numero || '')
  return groupes ? `+33 ${groupes.slice(1).join(' ')}` : numero
}

// Nombres au format français : 0.667 → « 0,667 », 0.775 → « 77,5 % ».
const nombre = (valeur, decimales = 2) => Number(valeur).toLocaleString('fr-FR', { maximumFractionDigits: decimales })
const pourcentage = (fraction) => `${nombre(fraction * 100, 1)} %`

const dateDuJour = (decalageJours = 0) => new Date(Date.now() + decalageJours * MS_PAR_JOUR).toISOString().slice(0, 10)
const cleIdempotence = () => `demo-${crypto.randomUUID()}`

const connecter = async (appel, cle, deviceId = compte(cle).deviceId) => {
  const { nom, telephone, pin } = compte(cle)
  const json = attendre(await appel('POST', '/api/auth/login', { corps: { phoneNumber: telephone, pin, deviceId } }), 200, `Connexion de ${nom}`)
  return { jeton: json.tokens.access_token, userId: json.user.user_id }
}

// Signaux simulés du pays, envoyés à la vraie chaîne de détection.
const envoyerSignaux = async (appel, jeton, paysISO) => {
  const simulation = attendre(await appel('GET', `/api/demo/signaux/${paysISO}`), 200, `Signaux simulés (${paysISO})`)
  const resultat = attendre(await appel('POST', '/api/geolocalisation/arrivee', { jeton, corps: simulation.signaux }), 200, 'Analyse des signaux')
  return { simulation, resultat }
}

const ETAPES = [
  {
    id: 'reinitialisation',
    titre: 'Remise à zéro de la démonstration',
    contexte: 'Données fictives rechargées : chaque présentation repart du même point.',
    executer: async ({ appel }) => {
      attendre(await appel('POST', '/api/demo/reinitialiser'), 200, 'Réinitialisation')
      return ['Base de démonstration rechargée — aucune base réelle, aucun opérateur contacté']
    }
  },
  {
    id: 'inscription',
    titre: 'Fatou, nouvelle cliente à Abidjan, crée son compte',
    contexte: 'Première ouverture de l\'application : numéro, code reçu par SMS, pays de résidence, puis code PIN.',
    executer: async ({ appel, resultats }) => {
      const telephone = '+2250700000003'
      const sms = attendre(await appel('POST', '/api/auth/otp', {
        corps: { phoneNumber: telephone, motif: 'INSCRIPTION' }
      }), 200, 'Envoi du code SMS')
      const sansCode = await appel('POST', '/api/users/register', { corps: { phoneNumber: telephone, countryResidence: 'CI' } })
      verifier(sansCode.statut === 400 && sansCode.json.code === 'OTP_REQUIS', 'Le code SMS devait être exigé')
      const inscription = attendre(await appel('POST', '/api/users/register', {
        corps: { phoneNumber: telephone, countryResidence: 'CI', otpCode: sms.codeDemo }
      }), 201, 'Inscription')
      attendre(await appel('POST', '/api/security/pin/create', {
        jeton: inscription.tokens.access_token,
        corps: { pin: '4826' }
      }), 200, 'Création du PIN')
      resultats.inscription = inscription.user.user_id
      return [
        `Code SMS reçu (affiché ici en démo : ${sms.codeDemo}) : il prouve que Fatou possède bien ce numéro`,
        `Compte créé pour ${inscription.user.phone_number} (Côte d'Ivoire), vérification d'identité en attente`,
        'PIN haché (scrypt) : jamais stocké ni journalisé en clair'
      ]
    }
  },
  {
    id: 'connexion',
    titre: 'Awa se connecte sur son téléphone, à Douala',
    contexte: 'Numéro + PIN ; l\'appareil est reconnu (déjà utilisé par Awa).',
    executer: async ({ appel, etat }) => {
      etat.awa = await connecter(appel, 'awa')
      return [
        'Connexion réussie : jeton d\'accès 15 min + jeton de renouvellement à usage unique (7 jours)',
        'Appareil reconnu : la règle anti-fraude « nouvel appareil » ne s\'applique pas'
      ]
    }
  },
  {
    id: 'prediction',
    titre: 'Smart Roam anticipe son prochain voyage',
    contexte: 'Algo 06 : historique des 24 derniers mois (fréquence, saison, jour de la semaine).',
    executer: async ({ appel, etat, resultats }) => {
      const reponse = attendre(await appel('POST', '/api/prediction/suggest', { jeton: etat.awa.jeton, corps: {} }), 200, 'Prédiction')
      verifier(reponse.suggestion && reponse.suggestion.paysISO === 'FR', `France attendue, obtenu : ${reponse.message}`)
      resultats.prediction = reponse.suggestion
      const { scores } = reponse.suggestion
      return [
        `Suggestion : ${reponse.suggestion.nomPays} (probabilité ${pourcentage(reponse.suggestion.probabiliteValeur)}, ${reponse.totalVoyages} voyages analysés)`,
        `Fréquence ${nombre(scores.frequence, 3)} · saison ${nombre(scores.saison, 3)} · jour de la semaine ${nombre(scores.jourSemaine, 3)}`
      ]
    }
  },
  {
    id: 'declaration',
    titre: 'Awa confirme : Douala → Paris aujourd\'hui, retour dans 12 jours',
    contexte: 'Algos 20 et 15 : déclaration du voyage, numéro français préparé avant le départ.',
    executer: async ({ appel, etat, resultats }) => {
      const reponse = attendre(await appel('POST', '/api/declarations/new', {
        jeton: etat.awa.jeton,
        entetes: { 'idempotency-key': cleIdempotence() },
        corps: { paysISO: 'FR', dateDepart: dateDuJour(), dateRetour: dateDuJour(12) }
      }), 201, 'Déclaration du voyage')
      etat.numeroFR = reponse.numeroVirtuel
      verifier(reponse.numeroVirtuel.did_number === NUMEROS_DEMO.awaFR, 'Le numéro français habituel d\'Awa était attendu')
      resultats.numeroFR = reponse.numeroVirtuel.did_number
      return [
        `Numéro français ${formaterNumero(reponse.numeroVirtuel.did_number)} : le même qu'à son dernier voyage (numéro conservé)`,
        'Statut « en attente d\'arrivée » : il ne sonnera qu\'une fois Awa à Paris'
      ]
    }
  },
  {
    id: 'renvoi',
    titre: 'Elle choisit quoi faire des appels qu\'elle ne peut pas prendre',
    contexte: 'Algo 16 : règles de renvoi évaluées par priorité à chaque appel entrant.',
    executer: async ({ appel, etat }) => {
      const numberId = etat.numeroFR.number_id
      attendre(await appel('POST', '/api/forwarding/rules/create', {
        jeton: etat.awa.jeton,
        corps: { numberId, triggerCondition: 'BUSY', action: 'VOICEMAIL', priority: 1 }
      }), 201, 'Règle « occupée »')
      attendre(await appel('POST', '/api/forwarding/rules/create', {
        jeton: etat.awa.jeton,
        corps: { numberId, triggerCondition: 'NO_ANSWER', action: 'FORWARD', targetNumber: NUMEROS_DEMO.soeurAwaParis, priority: 2 }
      }), 201, 'Règle « sans réponse »')
      return [
        'Déjà en ligne → messagerie vocale',
        `Pas de réponse → renvoi vers sa sœur à Paris (${formaterNumero(NUMEROS_DEMO.soeurAwaParis)})`
      ]
    }
  },
  {
    id: 'miroir',
    titre: 'Ce que verront ses correspondants en France',
    contexte: 'Algo 18 : profil miroir soumis au consentement (RGPD).',
    executer: async ({ appel, etat, resultats }) => {
      attendre(await appel('POST', '/api/mirror/consent', {
        jeton: etat.awa.jeton,
        corps: { paysDestination: 'FR', dataType: 'AVATAR', isGranted: true }
      }), 200, 'Consentement pour la photo')
      const reponse = attendre(await appel('POST', '/api/mirror/sync', {
        jeton: etat.awa.jeton,
        corps: { numberId: etat.numeroFR.number_id }
      }), 200, 'Synchronisation du profil miroir')
      resultats.miroir = reponse.profilMiroir
      return [
        `Nom affiché « ${reponse.profilMiroir.display_name} » · photo : ${reponse.avatarAutorise ? 'oui' : 'non'} · badge : ${reponse.badgeKYC === 'KYC_VERIFIE' ? 'identité vérifiée' : 'aucun'}`,
        'Nom : base contractuelle de 30 jours · photo : consentement explicite, retirable à tout moment'
      ]
    }
  },
  {
    id: 'escale',
    titre: 'Escale à Casablanca',
    contexte: 'Algos 04 et 01 : le téléphone capte un réseau sans rapport avec le voyage.',
    executer: async ({ appel, etat, resultats }) => {
      const { simulation, resultat } = await envoyerSignaux(appel, etat.awa.jeton, 'MA')
      verifier(resultat.decision === 'ESCALE_IGNOREE', `Escale attendue, obtenu ${resultat.decision}`)
      resultats.escale = resultat.decision
      return [
        `Réseau capté : ${simulation.operateur} (${simulation.signaux.mcc}-${simulation.signaux.mnc})`,
        'Escale ignorée : le numéro français reste en attente'
      ]
    }
  },
  {
    id: 'arrivee',
    titre: 'Atterrissage à Paris-Charles-de-Gaulle',
    contexte: 'Algos 02, 03, 04, 08 et 01 : fusion des signaux réseau, Wi-Fi, IP et antenne relais.',
    executer: async ({ appel, etat, resultats }) => {
      const { simulation, resultat } = await envoyerSignaux(appel, etat.awa.jeton, 'FR')
      verifier(resultat.decision === 'ARRIVEE_CONFIRMEE', `Arrivée attendue, obtenu ${resultat.decision}`)
      resultats.scoreArrivee = resultat.scoreConfiance
      return [
        `Signaux : ${simulation.operateur}, Wi-Fi « ${simulation.signaux.ssid} », adresse IP française, nouvelle antenne relais`,
        `Score de confiance ${resultat.scoreConfiance}/100 → arrivée confirmée, numéro français ACTIF`
      ]
    }
  },
  {
    id: 'esim',
    titre: 'Internet sur place : eSIM installée en quelques secondes',
    contexte: 'Algo 05 : meilleur partenaire (couverture 60 %, latence 30 %, coût 10 %), bascule automatique.',
    executer: async ({ appel, etat, resultats }) => {
      const reponse = attendre(await appel('POST', '/api/esim/provision', {
        jeton: etat.awa.jeton,
        entetes: { 'idempotency-key': cleIdempotence() },
        corps: { numberId: etat.numeroFR.number_id, paysISO: 'FR', plan: 'WEEK' }
      }), 201, 'Provisioning de l\'eSIM')
      resultats.esim = { partenaire: reponse.partenaire, iccid: reponse.esim.iccid }
      return [
        `Partenaire choisi : ${reponse.partenaire} · forfait 7 jours, ${reponse.esim.data_quota_mb} Mo`,
        `ICCID ${reponse.esim.iccid} (clé de contrôle valide) · expire le ${new Date(reponse.esim.expire_le).toLocaleDateString('fr-FR')}`
      ]
    }
  },
  {
    id: 'appels',
    titre: 'Trois appels arrivent sur son numéro français',
    contexte: 'La plateforme de téléphonie interroge le moteur de renvoi à chaque appel (algo 16).',
    executer: async ({ appel, etat, resultats }) => {
      const cas = [
        ['LIBRE', 'est disponible', 'RING'],
        ['OCCUPE', 'est déjà en ligne', 'VOICEMAIL'],
        ['SANS_REPONSE', 'ne répond pas', 'FORWARD']
      ]
      const lignes = []
      resultats.appels = []
      for (const [statutLigne, situation, decisionAttendue] of cas) {
        const reponse = attendre(await appel('POST', '/api/demo/appel-entrant', {
          jeton: etat.awa.jeton,
          corps: { numberId: etat.numeroFR.number_id, statutLigne }
        }), 200, `Appel entrant (Awa ${situation})`)
        verifier(reponse.decision === decisionAttendue, `${decisionAttendue} attendu (Awa ${situation}), obtenu ${reponse.decision}`)
        resultats.appels.push(reponse.decision)
        lignes.push(`Awa ${situation} → ${reponse.message}`)
      }
      return lignes
    }
  },
  {
    id: 'conversion',
    titre: 'Awa change 100 000 FCFA en euros',
    contexte: 'Algos 17, 07 et 11 : parité fixe, contrôle anti-fraude, confirmation par PIN, protection contre le double envoi.',
    executer: async ({ appel, etat, resultats }) => {
      const demande = { deviseSource: 'XAF', deviseCible: 'EUR', montant: 100000 }
      const devis = attendre(await appel('POST', '/api/currency/preview', { jeton: etat.awa.jeton, corps: demande }), 200, 'Aperçu de la conversion')

      const sansPIN = await appel('POST', '/api/currency/confirm', { jeton: etat.awa.jeton, corps: demande })
      verifier(sansPIN.statut === 401 && sansPIN.json && sansPIN.json.code === 'CONFIRMATION_PIN_REQUISE', 'La confirmation par PIN devait être exigée')

      const pin = attendre(await appel('POST', '/api/security/pin/verify', { jeton: etat.awa.jeton, corps: { pin: compte('awa').pin } }), 200, 'Vérification du PIN')
      const options = { jeton: pin.jetonSensible.access_token, entetes: { 'idempotency-key': cleIdempotence() }, corps: demande }
      const confirmation = attendre(await appel('POST', '/api/currency/confirm', options), 201, 'Confirmation de la conversion')
      const doubleEnvoi = await appel('POST', '/api/currency/confirm', options)
      verifier(
        doubleEnvoi.statut === 201 &&
        doubleEnvoi.entetes.get('idempotent-replayed') === 'true' &&
        doubleEnvoi.json.transaction.transaction_id === confirmation.transaction.transaction_id,
        'Le double envoi devait renvoyer la même transaction'
      )
      resultats.conversion = { montantNet: confirmation.transaction.net_amount, controleFraude: confirmation.controleFraude.statut }
      return [
        `1 € = 655,957 FCFA (parité fixe) · commission ${nombre(devis.commission)} € · Awa reçoit ${nombre(devis.montantNet)} €`,
        'Sans PIN : refusé → PIN saisi → autorisation valable 5 minutes',
        `Transaction confirmée · contrôle anti-fraude : ${confirmation.controleFraude.statut === 'NORMAL' ? 'normal' : confirmation.controleFraude.statut}`,
        'Double appui sur « Confirmer » : la même transaction est renvoyée, aucun double débit'
      ]
    }
  },
  {
    id: 'plafond',
    titre: 'Change au-delà du plafond anti-blanchiment',
    contexte: 'Algo 17 : 10 000 000 FCFA maximum par opération.',
    executer: async ({ appel, etat }) => {
      const reponse = await appel('POST', '/api/currency/preview', {
        jeton: etat.awa.jeton,
        corps: { deviseSource: 'EUR', deviseCible: 'XAF', montant: 20000 }
      })
      verifier(reponse.statut === 400, `Refus attendu, obtenu HTTP ${reponse.statut}`)
      return [`20 000 € ≈ ${Number(reponse.json.montantEquivalentXAF).toLocaleString('fr-FR')} FCFA → refusé : ${reponse.json.erreur}`]
    }
  },
  {
    id: 'retour',
    titre: 'Retour à Douala',
    contexte: 'Algo 01 : retour détecté dans le pays d\'origine → mode parking.',
    executer: async ({ appel, etat, resultats }) => {
      const { resultat } = await envoyerSignaux(appel, etat.awa.jeton, 'CM')
      verifier(resultat.decision === 'RETOUR_DETECTE', `Retour attendu, obtenu ${resultat.decision}`)
      const liste = attendre(await appel('GET', `/api/users/${etat.awa.userId}/numbers`, { jeton: etat.awa.jeton }), 200, 'Liste des numéros')
      const numero = liste.numeros.find((n) => n.number_id === etat.numeroFR.number_id)
      resultats.statutApresRetour = numero.status
      return [
        `Score de confiance ${resultat.scoreConfiance}/100 → voyage clôturé`,
        `Numéro ${formaterNumero(numero.did_number)} en parking : il reste à Awa pour son prochain voyage`
      ]
    }
  },
  {
    id: 'fraude',
    titre: 'Le téléphone de Moussa est volé à Bruxelles',
    contexte: 'Algo 07 : le voleur connaît le PIN et tente de vider le compte Orange Money.',
    executer: async ({ appel, etat, resultats }) => {
      const voleur = await connecter(appel, 'moussa', 'appareil-inconnu-7f3a')
      const pin = attendre(await appel('POST', '/api/security/pin/verify', { jeton: voleur.jeton, corps: { pin: compte('moussa').pin } }), 200, 'PIN saisi par le voleur')
      const tentative = await appel('POST', '/api/currency/confirm', {
        jeton: pin.jetonSensible.access_token,
        entetes: { 'idempotency-key': cleIdempotence() },
        corps: { deviseSource: 'XOF', deviseCible: 'EUR', montant: 1500000 }
      })
      verifier(tentative.statut === 403, `Blocage attendu, obtenu HTTP ${tentative.statut}`)
      const sessionVoleur = await appel('GET', `/api/users/${voleur.userId}/numbers`, { jeton: voleur.jeton })
      verifier(sessionVoleur.statut === 401, 'La session du voleur devait être fermée')

      etat.moussa = await connecter(appel, 'moussa')
      const liste = attendre(await appel('GET', `/api/users/${etat.moussa.userId}/numbers`, { jeton: etat.moussa.jeton }), 200, 'Numéros de Moussa')
      const numero = liste.numeros.find((n) => n.number_id === ID.numeroMoussaBE)
      resultats.fraude = { statutTentative: tentative.statut, statutNumero: numero.status }
      return [
        'Conversion de 1 500 000 FCFA (37 fois sa moyenne) depuis un appareil inconnu → BLOQUÉE',
        `Numéro belge ${numero.did_number} suspendu, sessions fermées : le voleur est déconnecté`,
        'Moussa se reconnecte depuis son propre téléphone avec son PIN'
      ]
    }
  },
  {
    id: 'support',
    titre: 'Le support Orange vérifie l\'identité de Moussa et rétablit sa ligne',
    contexte: 'Le compte administrateur consulte l\'alerte puis lève la suspension.',
    executer: async ({ appel, etat, resultats }) => {
      etat.support = await connecter(appel, 'support')
      const alertes = attendre(await appel('GET', `/api/security/fraud-alerts?userId=${etat.moussa.userId}`, { jeton: etat.support.jeton }), 200, 'Alertes de fraude')
      const alerte = alertes.alertes[0]
      verifier(alerte, 'Une alerte de fraude était attendue')
      const reponse = attendre(await appel('PUT', `/api/security/numbers/${ID.numeroMoussaBE}/reactivate`, { jeton: etat.support.jeton }), 200, 'Levée de la suspension')
      resultats.support = reponse.numero.status
      return [
        `Alerte « ${alerte.alert_type} » (score ${alerte.anomaly_score}/100) → ${alerte.action_taken}`,
        `Suspension levée : numéro ${reponse.numero.status === 'ACTIVE' ? 'de nouveau actif (Moussa est toujours en Belgique)' : reponse.numero.status}`
      ]
    }
  },
  {
    id: 'stocks',
    titre: 'Exploitation : le stock de numéros français s\'épuise',
    contexte: 'Algo 19 : réapprovisionnement juste-à-temps auprès du partenaire.',
    executer: async ({ appel, etat, resultats }) => {
      const { jeton } = etat.support
      const pools = attendre(await appel('GET', '/api/stock/pools', { jeton }), 200, 'État des stocks')
      const poolFR = pools.pools.find((pool) => pool.country_iso === 'FR')
      const analyse = attendre(await appel('POST', '/api/stock/jit/run', { jeton }), 200, 'Analyse JIT')
      const commande = analyse.rapport.find((ligne) => ligne.pays === 'FR')
      verifier(commande && commande.action === 'COMMANDE_PASSEE', `Commande attendue pour la France, obtenu ${commande && commande.action}`)
      const livraison = attendre(await appel('PUT', `/api/stock/reorder/${poolFR.pool_id}`, {
        jeton,
        corps: { quantite: commande.quantite }
      }), 200, 'Confirmation de livraison')
      resultats.stock = { avant: poolFR.tauxOccupationValeur, apres: livraison.pool.tauxOccupationValeur }
      return [
        `Pool France : ${pourcentage(poolFR.tauxOccupationValeur)} occupé, ${nombre(poolFR.numerosDisponibles)} numéros libres`,
        `Commande automatique de ${commande.quantite.toLocaleString('fr-FR')} numéros auprès de ${commande.partenaire}`,
        `Livraison confirmée : occupation ramenée à ${pourcentage(livraison.pool.tauxOccupationValeur)}`
      ]
    }
  },
  {
    id: 'maintenance',
    titre: 'Tâches automatiques (chaque heure en production)',
    contexte: 'Clôture des voyages échus, expiration des forfaits eSIM, purge des sessions périmées.',
    executer: async ({ appel }) => {
      const { rapport } = attendre(await appel('POST', '/api/demo/maintenance'), 200, 'Maintenance')
      const voyages = rapport.voyages || {}
      return [
        `Voyages clôturés : ${voyages.voyagesTermines || 0} · annulés : ${voyages.voyagesAnnules || 0} · ` +
        `forfaits eSIM expirés : ${rapport.esimExpirees || 0} · sessions purgées : ${rapport.sessionsPurgees || 0}`
      ]
    }
  }
]

const ETAPES_SCENARIO = Object.freeze(ETAPES.map(({ id, titre, contexte }) => Object.freeze({ id, titre, contexte })))

// appel(methode, chemin, { corps, jeton, entetes }) → { statut, json, entetes }
// options.sauter : identifiants d'étapes à ignorer (ex. ['reinitialisation']).
const executerScenario = async (appel, { avantEtape = async () => {}, apresEtape = () => {}, sauter = [] } = {}) => {
  const contexte = { appel, etat: {}, resultats: {} }
  const rapport = []
  const etapes = ETAPES.filter((etape) => !sauter.includes(etape.id))
  for (const [index, etape] of etapes.entries()) {
    await avantEtape({ etape, index, total: etapes.length })
    try {
      const lignes = await etape.executer(contexte)
      rapport.push({ id: etape.id, ok: true, lignes })
      apresEtape({ etape, index, total: etapes.length, ok: true, lignes })
    } catch (erreur) {
      rapport.push({ id: etape.id, ok: false, erreur: erreur.message })
      apresEtape({ etape, index, total: etapes.length, ok: false, erreur })
      return { reussi: false, rapport, resultats: contexte.resultats }
    }
  }
  const etat = attendre(await appel('GET', '/api/demo/etat'), 200, 'État final')
  return { reussi: true, rapport, resultats: contexte.resultats, etat }
}

module.exports = { ETAPES_SCENARIO, executerScenario, formaterNumero }
