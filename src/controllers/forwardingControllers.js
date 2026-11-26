'use strict'

const supabase = require('../supabase')
const v = require('../utils/validation')
const { requeteInvalide, introuvable } = require('../utils/http')
const { donnees, paginer } = require('../utils/db')
const {
  ACTIONS,
  CONDITIONS,
  STATUTS_LIGNE,
  ACTION_FORWARD,
  memeNumero,
  invaliderCacheRegles,
  moteurRegleForwarding
} = require('../algorithms/algo16_moteurForwarding')

const VARIANTES_STATUT_LIGNE = [...STATUTS_LIGNE, 'BUSY', 'NO_ANSWER']

const lireStatutLigne = (valeur) => {
  if (v.estAbsent(valeur)) return 'LIBRE'
  const texte = String(valeur).trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (!VARIANTES_STATUT_LIGNE.includes(texte)) {
    throw requeteInvalide('statutLigne invalide', { champ: 'statutLigne', valides: STATUTS_LIGNE })
  }
  return texte
}

// ════════════════════════════════════════════
// POST /api/forwarding/rules/create
// ════════════════════════════════════════════
const creerRegle = async (req, res) => {
  v.exigerChamps(req.body, ['userId', 'numberId', 'triggerCondition', 'action'])
  const userId = v.identifiant(req.body.userId, 'userId')
  const numberId = v.identifiant(req.body.numberId, 'numberId')
  const triggerCondition = v.enumeration(req.body.triggerCondition, 'triggerCondition', { valeurs: CONDITIONS, message: 'Condition invalide' })
  const action = v.enumeration(req.body.action, 'action', { valeurs: ACTIONS, message: 'Action invalide' })
  const targetNumber = v.telephone(req.body.targetNumber, 'targetNumber', { optionnel: true }) || null
  const priority = v.entier(req.body.priority, 'priority', { optionnel: true, defaut: 1, min: 0, max: 1000 })

  const numero = donnees(
    await supabase.from('virtual_number').select('number_id, user_id, did_number').eq('number_id', numberId).maybeSingle(),
    'lecture du numéro virtuel'
  )
  if (!numero || String(numero.user_id) !== String(userId)) throw introuvable('Numéro virtuel introuvable')

  if (action === ACTION_FORWARD) {
    if (!targetNumber) throw requeteInvalide('targetNumber est obligatoire pour l\'action FORWARD', { champ: 'targetNumber' })
    if (memeNumero(targetNumber, numero.did_number)) {
      throw requeteInvalide('Renvoyer un numéro vers lui-même créerait une boucle', { champ: 'targetNumber' })
    }
  }

  const regle = donnees(
    await supabase
      .from('forwarding_rule')
      .insert([{
        number_id: numberId,
        user_id: userId,
        trigger_condition: triggerCondition,
        action,
        target_number: action === ACTION_FORWARD ? targetNumber : null,
        priority,
        is_active: true
      }])
      .select()
      .single(),
    'création de la règle de forwarding'
  )
  invaliderCacheRegles(userId)

  return res.status(201).json({
    message: 'Règle de forwarding créée avec succès',
    regle
  })
}

// ════════════════════════════════════════════
// GET /api/forwarding/rules/:userId
// ════════════════════════════════════════════
const getRegles = async (req, res) => {
  const page = v.pagination(req.query)
  const { lignes, total } = await paginer(
    supabase
      .from('forwarding_rule')
      .select('*', { count: 'exact' })
      .eq('user_id', req.params.userId)
      .order('priority', { ascending: true }),
    page,
    'lecture des règles de forwarding'
  )

  return res.status(200).json({
    message: 'Règles récupérées',
    regles: lignes,
    total,
    ...page
  })
}

// ════════════════════════════════════════════
// PUT /api/forwarding/rules/:ruleId
// Modifier une règle (champs facultatifs : triggerCondition, action,
// targetNumber, priority, isActive)
// ════════════════════════════════════════════
const CHAMPS_MODIFIABLES = ['triggerCondition', 'action', 'targetNumber', 'priority', 'isActive']

