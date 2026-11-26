'use strict'

// ════════════════════════════════════════════════════════════
// Maintenance périodique (MAINTENANCE_INTERVAL_MINUTES) :
//   1. voyages échus : CONFIRMED dont la date de retour est dépassée de
//      2 jours → COMPLETED ; PENDING jamais arrivés → CANCELLED
//      (retour dépassé, ou départ dépassé de 30 jours sans date de retour) ;
//   2. numéros de ces voyages mis en parking s'ils ne servent à aucun
//      autre voyage actif (ils restent la propriété de l'utilisateur) ;
//   3. forfaits eSIM DAY / WEEK / MONTH échus (depuis activated_at) → EXPIRED ;
//   4. sessions expirées purgées.
// Chaque mise à jour est conditionnelle (statut attendu) : elle n'écrase
// jamais une arrivée ou un retour détecté entre-temps. Une étape en échec
// n'empêche pas les suivantes.
// ════════════════════════════════════════════════════════════

const supabase = require('../supabase')
const logger = require('../utils/logger')
const { donnees, estIncompatibiliteSchema, ErreurBase } = require('../utils/db')
const { journaliserAudit } = require('../utils/audit')
const { DUREE_FORFAIT_JOURS } = require('../algorithms/algo05_selectionReseauESIM')

const DELAI_GRACE_RETOUR_JOURS = 2
const DELAI_MAX_SANS_ARRIVEE_JOURS = 30
const MS_PAR_JOUR = 24 * 60 * 60 * 1000

const ilYa = (maintenant, jours) => new Date(maintenant.getTime() - jours * MS_PAR_JOUR)
const dateISO = (date) => date.toISOString().slice(0, 10)

// Met en parking les numéros qui ne sont plus utilisés par aucun voyage actif.
const parquerNumerosLiberes = async (numberIds) => {
  let parques = 0
  for (const numberId of new Set(numberIds.filter(Boolean))) {
    const voyagesActifs = donnees(
      await supabase
        .from('trip_declaration')
        .select('declaration_id')
        .eq('number_id', numberId)
        .in('status', ['PENDING', 'CONFIRMED'])
        .limit(1),
      'recherche des voyages actifs du numéro'
    ) || []
    if (voyagesActifs.length > 0) continue

    const lignes = donnees(
      await supabase
        .from('virtual_number')
        .update({ status: 'PARKED' })
        .eq('number_id', numberId)
        .in('status', ['ACTIVE', 'AWAITING_ARRIVAL'])
        .select('number_id'),
      'mise en parking du numéro'
    ) || []
    parques += lignes.length
  }
  return parques
}

const cloturerVoyagesEchus = async (maintenant = new Date()) => {
  const limiteRetour = dateISO(ilYa(maintenant, DELAI_GRACE_RETOUR_JOURS))
  const limiteDepart = dateISO(ilYa(maintenant, DELAI_MAX_SANS_ARRIVEE_JOURS))
  const colonnes = 'declaration_id, number_id'

  const termines = donnees(
    await supabase.from('trip_declaration').update({ status: 'COMPLETED' })
      .eq('status', 'CONFIRMED').lt('return_date', limiteRetour).select(colonnes),
    'clôture des voyages terminés'
  ) || []

  const annulesRetour = donnees(
    await supabase.from('trip_declaration').update({ status: 'CANCELLED' })
      .eq('status', 'PENDING').lt('return_date', limiteRetour).select(colonnes),
    'annulation des voyages jamais commencés'
  ) || []

  const annulesDepart = donnees(
    await supabase.from('trip_declaration').update({ status: 'CANCELLED' })
      .eq('status', 'PENDING').is('return_date', null).lt('departure_date', limiteDepart).select(colonnes),
    'annulation des voyages sans arrivée'
  ) || []

  const annules = [...annulesRetour, ...annulesDepart]
  const numerosParkes = await parquerNumerosLiberes([...termines, ...annules].map((voyage) => voyage.number_id))
  return { voyagesTermines: termines.length, voyagesAnnules: annules.length, numerosParkes }
}

const expirerForfaitsESIM = async (maintenant = new Date()) => {
  let expirees = 0
  for (const [plan, jours] of Object.entries(DUREE_FORFAIT_JOURS)) {
    const lignes = donnees(
      await supabase
        .from('esim_profile')
        .update({ status: 'EXPIRED' })
        .eq('status', 'ACTIVE')
        .eq('plan_type', plan)
        .lt('activated_at', ilYa(maintenant, jours).toISOString())
        .select('iccid'),
      `expiration des forfaits eSIM ${plan}`
    ) || []
    expirees += lignes.length
  }
  return expirees
}

const purgerSessionsExpirees = async (maintenant = new Date()) => {
  const { data, error } = await supabase
    .from('session')
    .delete()
    .lt('expires_at', maintenant.toISOString())
    .select('refresh_token_hash')
  if (error) {
    if (estIncompatibiliteSchema(error)) return 0 // table optionnelle absente
    throw new ErreurBase('purge des sessions expirées', error)
  }
  return Array.isArray(data) ? data.length : 0
}

// Exécute toutes les étapes ; retourne le rapport (null pour une étape en échec).
const executerMaintenance = async ({ maintenant = new Date() } = {}) => {
  const etapes = [
    ['voyages', () => cloturerVoyagesEchus(maintenant)],
    ['esimExpirees', () => expirerForfaitsESIM(maintenant)],
    ['sessionsPurgees', () => purgerSessionsExpirees(maintenant)]
  ]
  const rapport = {}
  for (const [nom, etape] of etapes) {
    try {
      rapport[nom] = await etape()
    } catch (erreur) {
      rapport[nom] = null
      logger.error(`Maintenance : étape « ${nom} » en échec`, erreur)
    }
  }

  const voyages = rapport.voyages || {}
  if (voyages.voyagesTermines || voyages.voyagesAnnules) {
    void journaliserAudit({
      entite: 'MAINTENANCE',
      action: `VOYAGES_CLOTURES_${voyages.voyagesTermines || 0}_ANNULES_${voyages.voyagesAnnules || 0}`
    })
  }
  logger.info('Maintenance terminée', rapport)
  return rapport
}

module.exports = {
  DELAI_GRACE_RETOUR_JOURS,
  DELAI_MAX_SANS_ARRIVEE_JOURS,
  cloturerVoyagesEchus,
  expirerForfaitsESIM,
  purgerSessionsExpirees,
  executerMaintenance
}
