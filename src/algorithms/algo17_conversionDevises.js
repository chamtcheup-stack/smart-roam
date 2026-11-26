'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 17 — Conversion de devises (Orange Money)
//
// Taux (par ordre de priorité) :
//   1. Parité fixe officielle : 1 EUR = 655,957 XAF (BEAC) = 655,957 XOF (BCEAO)
//   2. Taux de référence quotidiens de la BCE (paires croisées via l'EUR)
// Contrôles : corridor actif, circuit breaker (réarmé après 60 min),
// fluctuation > 3 % vs dernier taux → disjonction, montant entre
// 500 et 10 000 000 XAF (plafond AML). Commission 1,5 % du montant brut,
// arrondis selon les décimales de la devise cible (XAF : 0).
// ════════════════════════════════════════════════════════════

const supabase = require('../supabase')
const config = require('../config')
const logger = require('../utils/logger')
const { requeteInvalide, indisponible } = require('../utils/http')
const { donnees, executerSansEchec, insererAvecColonnesOptionnelles, ErreurBase } = require('../utils/db')

const TAUX_COMMISSION = 0.015
const TTL_CACHE_TAUX_MS = 60 * 1000
const TTL_CACHE_BCE_MS = 60 * 60 * 1000
const DELAI_APPEL_BCE_MS = 3000
const SEUIL_FLUCTUATION = 0.03
const MONTANT_MIN_XAF = 500
const MONTANT_MAX_XAF = 10000000
const DUREE_DISJONCTION_MS = 60 * 60 * 1000
const URL_TAUX_BCE = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

const PARITES_FIXES_EUR = Object.freeze({ EUR: 1, XAF: 655.957, XOF: 655.957 })
const DECIMALES = Object.freeze({ XAF: 0, XOF: 0, JPY: 0, KRW: 0, GNF: 0 }) // autres : 2

const SOURCE_PARITE_FIXE = 'PARITE_FIXE'
const SOURCE_BCE = 'BCE'

// ── Arrondis ────────────────────────────────────────────────
const decimalesDevise = (devise) => (devise in DECIMALES ? DECIMALES[devise] : 2)

// Arrondi au demi supérieur sans erreur binaire (1.005 → 1.01).
const arrondir = (valeur, decimales) => Number(`${Math.round(Number(`${valeur}e${decimales}`))}e-${decimales}`)

// ── Taux BCE (cache 1 h, désactivable) ──────────────────────
let cacheBCE = { taux: null, date: null, expiration: 0 }

const analyserXMLBCE = (xml) => {
  const taux = {}
  for (const [, devise, valeur] of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    taux[devise] = Number(valeur)
  }
  const date = (xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/) || [])[1] || null
  return Object.keys(taux).length > 0 ? { taux, date } : null
}

