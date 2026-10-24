// src/algorithms/detectionWAF.js

const supabase = require('../supabase')

// ════════════════════════════════════════════
// CONSTANTES
// ════════════════════════════════════════════

const MAX_REQUETES_PAR_SECONDE = 100
const DUREE_BLOCAGE_COURT      = 60
const DUREE_BLOCAGE_LONG       = 3600
const SEUIL_REPUTATION_BAS     = 0.30
const SEUIL_SPIKE              = 10.0
const TTL_COMPTEUR             = 60

const DECISION_AUTORISER = 'ALLOW'
const DECISION_BLOQUER   = 'BLOCK'
const DECISION_CAPTCHA   = 'CAPTCHA'

// ════════════════════════════════════════════
// FONCTION 1 — verifierIPBloquee
// ════════════════════════════════════════════
const verifierIPBloquee = async (adresseIP) => {
  try {
    const { data } = await supabase
      .from('cache_waf')
      .select('*')
      .eq('cle', 'BLOCKED_IP_' + adresseIP)
      .single()

    return data !== null
  } catch {
    return false
  }
}

// ════════════════════════════════════════════
// FONCTION 2 — lireCompteurRequetes
// ════════════════════════════════════════════
const lireCompteurRequetes = async (adresseIP) => {
  try {
    const { data } = await supabase
      .from('cache_waf')
      .select('valeur')
      .eq('cle', 'RATE_' + adresseIP)
      .single()

    return data ? parseInt(data.valeur, 10) : 0
  } catch {
    return 0
  }
}

// ════════════════════════════════════════════
// FONCTION 3 — detecterInjectionSQL
// ════════════════════════════════════════════
const detecterInjectionSQL = (payload) => {
  if (!payload) return false

  const patternsSQL = [
    'DROP TABLE', 'SELECT * FROM', 'UNION SELECT',
    'INSERT INTO', 'DELETE FROM', 'OR 1=1',
    "' OR '", '--', '/*', 'XP_CMDSHELL'
  ]

  const payloadMaj = payload.toUpperCase()
  let   injection  = false
  let   i          = 0

  while (i < patternsSQL.length && !injection) {
    if (payloadMaj.includes(patternsSQL[i])) {
      injection = true
    }
    i++
  }

  return injection
}

// ════════════════════════════════════════════
// FONCTION 4 — detecterInjectionXSS
// ════════════════════════════════════════════
const detecterInjectionXSS = (payload) => {
  if (!payload) return false

  const patternsXSS = [
    '<script>', '</script>', 'javascript:',
    'onerror=', 'onload=', 'alert(',
    'document.cookie', 'eval(', '<iframe', 'src=javascript'
  ]

  const payloadMin = payload.toLowerCase()
  let   injection  = false
  let   i          = 0

  while (i < patternsXSS.length && !injection) {
    if (payloadMin.includes(patternsXSS[i])) {
      injection = true
    }
    i++
  }

  return injection
}

// ════════════════════════════════════════════
// FONCTION 5 — evaluerRegleListeNoire
// ════════════════════════════════════════════
const evaluerRegleListeNoire = async (adresseIP) => {
  const bloquee = await verifierIPBloquee(adresseIP)

  if (bloquee) {
    return {
      declenchee : true,
      decision   : DECISION_BLOQUER,
      raison     : 'IP_EN_LISTE_NOIRE'
    }
  }
  return { declenchee: false, decision: null, raison: null }
}

// ════════════════════════════════════════════
// FONCTION 6 — evaluerRegleRateLimit
// ════════════════════════════════════════════
const evaluerRegleRateLimit = (adresseIP, compteurRequetes) => {
  if (compteurRequetes > MAX_REQUETES_PAR_SECONDE) {
    return {
      declenchee : true,
      decision   : DECISION_BLOQUER,
      raison     : 'RATE_LIMIT_DEPASSE_' + compteurRequetes
    }
  }
  return { declenchee: false, decision: null, raison: null }
}

// ════════════════════════════════════════════
// FONCTION 7 — evaluerRegleInjection
// ════════════════════════════════════════════
const evaluerRegleInjection = (payload) => {
  if (detecterInjectionSQL(payload)) {
    return {
      declenchee : true,
      decision   : DECISION_BLOQUER,
      raison     : 'INJECTION_SQL_DETECTEE'
    }
  }
  if (detecterInjectionXSS(payload)) {
    return {
      declenchee : true,
      decision   : DECISION_BLOQUER,
      raison     : 'INJECTION_XSS_DETECTEE'
    }
  }
  return { declenchee: false, decision: null, raison: null }
}

// ════════════════════════════════════════════
// FONCTION 8 — evaluerRegleSpike
// ════════════════════════════════════════════
const evaluerRegleSpike = (baselineTraffic, trafficActuel) => {
  if (baselineTraffic > 0) {
    const ratio = trafficActuel / baselineTraffic
    if (ratio >= SEUIL_SPIKE) {
      return {
        declenchee : true,
        decision   : DECISION_BLOQUER,
        raison     : 'SPIKE_TRAFIC_X' + Math.round(ratio)
      }
    }
  }
  return { declenchee: false, decision: null, raison: null }
}

// ════════════════════════════════════════════
// FONCTION 9 — evaluerRegleReputation
// ════════════════════════════════════════════
const evaluerRegleReputation = (scoreReputation) => {
  if (scoreReputation < SEUIL_REPUTATION_BAS) {
    return {
      declenchee : true,
      decision   : DECISION_CAPTCHA,
      raison     : 'REPUTATION_IP_FAIBLE_' + scoreReputation
    }
  }
  return { declenchee: false, decision: null, raison: null }
}