const modifierRegle = async (req, res) => {
  const ruleId = v.identifiant(req.params.ruleId, 'ruleId')
  const corps = req.body

  const regle = donnees(
    await supabase.from('forwarding_rule').select('*').eq('rule_id', ruleId).maybeSingle(),
    'lecture de la règle'
  )
  if (!regle) throw introuvable('Règle introuvable')

  const champs = {}
  if ('triggerCondition' in corps) {
    champs.trigger_condition = v.enumeration(corps.triggerCondition, 'triggerCondition', { valeurs: CONDITIONS, message: 'Condition invalide' })
  }
  if ('action' in corps) champs.action = v.enumeration(corps.action, 'action', { valeurs: ACTIONS, message: 'Action invalide' })
  if ('targetNumber' in corps) {
    champs.target_number = corps.targetNumber === null ? null : v.telephone(corps.targetNumber, 'targetNumber')
  }
  if ('priority' in corps) champs.priority = v.entier(corps.priority, 'priority', { min: 0, max: 1000 })
  if ('isActive' in corps) champs.is_active = v.booleen(corps.isActive, 'isActive')
  if (Object.keys(champs).length === 0) {
    throw requeteInvalide('Aucun champ à modifier', { modifiables: CHAMPS_MODIFIABLES })
  }

  // Cohérence évaluée sur la règle finale (ancienne valeur + modifications).
  const finale = { ...regle, ...champs }
  if (finale.action === ACTION_FORWARD) {
    if (!finale.target_number) throw requeteInvalide('targetNumber est obligatoire pour l\'action FORWARD', { champ: 'targetNumber' })
    const numero = donnees(
      await supabase.from('virtual_number').select('did_number').eq('number_id', regle.number_id).maybeSingle(),
      'lecture du numéro virtuel'
    )
    if (numero && memeNumero(finale.target_number, numero.did_number)) {
      throw requeteInvalide('Renvoyer un numéro vers lui-même créerait une boucle', { champ: 'targetNumber' })
    }
  } else {
    champs.target_number = null
  }

  const miseAJour = donnees(
    await supabase.from('forwarding_rule').update(champs).eq('rule_id', ruleId).select().single(),
    'modification de la règle'
  )
  invaliderCacheRegles(regle.user_id)

  return res.status(200).json({ message: 'Règle mise à jour', regle: miseAJour })
}

// ════════════════════════════════════════════
// POST /api/forwarding/evaluate   (SERVICE / ADMIN)
// Décision de routage d'un appel entrant (algo 16)
// ════════════════════════════════════════════
const evaluerAppel = async (req, res) => {
  v.exigerChamps(req.body, ['numeroAppele', 'numeroAppelant'])
  const numeroAppele = v.telephone(req.body.numeroAppele, 'numeroAppele')
  // L'appelant peut être masqué (« anonymous ») : simple chaîne.
  const numeroAppelant = v.chaine(String(req.body.numeroAppelant), 'numeroAppelant', { max: 64 })
  const statutLigne = lireStatutLigne(req.body.statutLigne)

  const resultat = await moteurRegleForwarding(numeroAppele, numeroAppelant, statutLigne)

  if (resultat.raison === 'NUMERO_INCONNU_OU_INACTIF') {
    return res.status(404).json({
      erreur: 'Numéro DID introuvable ou inactif',
      decision: resultat.decision,
      codeSIP: resultat.codeSIP
    })
  }

  const messages = {
    REGLE_APPLIQUEE: 'Règle appliquée',
    AUCUNE_REGLE: 'Aucune règle configurée',
    AUCUNE_REGLE_APPLICABLE: 'Aucune règle applicable'
  }
  return res.status(200).json({
    message: messages[resultat.raison],
    decision: resultat.decision,
    destination: resultat.destination,
    codeSIP: resultat.codeSIP,
    regle: resultat.regle
  })
}

// ════════════════════════════════════════════
// DELETE /api/forwarding/rules/:ruleId  (désactivation)
// ════════════════════════════════════════════
const supprimerRegle = async (req, res) => {
  const ruleId = v.identifiant(req.params.ruleId, 'ruleId')

  const regles = donnees(
    await supabase
      .from('forwarding_rule')
      .update({ is_active: false })
      .eq('rule_id', ruleId)
      .select('rule_id, user_id'),
    'désactivation de la règle'
  ) || []
  if (regles.length === 0) throw introuvable('Règle introuvable')
  invaliderCacheRegles(regles[0].user_id)

  return res.status(200).json({ message: 'Règle désactivée avec succès' })
}

module.exports = {
  creerRegle,
  getRegles,
  modifierRegle,
  evaluerAppel,
  supprimerRegle,
  lireStatutLigne
}