// options.recuperer : fonction fetch injectable ; options.forcer : ignore la désactivation (tests).
const chargerTauxBCE = async ({ recuperer = fetch, forcer = false } = {}) => {
  if (!config.tauxBCEActif && !forcer) return null
  if (cacheBCE.taux && cacheBCE.expiration > Date.now()) return cacheBCE
  try {
    const reponse = await recuperer(URL_TAUX_BCE, { signal: AbortSignal.timeout(DELAI_APPEL_BCE_MS) })
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`)
    const analyse = analyserXMLBCE(await reponse.text())
    if (!analyse) throw new Error('réponse BCE illisible')
    cacheBCE = { ...analyse, expiration: Date.now() + TTL_CACHE_BCE_MS }
    return cacheBCE
  } catch (erreur) {
    logger.warn('Taux BCE indisponibles', { message: erreur.message })
    return cacheBCE.taux ? cacheBCE : null // dernier document connu si disponible
  }
}

// Unités de « devise » pour 1 EUR, ou null si inconnue.
const unitesParEuro = async (devise, options) => {
  if (devise in PARITES_FIXES_EUR) return { valeur: PARITES_FIXES_EUR[devise], source: SOURCE_PARITE_FIXE }
  const bce = await chargerTauxBCE(options)
  if (bce && bce.taux[devise]) return { valeur: bce.taux[devise], source: SOURCE_BCE }
  return null
}

// ── Taux d'une paire (cache 60 s) ───────────────────────────
const cacheTaux = new Map()

const recupererTauxChange = async (deviseSource, deviseCible, options = {}) => {
  const cle = `${deviseSource}_${deviseCible}`
  const enCache = cacheTaux.get(cle)
  if (enCache && enCache.expiration > Date.now()) return enCache.resultat

  const [source, cible] = await Promise.all([unitesParEuro(deviseSource, options), unitesParEuro(deviseCible, options)])
  if (!source || !cible) return null

  const resultat = {
    taux: cible.valeur / source.valeur,
    source: source.source === SOURCE_PARITE_FIXE && cible.source === SOURCE_PARITE_FIXE ? SOURCE_PARITE_FIXE : SOURCE_BCE
  }
  cacheTaux.set(cle, { resultat, expiration: Date.now() + TTL_CACHE_TAUX_MS })
  return resultat
}

const viderCachesTaux = () => {
  cacheTaux.clear()
  cacheBCE = { taux: null, date: null, expiration: 0 }
}

// ── Calculs purs ────────────────────────────────────────────
const calculerConversion = ({ montant, tauxChange, deviseCible }) => {
  const decimales = decimalesDevise(deviseCible)
  const montantBrut = arrondir(montant * tauxChange, decimales)
  const commission = arrondir(montantBrut * TAUX_COMMISSION, decimales)
  const montantNet = arrondir(montantBrut - commission, decimales)
  return { montantBrut, commission, montantNet }
}

const verifierMontant = (montantEnXAF) => {
  if (montantEnXAF < MONTANT_MIN_XAF) {
    throw requeteInvalide('Montant trop faible', { minimum: `${MONTANT_MIN_XAF} XAF`, montantEquivalentXAF: Math.round(montantEnXAF) })
  }
  if (montantEnXAF > MONTANT_MAX_XAF) {
    throw requeteInvalide('Montant trop élevé (plafond anti-blanchiment)', { maximum: `${MONTANT_MAX_XAF} XAF`, montantEquivalentXAF: Math.round(montantEnXAF) })
  }
}

const detecterFluctuation = (dernierTaux, tauxActuel) => {
  const precedent = Number(dernierTaux)
  if (!Number.isFinite(precedent) || precedent <= 0) return false
  return Math.abs(tauxActuel - precedent) / precedent > SEUIL_FLUCTUATION
}

// Disjoncté si TRIPPED depuis moins de 60 min ; au-delà, demi-ouvert (essai autorisé).
const etatCircuitBreaker = (corridor, maintenant = Date.now()) => {
  if (corridor.circuit_breaker_status !== 'TRIPPED') return 'FERME'
  const disjoncteLe = Date.parse(corridor.circuit_breaker_tripped_at || '')
  if (Number.isFinite(disjoncteLe) && maintenant - disjoncteLe >= DUREE_DISJONCTION_MS) return 'DEMI_OUVERT'
  return 'DISJONCTE'
}

// ── Accès base ──────────────────────────────────────────────
const verifierCorridor = async (deviseSource, deviseCible) => {
  const corridors = donnees(
    await supabase
      .from('currency_exchange_corridor')
      .select('*')
      .eq('source_currency', deviseSource)
      .eq('target_currency', deviseCible)
      .eq('is_active', true)
      .limit(1),
    'lecture du corridor de change'
  )
  return (corridors && corridors[0]) || null
}

const declencherCircuitBreaker = (corridorId, deviseSource, deviseCible) => {
  logger.error('ALERTE CIRCUIT BREAKER : fluctuation > 3 %, corridor suspendu', { deviseSource, deviseCible })
  return executerSansEchec(
    supabase.from('currency_exchange_corridor').update({
      circuit_breaker_status: 'TRIPPED',
      circuit_breaker_tripped_at: new Date().toISOString()
    }).eq('corridor_id', corridorId),
    'déclenchement du circuit breaker'
  )
}

const mettreAJourCorridor = (corridor, tauxActuel, rearmer) => executerSansEchec(
  supabase.from('currency_exchange_corridor').update({
    last_rate_checked: tauxActuel,
    ...(rearmer ? { circuit_breaker_status: 'OPEN', circuit_breaker_tripped_at: null } : {})
  }).eq('corridor_id', corridor.corridor_id),
  'mise à jour du dernier taux'
)

// ── Traitement principal : devis ────────────────────────────
// Valide la conversion et retourne le devis (aucune écriture de transaction).
const preparerConversion = async ({ deviseSource, deviseCible, montant }, options = {}) => {
  if (deviseSource === deviseCible) throw requeteInvalide('Les devises source et cible doivent être différentes')

  const corridor = await verifierCorridor(deviseSource, deviseCible)
  if (!corridor) throw requeteInvalide(`Conversion ${deviseSource} vers ${deviseCible} non disponible`)

  const etat = etatCircuitBreaker(corridor)
  if (etat === 'DISJONCTE') {
    throw indisponible('Service temporairement suspendu : taux de change instable, réessayez plus tard')
  }

  const tauxResultat = await recupererTauxChange(deviseSource, deviseCible, options)
  if (!tauxResultat) throw indisponible('Impossible de récupérer le taux de change, réessayez dans quelques minutes')

  if (detecterFluctuation(corridor.last_rate_checked, tauxResultat.taux)) {
    await declencherCircuitBreaker(corridor.corridor_id, deviseSource, deviseCible)
    throw indisponible('Conversion annulée pour votre protection : variation de taux anormale')
  }

  const versXAF = deviseSource === 'XAF' ? { taux: 1 } : await recupererTauxChange(deviseSource, 'XAF', options)
  if (!versXAF) throw indisponible('Contrôle du plafond impossible : taux de référence XAF indisponible')
  const montantEquivalentXAF = Math.round(montant * versXAF.taux)
  verifierMontant(montantEquivalentXAF)

  await mettreAJourCorridor(corridor, tauxResultat.taux, etat === 'DEMI_OUVERT')

  return {
    corridorId: corridor.corridor_id,
    deviseSource,
    deviseCible,
    montantSource: montant,
    tauxChange: Number(tauxResultat.taux.toPrecision(8)),
    sourceTaux: tauxResultat.source,
    tauxCommission: TAUX_COMMISSION,
    montantEquivalentXAF,
    ...calculerConversion({ montant, tauxChange: tauxResultat.taux, deviseCible })
  }
}

// ── Traitement principal : exécution ────────────────────────
const executerTransaction = async (userId, devis) => {
  const { data, error } = await insererAvecColonnesOptionnelles(supabase, 'currency_transaction', {
    user_id: userId,
    source_currency: devis.deviseSource,
    target_currency: devis.deviseCible,
    source_amount: devis.montantSource,
    gross_amount: devis.montantBrut,
    commission_amount: devis.commission,
    net_amount: devis.montantNet,
    exchange_rate: devis.tauxChange,
    rate_source: devis.sourceTaux,
    rate_timestamp: new Date().toISOString(),
    status: 'CONFIRMED'
  }, ['rate_timestamp'])
  if (error) throw new ErreurBase('enregistrement de la transaction', error)
  logger.info('Transaction de change confirmée', { userId, transactionId: data.transaction_id })
  return data
}

module.exports = {
  TAUX_COMMISSION,
  MONTANT_MIN_XAF,
  MONTANT_MAX_XAF,
  PARITES_FIXES_EUR,
  arrondir,
  decimalesDevise,
  analyserXMLBCE,
  recupererTauxChange,
  viderCachesTaux,
  calculerConversion,
  verifierMontant,
  detecterFluctuation,
  etatCircuitBreaker,
  preparerConversion,
  executerTransaction
}
