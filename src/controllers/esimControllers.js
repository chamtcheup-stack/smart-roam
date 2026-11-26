'use strict'

const supabase = require('../supabase')
const v = require('../utils/validation')
const { HttpError, introuvable, requeteInvalide, indisponible } = require('../utils/http')
const { donnees, paginer } = require('../utils/db')
const { executerEnExclusion } = require('../utils/exclusion')
const {
  selectionReseauEsim,
  calculerExpirationForfait,
  PLAN_DEFAUT,
  QUOTA_DATA_MO
} = require('../algorithms/algo05_selectionReseauESIM')

const PLANS = Object.keys(QUOTA_DATA_MO)

// Échéance calculée du forfait (null pour BYOE).
const avecEcheance = (esim) => (esim ? { ...esim, expire_le: calculerExpirationForfait(esim) } : esim)

// ════════════════════════════════════════════
// POST /api/esim/provision
// Sélection du réseau et provisioning (algo 05)
// ════════════════════════════════════════════
const provisionnerESIM = async (req, res) => {
  v.exigerChamps(req.body, ['userId', 'numberId', 'paysISO'])
  const userId = v.identifiant(req.body.userId, 'userId')
  const numberId = v.identifiant(req.body.numberId, 'numberId')
  const paysISO = v.paysISO(req.body.paysISO, 'paysISO')
  const plan = v.enumeration(req.body.plan, 'plan', { optionnel: true, defaut: PLAN_DEFAUT, valeurs: PLANS, message: 'Forfait invalide' })

  const numero = donnees(
    await supabase.from('virtual_number').select('number_id, user_id, country_iso').eq('number_id', numberId).maybeSingle(),
    'lecture du numéro virtuel'
  )
  if (!numero || String(numero.user_id) !== String(userId)) throw introuvable('Numéro virtuel introuvable')
  if (numero.country_iso !== paysISO) {
    throw requeteInvalide('Le pays de l\'eSIM doit être celui du numéro virtuel', { paysNumero: numero.country_iso })
  }

  // Une demande à la fois par numéro : deux appels simultanés ne créent pas deux eSIM.
  return executerEnExclusion(`esim:${userId}:${numberId}`, () => provisionnerSansConcurrence(res, { userId, numberId, paysISO, plan }))
}

const provisionnerSansConcurrence = async (res, { userId, numberId, paysISO, plan }) => {
  // Une seule eSIM active par numéro : la demande répétée renvoie l'existante.
  const existantes = donnees(
    await supabase.from('esim_profile').select('*').eq('user_id', userId).eq('number_id', numberId).eq('status', 'ACTIVE').limit(1),
    'recherche d\'une eSIM active'
  ) || []
  if (existantes.length > 0) {
    return res.status(200).json({ message: 'Une eSIM active existe déjà pour ce numéro', esim: avecEcheance(existantes[0]) })
  }

  const resultat = await selectionReseauEsim({ userId, numberId, paysISO, plan })

  switch (resultat.statut) {
    case 'SUCCES':
      return res.status(201).json({ message: 'eSIM provisionnée avec succès', esim: avecEcheance(resultat.esim), partenaire: resultat.partenaire, plan })
    case 'BYOE':
      return res.status(201).json({ message: 'Mode BYOE : votre propre eSIM sera utilisée', esim: resultat.esim })
    case 'ROAMING_GRATUIT':
      return res.status(200).json({ message: 'Roaming UE gratuit : aucune eSIM locale nécessaire', esim: null })
    case 'AUCUN_PARTENAIRE':
      throw indisponible('eSIM non disponible pour ce pays (aucun partenaire actif)')
    default:
      throw new HttpError(502, 'Le provisioning a échoué chez tous les partenaires, réessayez plus tard', {}, { expose: true })
  }
}

// ════════════════════════════════════════════
// GET /api/esim/:userId
// ════════════════════════════════════════════
const getESIM = async (req, res) => {
  const page = v.pagination(req.query)
  const { lignes, total } = await paginer(
    supabase
      .from('esim_profile')
      .select('*', { count: 'exact' })
      .eq('user_id', req.params.userId)
      .order('activated_at', { ascending: false, nullsFirst: false }),
    page,
    'lecture des eSIM'
  )

  return res.status(200).json({ esims: lignes.map(avecEcheance), total, ...page })
}

module.exports = { provisionnerESIM, getESIM }
