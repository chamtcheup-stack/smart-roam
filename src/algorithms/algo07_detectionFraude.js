'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 07 — Détection de fraude (règles déterministes + score statistique)
//
// Règles (la première déclenchée l'emporte) :
//   MONTANT      montant > 5 × moyenne habituelle          → score 85
//   FREQUENCE    > 20 transactions confirmées dans l'heure   → score 90
//   LOCALISATION pays de la transaction inhabituel           → score 60
//   DEVICE       appareil inconnu depuis 90 jours            → score 70
// Sinon, score statistique (écarts au profil) : 40 × écart montant
// + 30 × écart fréquence journalière, borné à 100.
//
// Décision : ≥ 80 suspension du numéro, ≥ 50 alerte silencieuse.
// Garde-fous (objectif 0,1 % de faux positifs) :
//   - profil vierge (démarrage à froid) : les règles comparatives
//     ne s'appliquent pas tant qu'aucun historique n'existe ;
//   - le score statistique seul ne déclenche au plus qu'une alerte.
// Les transactions normales mettent à jour le profil (apprentissage).
// ════════════════════════════════════════════════════════════

const supabase = require('../supabase')
const logger = require('../utils/logger')
const {
  donnees,
  executerSansEchec,
  estTableAbsente,
  estColonneAbsente,
  insererAvecColonnesOptionnelles,
  ErreurBase
} = require('../utils/db')

const SEUIL_ALERTE_SILENCIEUSE = 50
const SEUIL_SUSPENSION = 80
const MULTIPLICATEUR_MONTANT = 5.0
const MAX_TRANSACTIONS_HEURE = 20
const PERIODE_ANALYSE_JOURS = 90
const TAUX_FAUX_POSITIF_CIBLE = 0.001
const MINUTES_PAR_JOUR = 24 * 60
const JOURS_MOYENNE_QUOTIDIENNE = 30
const LISSAGE_MOYENNE = 0.1 // moyenne mobile exponentielle des montants
const MAX_PAYS_HABITUELS = 20

const ACTION_ALERTE = 'ALERT_ONLY'
const ACTION_SUSPENSION = 'SUSPEND_NUMBER'
const ACTION_BLOCAGE = 'BLOCK_ACCOUNT'

const REGLES_DETERMINISTES = ['MONTANT', 'FREQUENCE', 'LOCALISATION', 'DEVICE']

// ── Lectures ────────────────────────────────────────────────
const recupererProfilNormal = async (userId) => donnees(
  await supabase.from('fraud_profile').select('*').eq('user_id', userId).maybeSingle(),
  'lecture du profil de fraude'
)

const compterTransactionsRecentes = async (userId, nbMinutes, maintenant = new Date()) => {
  const dateLimite = new Date(maintenant.getTime() - nbMinutes * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from('currency_transaction')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'CONFIRMED')
    .gte('created_at', dateLimite)
  if (error) throw new ErreurBase('comptage des transactions récentes', error)
  return count || 0
}

