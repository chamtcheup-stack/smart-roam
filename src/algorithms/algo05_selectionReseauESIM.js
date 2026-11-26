'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 05 — Sélection du réseau et provisioning eSIM
//
//   1. BYOE : le voyageur a déclaré sa propre eSIM → rien à provisionner
//   2. Roaming UE gratuit (origine et destination en zone EU_FREE)
//   3. Partenaires MVNO actifs du pays, classés par score :
//        couverture 60 % · latence 30 % · coût 10 %
//   4. Provisioning OTA avec bascule (failover) : 3 tentatives maximum,
//      un partenaire différent à chaque tentative
//   5. Enregistrement du profil eSIM (ICCID conforme E.118 + clé de Luhn)
// ════════════════════════════════════════════════════════════

const crypto = require('crypto')
const supabase = require('../supabase')
const config = require('../config')
const logger = require('../utils/logger')
const {
  donnees,
  estColonneAbsente,
  estTableAbsente,
  estViolationUnicite,
  insererAvecColonnesOptionnelles,
  ErreurBase
} = require('../utils/db')

const MAX_TENTATIVES = 3
const POIDS_COUVERTURE = 0.60
const POIDS_LATENCE = 0.30
const POIDS_COUT = 0.10
const DELAI_PROVISIONING_SECONDES = 60
const PLAN_DEFAUT = 'WEEK'
const QUOTA_DATA_MO = { DAY: 200, WEEK: 1024, MONTH: 5120 }
const DUREE_FORFAIT_JOURS = Object.freeze({ DAY: 1, WEEK: 7, MONTH: 30 }) // BYOE : sans échéance
const LONGUEUR_ICCID_SANS_CLE = 18
const MAX_ESSAIS_ICCID = 3

// Indicatifs téléphoniques (E.164) utilisés comme code pays de l'ICCID.
const INDICATIFS = Object.freeze({
  CM: '237', FR: '33', BE: '32', ES: '34', LU: '352', PL: '48', RO: '40', SK: '421', MD: '373',
  IT: '39', DE: '49', CH: '41', PT: '351', NL: '31', GB: '44', TR: '90', GR: '30',
  CI: '225', SN: '221', ML: '223', BF: '226', GN: '224', CD: '243', MG: '261', EG: '20',
  DZ: '213', MA: '212', TN: '216', GA: '241', CG: '242', TD: '235', CF: '236', NE: '227',
  TG: '228', BJ: '229', LR: '231', SL: '232', GW: '245', BW: '267', MU: '230', GQ: '240',
  NG: '234', GH: '233', KE: '254', ZA: '27', JO: '962', SA: '966', AE: '971', IL: '972',
  CN: '86', JP: '81', KR: '82', IN: '91', US: '1', CA: '1', MX: '52', BR: '55'
})
const INDICATIF_PAR_DEFAUT = '33' // pays de l'émetteur (Orange France)

// ── ICCID ───────────────────────────────────────────────────
const calculerCleLuhn = (chiffres) => {
  let somme = 0
  let doubler = true
  for (let i = chiffres.length - 1; i >= 0; i--) {
    let n = Number(chiffres[i])
    if (doubler) {
      n *= 2
      if (n > 9) n -= 9
    }
    somme += n
    doubler = !doubler
  }
  return String((10 - (somme % 10)) % 10)
}

const verifierLuhn = (numero) => /^\d+$/.test(numero) && calculerCleLuhn(numero.slice(0, -1)) === numero.slice(-1)

const chiffresAleatoires = (longueur) => Array.from({ length: longueur }, () => crypto.randomInt(0, 10)).join('')

// 89 (télécom) + indicatif pays + émetteur (2) + aléa cryptographique + clé de Luhn = 19 chiffres.
const genererICCID = (paysISO, emetteur = config.iccidEmetteur) => {
  const prefixe = `89${INDICATIFS[paysISO] || INDICATIF_PAR_DEFAUT}${emetteur}`
  const corps = prefixe + chiffresAleatoires(LONGUEUR_ICCID_SANS_CLE - prefixe.length)
  return corps + calculerCleLuhn(corps)
}

// Échéance du forfait : activation (ou création) + durée du plan ; null si sans échéance.
const calculerExpirationForfait = (esim) => {
  const jours = DUREE_FORFAIT_JOURS[esim && esim.plan_type]
  const debut = Date.parse((esim && (esim.activated_at || esim.created_at)) || '')
  if (!jours || !Number.isFinite(debut)) return null
  return new Date(debut + jours * 24 * 60 * 60 * 1000).toISOString()
}