// ════════════════════════════════════════════
// PROCÉDURE 1 — incrementerCompteurIP
// ════════════════════════════════════════════
const incrementerCompteurIP = async (adresseIP) => {
  const compteurActuel = await lireCompteurRequetes(adresseIP)

  await supabase
    .from('cache_waf')
    .upsert({
      cle    : 'RATE_' + adresseIP,
      valeur : String(compteurActuel + 1)
    })
}

// ════════════════════════════════════════════
// PROCÉDURE 2 — bloquerIPTemporairement
// ════════════════════════════════════════════
const bloquerIPTemporairement = async (adresseIP,
                                        dureeBlocage,
                                        raison) => {
  await supabase
    .from('cache_waf')
    .upsert({
      cle    : 'BLOCKED_IP_' + adresseIP,
      valeur : raison
    })

  console.log('IP bloquée   : ' + adresseIP)
  console.log('Durée        : ' + dureeBlocage + ' secondes')
  console.log('Raison       : ' + raison)
}

// ════════════════════════════════════════════
// PROCÉDURE 3 — journaliserRequete
// ════════════════════════════════════════════
const journaliserRequete = async (adresseIP, urlCible,
                                   decision, raison) => {
  await supabase
    .from('audit_log')
    .insert([{
      entity_type : 'WAF',
      action      : decision + '_' + raison,
      actor_type  : 'SYSTEM',
      ip_address  : adresseIP,
      data_region : 'af-south-1'
    }])

  console.log('WAF Log : ' + decision +
    ' | IP : ' + adresseIP +
    ' | Raison : ' + raison)
}

// ════════════════════════════════════════════
// PROCÉDURE 4 — notifierEquipeOrange
// ════════════════════════════════════════════
const notifierEquipeOrange = (raison, adresseIP) => {
  console.log('══════════════════════════════')
  console.log('ALERTE WAF — ÉQUIPE ORANGE')
  console.log('Raison    : ' + raison)
  console.log('IP source : ' + adresseIP)
  console.log('══════════════════════════════')
}

// ════════════════════════════════════════════
// ALGORITHME PRINCIPAL
// ════════════════════════════════════════════
const evaluerRequeteWAF = async (requete) => {
  try {
    const adresseIP    = requete.ip      || '0.0.0.0'
    const payload      = JSON.stringify(requete.body || {})
    const urlCible     = requete.url     || '/'
    const baselineTraffic = 100
    const trafficActuel   = 100

    // ÉTAPE 1 : Incrémenter le compteur
    await incrementerCompteurIP(adresseIP)
    const compteurRequetes = await lireCompteurRequetes(adresseIP)
    const scoreReputation  = 0.80

    // ÉTAPE 2 : Définir l'ordre des règles
    const reglesWAF = [
      'LISTE_NOIRE',
      'RATE_LIMIT',
      'INJECTION',
      'SPIKE',
      'REPUTATION'
    ]

    // ÉTAPE 3 : Évaluer chaque règle
    let regleDeclenchee = null
    let i               = 0

    while (i < reglesWAF.length && regleDeclenchee === null) {
      let resultat = { declenchee: false }

      if (reglesWAF[i] === 'LISTE_NOIRE') {
        resultat = await evaluerRegleListeNoire(adresseIP)
      }
      if (reglesWAF[i] === 'RATE_LIMIT') {
        resultat = evaluerRegleRateLimit(
          adresseIP,
          compteurRequetes
        )
      }
      if (reglesWAF[i] === 'INJECTION') {
        resultat = evaluerRegleInjection(payload)
      }
      if (reglesWAF[i] === 'SPIKE') {
        resultat = evaluerRegleSpike(
          baselineTraffic,
          trafficActuel
        )
      }
      if (reglesWAF[i] === 'REPUTATION') {
        resultat = evaluerRegleReputation(scoreReputation)
      }

      if (resultat.declenchee) {
        regleDeclenchee = resultat
      }

      i++
    }

    // ÉTAPE 4 : Aucune règle déclenchée
    if (regleDeclenchee === null) {
      await journaliserRequete(
        adresseIP,
        urlCible,
        DECISION_AUTORISER,
        'REQUETE_NORMALE'
      )
      return { decision: DECISION_AUTORISER }
    }

    // ÉTAPE 5 : Règle déclenchée
    await journaliserRequete(
      adresseIP,
      urlCible,
      regleDeclenchee.decision,
      regleDeclenchee.raison
    )

    if (regleDeclenchee.decision === DECISION_BLOQUER) {
      const dureeBlocage = regleDeclenchee.raison
        .includes('INJECTION')
        ? DUREE_BLOCAGE_LONG
        : DUREE_BLOCAGE_COURT

      await bloquerIPTemporairement(
        adresseIP,
        dureeBlocage,
        regleDeclenchee.raison
      )

      if (regleDeclenchee.raison.includes('INJECTION')) {
        notifierEquipeOrange(
          regleDeclenchee.raison,
          adresseIP
        )
      }
    }

    return {
      decision : regleDeclenchee.decision,
      raison   : regleDeclenchee.raison
    }

  } catch (error) {
    console.error('Erreur WAF :', error)
    return { decision: DECISION_AUTORISER }
  }
}

module.exports = {
  evaluerRequeteWAF,
  detecterInjectionSQL,
  detecterInjectionXSS,
  evaluerRegleRateLimit,
  evaluerRegleInjection,
  evaluerRegleListeNoire,
  evaluerRegleSpike,
  evaluerRegleReputation
}