// true = connu, false = inconnu, null = non vérifiable (pas d'identifiant ou table absente).
const verifierDeviceConnu = async (userId, deviceId, maintenant = new Date()) => {
  if (!deviceId) return null
  const dateLimite = new Date(maintenant.getTime() - PERIODE_ANALYSE_JOURS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('device')
    .select('*')
    .eq('user_id', userId)
    .eq('device_id', deviceId)
    .gte('last_seen_at', dateLimite)
    .limit(1)
  if (error) {
    if (estTableAbsente(error) || estColonneAbsente(error)) return null
    throw new ErreurBase('vérification de l\'appareil', error)
  }
  return Array.isArray(data) && data.length > 0
}

// Enregistre l'appareil à la connexion et indique s'il était déjà connu
// (vu depuis moins de 90 jours) : true / false, ou null si non vérifiable.
// Ne bloque jamais la connexion (table absente, erreur de base…).
let tableAppareilsDisponible = true
const enregistrerAppareil = async (userId, deviceId, maintenant = new Date()) => {
  if (!deviceId || !tableAppareilsDisponible) return null
  try {
    const { data, error } = await supabase
      .from('device')
      .select('last_seen_at')
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .limit(1)
    if (error) {
      if (estTableAbsente(error) || estColonneAbsente(error)) {
        tableAppareilsDisponible = false
        logger.warn('Table « device » absente ou incomplète : la règle anti-fraude DEVICE est désactivée')
        return null
      }
      throw new ErreurBase('lecture de l\'appareil', error)
    }

    const existant = Array.isArray(data) ? data[0] : null
    const limite = maintenant.getTime() - PERIODE_ANALYSE_JOURS * 24 * 60 * 60 * 1000
    const connu = Boolean(existant && Date.parse(existant.last_seen_at) >= limite)
    const vuLe = maintenant.toISOString()
    await executerSansEchec(
      existant
        ? supabase.from('device').update({ last_seen_at: vuLe }).eq('user_id', userId).eq('device_id', deviceId)
        : supabase.from('device').insert([{ user_id: userId, device_id: deviceId, last_seen_at: vuLe }]),
      'enregistrement de l\'appareil'
    )
    return connu
  } catch (erreur) {
    logger.warn('Enregistrement de l\'appareil impossible (connexion poursuivie)', erreur)
    return null
  }
}

// typical_countries : tableau de codes ('FR') ou d'objets ({ iso: 'FR' }).
const paysHabituels = (profil) => (Array.isArray(profil && profil.typical_countries) ? profil.typical_countries : [])
  .map((pays) => (typeof pays === 'string' ? pays : pays && (pays.iso || pays.pays || pays.country_iso)))
  .filter(Boolean)
  .map((pays) => String(pays).toUpperCase())

// true / false, ou null si non vérifiable (pays inconnu ou profil sans historique).
const verifierPaysHabituel = (profil, paysActuel) => {
  const connus = paysHabituels(profil)
  if (!paysActuel || connus.length === 0) return null
  return connus.includes(String(paysActuel).toUpperCase())
}

// ── Règles et score ─────────────────────────────────────────
const NON_DECLENCHEE = Object.freeze({ declenche: false, typeAnomalie: null, score: 0 })

const evaluerRegleDeterministe = (regle, transaction, profil, contexte) => {
  const moyenne = Number(profil.avg_transaction_amount) || 0
  switch (regle) {
    case 'MONTANT':
      return moyenne > 0 && transaction.montant > moyenne * MULTIPLICATEUR_MONTANT
        ? { declenche: true, typeAnomalie: 'AMOUNT', score: 85 }
        : NON_DECLENCHEE
    case 'FREQUENCE':
      return contexte.nbTransactionsHeure > MAX_TRANSACTIONS_HEURE
        ? { declenche: true, typeAnomalie: 'FREQUENCY', score: 90 }
        : NON_DECLENCHEE
    case 'LOCALISATION':
      return verifierPaysHabituel(profil, transaction.pays) === false
        ? { declenche: true, typeAnomalie: 'LOCATION', score: 60 }
        : NON_DECLENCHEE
    case 'DEVICE':
      return contexte.deviceConnu === false
        ? { declenche: true, typeAnomalie: 'DEVICE', score: 70 }
        : NON_DECLENCHEE
    default:
      return NON_DECLENCHEE
  }
}

const calculerScoreML = (transaction, profil, nbTransactions24h) => {
  const moyenneMontant = Number(profil.avg_transaction_amount) || 0
  const moyenneQuotidienne = Number(profil.avg_daily_transactions) || 0
  const ecartMontant = moyenneMontant > 0 ? Math.abs(transaction.montant - moyenneMontant) / moyenneMontant : 0
  const ecartFrequence = moyenneQuotidienne > 0 ? Math.abs(nbTransactions24h - moyenneQuotidienne) / moyenneQuotidienne : 0
  return Math.min(100, Math.round(ecartMontant * 40 + ecartFrequence * 30))
}

const determinerAction = (scoreAnomalie) => {
  if (scoreAnomalie >= SEUIL_SUSPENSION) return ACTION_SUSPENSION
  if (scoreAnomalie >= SEUIL_ALERTE_SILENCIEUSE) return ACTION_ALERTE
  return null
}

// ── Procédures ──────────────────────────────────────────────
const creerAlerteAnomalie = async (userId, profil, scoreAnomalie, typeAnomalie, transaction, action) => {
  const { error } = await insererAvecColonnesOptionnelles(supabase, 'fraud_alert', {
    user_id: userId,
    profile_id: profil.profile_id,
    alert_type: typeAnomalie,
    anomaly_score: scoreAnomalie,
    triggered_by: {
      transaction_id: transaction.transaction_id || null,
      montant: transaction.montant,
      devise: transaction.devise || null,
      pays: transaction.pays || null
    },
    action_taken: action
  }, ['profile_id', 'triggered_by'])
  if (error) logger.warn('Enregistrement de l\'alerte de fraude impossible', { code: error.code })
  logger.warn('Alerte de fraude', { userId, scoreAnomalie, typeAnomalie, action })
}

const suspendreNumeroVirtuel = async (userId) => {
  donnees(
    await supabase
      .from('virtual_number')
      .update({ status: 'SUSPENDED', suspended_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('status', 'ACTIVE'),
    'suspension du numéro virtuel'
  )
  logger.warn('Numéros virtuels suspendus (activité frauduleuse suspectée)', { userId })
}

// Pas de canal de notification branché : trace pour le support.
const notifierUtilisateur = (userId, typeAnomalie) => {
  logger.info('Notification sécurité à envoyer à l\'utilisateur', { userId, typeAnomalie })
}

const mettreAJourProfilML = (userId, profil, scoreAnomalie) => executerSansEchec(
  supabase.from('fraud_profile').update({
    anomaly_score: scoreAnomalie,
    last_alert_at: new Date().toISOString(),
    total_alerts: (Number(profil.total_alerts) || 0) + 1
  }).eq('user_id', userId),
  'mise à jour du profil de fraude'
)

const journaliserTransactionNormale = (userId, scoreAnomalie) => executerSansEchec(
  supabase.from('fraud_profile').update({ anomaly_score: scoreAnomalie }).eq('user_id', userId),
  'score du profil de fraude'
)

// Apprentissage après une transaction confirmée et jugée normale.
const apprendreTransaction = async (userId, transaction, { maintenant = new Date() } = {}) => {
  const profil = await recupererProfilNormal(userId)
  if (!profil) return false

  const moyenne = Number(profil.avg_transaction_amount) || 0
  const nouvelleMoyenne = moyenne > 0
    ? (1 - LISSAGE_MOYENNE) * moyenne + LISSAGE_MOYENNE * transaction.montant
    : transaction.montant

  const nb30Jours = await compterTransactionsRecentes(userId, JOURS_MOYENNE_QUOTIDIENNE * MINUTES_PAR_JOUR, maintenant)
  const pays = paysHabituels(profil)
  if (transaction.pays && !pays.includes(String(transaction.pays).toUpperCase())) pays.push(String(transaction.pays).toUpperCase())

  return executerSansEchec(
    supabase.from('fraud_profile').update({
      avg_transaction_amount: Number(nouvelleMoyenne.toFixed(2)),
      avg_daily_transactions: Number((nb30Jours / JOURS_MOYENNE_QUOTIDIENNE).toFixed(3)),
      typical_countries: pays.slice(-MAX_PAYS_HABITUELS)
    }).eq('user_id', userId),
    'apprentissage du profil de fraude'
  )
}

// ── Traitement principal ────────────────────────────────────
// transaction : { montant, devise?, pays?, device_id?, appareil_connu?, transaction_id? }
// appareil_connu (issu du jeton de session) évite une requête sur la table device.
const detectionFraudeIA = async (userId, transaction, { maintenant = new Date() } = {}) => {
  const profil = await recupererProfilNormal(userId)
  if (!profil) {
    logger.info('Profil de fraude inexistant : transaction autorisée par défaut', { userId })
    return { statut: 'NORMAL', scoreAnomalie: 0, raison: 'PROFIL_ABSENT' }
  }

  const [nbTransactionsHeure, nbTransactions24h, deviceConnu] = await Promise.all([
    compterTransactionsRecentes(userId, 60, maintenant),
    compterTransactionsRecentes(userId, MINUTES_PAR_JOUR, maintenant),
    typeof transaction.appareil_connu === 'boolean'
      ? transaction.appareil_connu
      : verifierDeviceConnu(userId, transaction.device_id, maintenant)
  ])
  const contexte = { nbTransactionsHeure, deviceConnu }

  let regleDeclenchee = null
  for (const regle of REGLES_DETERMINISTES) {
    const resultat = evaluerRegleDeterministe(regle, transaction, profil, contexte)
    if (resultat.declenche) {
      regleDeclenchee = resultat
      break
    }
  }

  const scoreAnomalie = regleDeclenchee ? regleDeclenchee.score : calculerScoreML(transaction, profil, nbTransactions24h)
  const typeAnomalie = regleDeclenchee ? regleDeclenchee.typeAnomalie : 'ML_DETECTION'
  let action = determinerAction(scoreAnomalie)
  if (!regleDeclenchee && action === ACTION_SUSPENSION) action = ACTION_ALERTE

  if (!action) {
    await journaliserTransactionNormale(userId, scoreAnomalie)
    return { statut: 'NORMAL', scoreAnomalie }
  }

  await creerAlerteAnomalie(userId, profil, scoreAnomalie, typeAnomalie, transaction, action)
  await mettreAJourProfilML(userId, profil, scoreAnomalie)

  if (action === ACTION_ALERTE) return { statut: 'ALERTE', scoreAnomalie, typeAnomalie }

  await suspendreNumeroVirtuel(userId)
  notifierUtilisateur(userId, typeAnomalie)
  return { statut: 'SUSPENDU', scoreAnomalie, typeAnomalie }
}

module.exports = {
  ACTION_ALERTE,
  ACTION_SUSPENSION,
  ACTION_BLOCAGE,
  TAUX_FAUX_POSITIF_CIBLE,
  paysHabituels,
  verifierPaysHabituel,
  evaluerRegleDeterministe,
  calculerScoreML,
  determinerAction,
  enregistrerAppareil,
  apprendreTransaction,
  detectionFraudeIA
}