// ── Lectures ────────────────────────────────────────────────
const verifierBYOE = async (userId, numberId) => {
  const { data, error } = await supabase
    .from('trip_declaration')
    .select('declaration_id')
    .eq('user_id', userId)
    .eq('number_id', numberId)
    .eq('has_own_esim', true)
    .in('status', ['PENDING', 'CONFIRMED'])
    .limit(1)
  if (error) {
    if (estColonneAbsente(error)) return false // option BYOE non gérée par le schéma
    throw new ErreurBase('vérification BYOE', error)
  }
  return Array.isArray(data) && data.length > 0
}

const recupererPaysOrigine = async (userId) => {
  const utilisateur = donnees(
    await supabase.from('users').select('country_of_residence').eq('user_id', userId).maybeSingle(),
    'lecture du pays d\'origine'
  )
  return utilisateur ? utilisateur.country_of_residence : null
}

const verifierZoneRoamingGratuit = async (paysOrigine, paysDestination) => {
  if (!paysOrigine || !paysDestination) return false
  const { data, error } = await supabase
    .from('country')
    .select('country_iso, roaming_zone')
    .in('country_iso', [paysOrigine, paysDestination])
  if (error) {
    if (estColonneAbsente(error)) return false
    throw new ErreurBase('lecture des zones de roaming', error)
  }
  const zone = (iso) => ((data || []).find((pays) => pays.country_iso === iso) || {}).roaming_zone
  return zone(paysOrigine) === 'EU_FREE' && zone(paysDestination) === 'EU_FREE'
}

const recupererPartenairesActifs = async (paysISO) => {
  const { data, error } = await supabase
    .from('mvno_partner')
    .select('*')
    .eq('country_iso', paysISO)
    .eq('agreement_status', 'ACTIVE')
    .order('failover_priority', { ascending: true })
  if (error) {
    if (estTableAbsente(error)) return []
    throw new ErreurBase('lecture des partenaires MVNO', error)
  }
  return data || []
}

// ── Scoring des partenaires (à partir de leur ligne, sans requête N+1) ──
const borner = (valeur) => Math.max(0, Math.min(1, valeur))

const calculerScoreCouverture = (partenaire) => {
  const brut = Number(partenaire.coverage_score)
  if (!Number.isFinite(brut)) return 0.5
  return borner(brut > 1 ? brut / 100 : brut) // accepte 0–1 ou 0–100
}

const calculerScoreLatence = (partenaire) => {
  const latenceMs = Number(partenaire.latency_ms)
  if (!Number.isFinite(latenceMs)) return 0.5 // pas de mesure disponible : neutre
  return latenceMs >= 1000 ? 0 : (1000 - latenceMs) / 1000
}

const calculerScoreCout = (partenaire) => {
  const coutXAF = Number(partenaire.cost_per_day_xaf)
  if (!Number.isFinite(coutXAF)) return 0.5
  return coutXAF >= 5000 ? 0 : (5000 - coutXAF) / 5000
}

const calculerScorePartenaire = (scoreCouverture, scoreLatence, scoreCout) =>
  scoreCouverture * POIDS_COUVERTURE + scoreLatence * POIDS_LATENCE + scoreCout * POIDS_COUT

const classerPartenaires = (partenaires) => partenaires
  .map((partenaire) => ({
    partenaire,
    score: calculerScorePartenaire(calculerScoreCouverture(partenaire), calculerScoreLatence(partenaire), calculerScoreCout(partenaire))
  }))
  .sort((a, b) => b.score - a.score || (a.partenaire.failover_priority ?? 0) - (b.partenaire.failover_priority ?? 0))

// ── Provisioning OTA ────────────────────────────────────────
// Intégration SM-DP+ (GSMA SGP.22, interface ES2+) à brancher : en
// attendant, simulation explicite (aucun profil réel téléchargé).
let simulationSignalee = false
const appelerSMDPPlus = async ({ url }) => {
  if (!simulationSignalee) {
    simulationSignalee = true
    logger.warn('SM-DP+ simulé : aucun profil eSIM réel n\'est téléchargé (intégration ES2+ à brancher)', { url: url || null })
  }
  return { statut: 'SUCCESS', simulation: true }
}

const provisionnerOTA = async (partenaire, iccid, userId, fournisseur = appelerSMDPPlus) => {
  let minuterie
  const delai = new Promise((resolve) => {
    minuterie = setTimeout(() => resolve({ statut: 'TIMEOUT' }), DELAI_PROVISIONING_SECONDES * 1000)
  })
  try {
    const reponse = await Promise.race([
      fournisseur({ url: partenaire.esim_sm_dp_url, iccid, userId, partenaire }),
      delai
    ])
    return Boolean(reponse) && reponse.statut === 'SUCCESS'
  } catch (erreur) {
    logger.warn('Échec du provisioning OTA', { partenaire: partenaire.name, message: erreur.message })
    return false
  } finally {
    clearTimeout(minuterie)
  }
}

