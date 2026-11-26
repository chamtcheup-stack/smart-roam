'use strict'

const supabase = require('../supabase')
const v = require('../utils/validation')
const logger = require('../utils/logger')
const { interdit } = require('../utils/http')
const { donnees, paginer } = require('../utils/db')
const { auditerRequete } = require('../utils/audit')
const { preparerConversion, executerTransaction, etatCircuitBreaker } = require('../algorithms/algo17_conversionDevises')
const { detectionFraudeIA, apprendreTransaction } = require('../algorithms/algo07_detectionFraude')

const lireDemande = (corps) => {
  v.exigerChamps(corps, ['deviseSource', 'deviseCible', 'montant'])
  return {
    deviseSource: v.devise(corps.deviseSource, 'deviseSource'),
    deviseCible: v.devise(corps.deviseCible, 'deviseCible'),
    montant: v.montant(corps.montant, 'montant')
  }
}

const devisPublic = (devis) => ({
  deviseSource: devis.deviseSource,
  deviseCible: devis.deviseCible,
  montantSource: devis.montantSource,
  tauxChange: devis.tauxChange,
  sourceTaux: devis.sourceTaux,
  montantBrut: devis.montantBrut,
  tauxCommission: devis.tauxCommission,
  commission: devis.commission,
  montantNet: devis.montantNet,
  montantEquivalentXAF: devis.montantEquivalentXAF
})

// Pays de la transaction : destination du voyage en cours, sinon pays de résidence.
const determinerPaysTransaction = async (userId) => {
  const voyages = donnees(
    await supabase
      .from('trip_declaration')
      .select('destination_country')
      .eq('user_id', userId)
      .eq('status', 'CONFIRMED')
      .order('declaration_time', { ascending: false })
      .limit(1),
    'lecture du voyage en cours'
  ) || []
  if (voyages[0]) return voyages[0].destination_country
  const utilisateur = donnees(
    await supabase.from('users').select('country_of_residence').eq('user_id', userId).maybeSingle(),
    'lecture du pays de résidence'
  )
  return utilisateur ? utilisateur.country_of_residence : null
}

// ════════════════════════════════════════════
// POST /api/currency/preview
// ════════════════════════════════════════════
const previewConversion = async (req, res) => {
  const devis = await preparerConversion(lireDemande(req.body))
  return res.status(200).json({ message: 'Aperçu de votre conversion', ...devisPublic(devis) })
}

// ════════════════════════════════════════════
// POST /api/currency/confirm   (en-tête Idempotency-Key recommandé)
// ════════════════════════════════════════════
const confirmerConversion = async (req, res) => {
  const userId = v.identifiant(req.body.userId, 'userId')
  const devis = await preparerConversion(lireDemande(req.body))

  // Contrôle anti-fraude (algo 07) sur le montant équivalent en XAF.
  const pays = await determinerPaysTransaction(userId)
  const controle = await detectionFraudeIA(userId, {
    montant: devis.montantEquivalentXAF,
    devise: 'XAF',
    pays,
    device_id: req.auth && req.auth.deviceId
  })
  if (controle.statut === 'SUSPENDU') {
    void auditerRequete(req, { userId, entite: 'CURRENCY', action: `TRANSACTION_BLOQUEE_FRAUDE_${controle.typeAnomalie}` })
    throw interdit('Transaction bloquée par le contrôle anti-fraude : votre numéro a été suspendu par précaution, contactez le support Orange')
  }

  const transaction = await executerTransaction(userId, devis)

  if (controle.statut === 'NORMAL') {
    await apprendreTransaction(userId, { montant: devis.montantEquivalentXAF, pays }).catch((erreur) => {
      logger.warn('Apprentissage du profil de fraude impossible', erreur)
    })
  }
  void auditerRequete(req, { userId, entite: 'CURRENCY', action: `TRANSACTION_CONFIRMEE_${transaction.transaction_id}` })

  return res.status(201).json({
    message: 'Transaction confirmée',
    transaction,
    controleFraude: { statut: controle.statut }
  })
}

// ════════════════════════════════════════════
// GET /api/currency/history/:userId
// ════════════════════════════════════════════
const getHistorique = async (req, res) => {
  const page = v.pagination(req.query)
  const { lignes, total } = await paginer(
    supabase
      .from('currency_transaction')
      .select('*', { count: 'exact' })
      .eq('user_id', req.params.userId)
      .order('created_at', { ascending: false }),
    page,
    'lecture de l\'historique des transactions'
  )
  return res.status(200).json({ transactions: lignes, total, ...page })
}

// ════════════════════════════════════════════
// GET /api/currency/corridors
// Corridors de change ouverts et état du circuit breaker
// ════════════════════════════════════════════
const listerCorridors = async (req, res) => {
  const corridors = donnees(
    await supabase.from('currency_exchange_corridor').select('*').eq('is_active', true),
    'lecture des corridors de change'
  ) || []

  return res.status(200).json({
    corridors: corridors.map((corridor) => ({
      deviseSource: corridor.source_currency,
      deviseCible: corridor.target_currency,
      disponible: etatCircuitBreaker(corridor) !== 'DISJONCTE'
    })),
    total: corridors.length
  })
}

module.exports = {
  previewConversion,
  confirmerConversion,
  getHistorique,
  listerCorridors
}
