'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 20 — Déclaration de destination (préparation du voyage)
//
//   1. Pays supporté (DID activé)            sinon 400
//   2. Dates cohérentes (départ ≥ hier, retour ≥ départ, ≤ 1 an)
//   3. Voyage vers ce pays déjà déclaré ou en cours → renvoyé tel quel
//   4. Numéro virtuel attribué (algo 15)     sinon 503
//   5. Déclaration + historique de voyage enregistrés
// ════════════════════════════════════════════════════════════

const supabase = require('../supabase')
const logger = require('../utils/logger')
const { requeteInvalide, indisponible } = require('../utils/http')
const { donnees, executerSansEchec } = require('../utils/db')
const { attribuerNumeroDID } = require('./algo15_attributionDID')

const DUREE_MAX_VOYAGE_JOURS = 365
const MS_PAR_JOUR = 24 * 60 * 60 * 1000

const debutJourUTC = (date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

// dateDepart / dateRetour : chaînes ISO déjà validées syntaxiquement.
const verifierDates = (dateDepart, dateRetour, maintenant = new Date()) => {
  const depart = debutJourUTC(new Date(dateDepart))
  const hier = debutJourUTC(maintenant) - MS_PAR_JOUR
  if (depart < hier) throw requeteInvalide('La date de départ ne peut pas être dans le passé', { champ: 'dateDepart' })
  if (depart > debutJourUTC(maintenant) + DUREE_MAX_VOYAGE_JOURS * MS_PAR_JOUR) {
    throw requeteInvalide('La date de départ est trop lointaine (1 an maximum)', { champ: 'dateDepart' })
  }
  if (dateRetour) {
    const retour = debutJourUTC(new Date(dateRetour))
    if (retour < depart) throw requeteInvalide('La date de retour doit être postérieure ou égale au départ', { champ: 'dateRetour' })
    if (retour - depart > DUREE_MAX_VOYAGE_JOURS * MS_PAR_JOUR) {
      throw requeteInvalide('Le voyage ne peut pas dépasser 1 an', { champ: 'dateRetour' })
    }
  }
}

const verifierPaysSupporte = async (paysISO) => donnees(
  await supabase.from('country').select('*').eq('country_iso', paysISO).eq('did_enabled', true).maybeSingle(),
  'vérification du pays'
)

// Voyage vers ce pays déjà déclaré (PENDING) ou en cours (CONFIRMED : voyageur sur place).
const verifierDeclarationExistante = async (userId, paysISO) => {
  const lignes = donnees(
    await supabase
      .from('trip_declaration')
      .select('*')
      .eq('user_id', userId)
      .eq('destination_country', paysISO)
      .in('status', ['PENDING', 'CONFIRMED'])
      .order('declaration_time', { ascending: false })
      .limit(1),
    'recherche d\'une déclaration existante'
  )
  return (lignes && lignes[0]) || null
}

// ── Procédures ──────────────────────────────────────────────
const enregistrerDeclaration = async (userId, paysISO, dateDepart, dateRetour, numberId) => donnees(
  await supabase
    .from('trip_declaration')
    .insert([{
      user_id: userId,
      destination_country: paysISO,
      departure_date: dateDepart,
      return_date: dateRetour || null,
      status: 'PENDING',
      number_id: numberId,
      vault_prepared: false,
      declaration_time: new Date().toISOString()
    }])
    .select()
    .single(),
  'enregistrement de la déclaration'
)

const enregistrerHistorique = (userId, paysISO) => executerSansEchec(
  supabase.from('travel_history').insert([{
    user_id: userId,
    country_iso: paysISO,
    declared_destination: paysISO,
    declaration_time: new Date().toISOString(),
    detection_method: 'MANUAL'
  }]),
  'historique de voyage'
)

// ── Traitement principal ────────────────────────────────────
const declarerDestination = async ({ userId, paysISO, dateDepart, dateRetour = null }, { maintenant = new Date() } = {}) => {
  const pays = await verifierPaysSupporte(paysISO)
  if (!pays) throw requeteInvalide('Ce pays n\'est pas encore disponible sur Smart Roam', { pays: paysISO })

  verifierDates(dateDepart, dateRetour, maintenant)

  const declarationExistante = await verifierDeclarationExistante(userId, paysISO)
  if (declarationExistante) return { statut: 'EXISTANTE', declaration: declarationExistante, pays }

  const numeroVirtuel = await attribuerNumeroDID(userId, paysISO)
  if (!numeroVirtuel) throw indisponible('Aucun numéro disponible pour ce pays pour le moment')

  const declaration = await enregistrerDeclaration(userId, paysISO, dateDepart, dateRetour, numeroVirtuel.number_id)
  await enregistrerHistorique(userId, paysISO)

  logger.info('Destination déclarée : numéro prêt, activation à l\'arrivée', { userId, paysISO })
  return { statut: 'CREEE', declaration, numeroVirtuel, pays }
}

module.exports = {
  DUREE_MAX_VOYAGE_JOURS,
  verifierDates,
  declarerDestination
}