// ── Enregistrements ─────────────────────────────────────────
// L'ICCID provisionné est enregistré tel quel ; en cas de collision (aléa
// sur 10^11 valeurs), un nouvel ICCID est tiré.
const enregistrerESIM = async ({ userId, numberId, partenaire, paysISO, plan, iccid: iccidProvisionne }) => {
  for (let essai = 1; essai <= MAX_ESSAIS_ICCID; essai++) {
    const iccid = essai === 1 && iccidProvisionne ? iccidProvisionne : genererICCID(paysISO)
    const { data, error } = await insererAvecColonnesOptionnelles(supabase, 'esim_profile', {
      user_id: userId,
      number_id: numberId,
      iccid,
      provider_id: partenaire ? partenaire.partner_id : null,
      country_iso: paysISO,
      plan_type: plan,
      data_quota_mb: QUOTA_DATA_MO[plan] || QUOTA_DATA_MO[PLAN_DEFAUT],
      data_used_mb: 0,
      status: 'ACTIVE',
      activated_at: new Date().toISOString()
    }, ['provider_id', 'activated_at'])
    if (!error) return data
    if (!estViolationUnicite(error)) throw new ErreurBase('enregistrement de l\'eSIM', error)
    logger.warn('Collision d\'ICCID : nouvel essai', { essai })
  }
  throw new ErreurBase('enregistrement de l\'eSIM', { message: 'ICCID unique introuvable' })
}

const enregistrerBYOE = async (userId, numberId, paysISO) => {
  const { data, error } = await insererAvecColonnesOptionnelles(supabase, 'esim_profile', {
    user_id: userId,
    number_id: numberId,
    country_iso: paysISO,
    plan_type: 'BYOE',
    status: 'ACTIVE',
    activated_at: new Date().toISOString()
  }, ['activated_at'])
  if (error) throw new ErreurBase('enregistrement BYOE', error)
  return data
}

// ── Traitement principal ────────────────────────────────────
const selectionReseauEsim = async ({ userId, numberId, paysISO, plan = PLAN_DEFAUT }, { fournisseur } = {}) => {
  if (await verifierBYOE(userId, numberId)) {
    const esim = await enregistrerBYOE(userId, numberId, paysISO)
    logger.info('Mode BYOE : pas de provisioning', { userId, paysISO })
    return { statut: 'BYOE', iccid: null, esim }
  }

  const paysOrigine = await recupererPaysOrigine(userId)
  if (await verifierZoneRoamingGratuit(paysOrigine, paysISO)) {
    logger.info('Roaming UE gratuit : aucune eSIM locale nécessaire', { paysOrigine, paysISO })
    return { statut: 'ROAMING_GRATUIT', iccid: null }
  }

  const partenaires = classerPartenaires(await recupererPartenairesActifs(paysISO))
  if (partenaires.length === 0) {
    logger.warn('Aucun partenaire MVNO actif', { paysISO })
    return { statut: 'AUCUN_PARTENAIRE', iccid: null }
  }

  const tentatives = []
  for (const { partenaire, score } of partenaires.slice(0, MAX_TENTATIVES)) {
    const iccid = genererICCID(paysISO)
    const reussi = await provisionnerOTA(partenaire, iccid, userId, fournisseur)
    tentatives.push({ partenaire: partenaire.name, score: Number(score.toFixed(3)), reussi })
    if (reussi) {
      const esim = await enregistrerESIM({ userId, numberId, partenaire, paysISO, plan, iccid })
      logger.info('eSIM provisionnée', { userId, partenaire: partenaire.name })
      return { statut: 'SUCCES', iccid: esim.iccid, partenaire: partenaire.name, plan, esim, tentatives }
    }
    logger.warn('Partenaire en échec : bascule sur le suivant', { partenaire: partenaire.name })
  }

  logger.error('Provisioning eSIM échoué sur tous les partenaires', { paysISO, tentatives: tentatives.length })
  return { statut: 'ECHEC_PROVISIONING', iccid: null, tentatives }
}

module.exports = {
  PLAN_DEFAUT,
  QUOTA_DATA_MO,
  DUREE_FORFAIT_JOURS,
  calculerExpirationForfait,
  calculerCleLuhn,
  verifierLuhn,
  genererICCID,
  calculerScoreCouverture,
  calculerScoreLatence,
  calculerScoreCout,
  calculerScorePartenaire,
  classerPartenaires,
  provisionnerOTA,
  selectionReseauEsim
}
