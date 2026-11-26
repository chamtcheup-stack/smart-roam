'use strict'

const supabase = require('../supabase')
const v = require('../utils/validation')
const { introuvable, requeteInvalide, conflit } = require('../utils/http')
const { donnees, paginer, executerSansEchec } = require('../utils/db')
const { executerEnExclusion } = require('../utils/exclusion')
const { declarerDestination: declarer } = require('../algorithms/algo20_declarationDestination')

// ════════════════════════════════════════════
// POST /api/declarations/new   (en-tête Idempotency-Key recommandé)
// Déclarer un voyage (algo 20 → attribution du numéro, algo 15)
// ════════════════════════════════════════════
const declarerDestination = async (req, res) => {
  v.exigerChamps(req.body, ['userId', 'paysISO', 'dateDepart'])
  const userId = v.identifiant(req.body.userId, 'userId')
  const paysISO = v.paysISO(req.body.paysISO, 'paysISO')
  const dateDepart = v.date(req.body.dateDepart, 'dateDepart')
  const dateRetour = v.date(req.body.dateRetour, 'dateRetour', { optionnel: true }) || null

  // Deux déclarations simultanées du même voyage : la seconde retrouve la première.
  const resultat = await executerEnExclusion(`declaration:${userId}`, () => declarer({ userId, paysISO, dateDepart, dateRetour }))

  if (resultat.statut === 'EXISTANTE') {
    return res.status(200).json({
      message: 'Déclaration déjà active pour ce pays',
      declaration: resultat.declaration
    })
  }

  return res.status(201).json({
    message: 'Déclaration enregistrée avec succès',
    declaration: resultat.declaration,
    numeroVirtuel: resultat.numeroVirtuel,
    pays: resultat.pays.name_fr || paysISO
  })
}

// ════════════════════════════════════════════
// GET /api/declarations/:userId
// ════════════════════════════════════════════
const getDeclarations = async (req, res) => {
  const page = v.pagination(req.query)
  const { lignes, total } = await paginer(
    supabase
      .from('trip_declaration')
      .select('*', { count: 'exact' })
      .eq('user_id', req.params.userId)
      .order('declaration_time', { ascending: false }),
    page,
    'lecture des déclarations'
  )

  return res.status(200).json({ declarations: lignes, total, ...page })
}

// ════════════════════════════════════════════
// PUT /api/declarations/:declarationId/cancel
// ════════════════════════════════════════════
const annulerDeclaration = async (req, res) => {
  const declarationId = v.identifiant(req.params.declarationId, 'declarationId')

  const existante = donnees(
    await supabase.from('trip_declaration').select('*').eq('declaration_id', declarationId).maybeSingle(),
    'lecture de la déclaration'
  )
  if (!existante) throw introuvable('Déclaration introuvable')
  if (existante.status === 'COMPLETED') throw requeteInvalide('Impossible d\'annuler un voyage terminé')
  if (existante.status === 'CANCELLED') {
    return res.status(200).json({ message: 'Déclaration déjà annulée', declaration: existante })
  }

  // Mise à jour conditionnelle : aucun changement concurrent de statut écrasé.
  const lignes = donnees(
    await supabase
      .from('trip_declaration')
      .update({ status: 'CANCELLED' })
      .eq('declaration_id', declarationId)
      .eq('status', existante.status)
      .select(),
    'annulation de la déclaration'
  ) || []
  if (lignes.length === 0) throw conflit('La déclaration a été modifiée entre-temps : réessayez')

  // Le numéro reste la propriété de l'utilisateur mais ne reçoit plus d'appels.
  if (existante.number_id) {
    await executerSansEchec(
      supabase
        .from('virtual_number')
        .update({ status: 'PARKED' })
        .eq('number_id', existante.number_id)
        .in('status', ['AWAITING_ARRIVAL', 'ACTIVE']),
      'mise en parking du numéro après annulation'
    )
  }

  return res.status(200).json({ message: 'Déclaration annulée', declaration: lignes[0] })
}

module.exports = {
  declarerDestination,
  getDeclarations,
  annulerDeclaration
}
