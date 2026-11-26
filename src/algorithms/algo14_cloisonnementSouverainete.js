'use strict'

// ════════════════════════════════════════════════════════════
// ALGO 14 — Cloisonnement par souveraineté des données
//
// Les données d'un utilisateur sont stockées dans la région cloud
// imposée par la loi de son pays de résidence. Source de vérité :
// colonne country.data_region ; repli : table de routage statique.
// Un pays non référencé n'est plus routé silencieusement vers l'UE :
// il reçoit la région par défaut avec l'étiquette NON_REFERENCE et
// un avertissement pour compléter la table.
// ════════════════════════════════════════════════════════════

const supabase = require('../supabase')
const logger = require('../utils/logger')
const { donnees } = require('../utils/db')
const { journaliserAudit } = require('../utils/audit')

const REGION_EU_WEST = 'eu-west-1'
const REGION_EU_CENTRAL = 'eu-central-1'
const REGION_AF_SOUTH = 'af-south-1'
const REGION_ME_SOUTH = 'me-south-1'
const REGION_US_EAST = 'us-east-1'
const REGION_PAR_DEFAUT = REGION_EU_WEST

const OPERATION_READ = 'READ'
const OPERATION_WRITE = 'WRITE'

const TABLE_ROUTAGE = Object.freeze([
  // UE
  { pays: 'FR', region: REGION_EU_WEST, loi: 'RGPD' },
  { pays: 'BE', region: REGION_EU_WEST, loi: 'RGPD' },
  { pays: 'ES', region: REGION_EU_WEST, loi: 'RGPD' },
  { pays: 'LU', region: REGION_EU_WEST, loi: 'RGPD' },
  { pays: 'PL', region: REGION_EU_CENTRAL, loi: 'RGPD' },
  { pays: 'RO', region: REGION_EU_CENTRAL, loi: 'RGPD' },
  { pays: 'SK', region: REGION_EU_CENTRAL, loi: 'RGPD' },
  { pays: 'MD', region: REGION_EU_CENTRAL, loi: 'RGPD' },
  // Afrique
  { pays: 'CM', region: REGION_AF_SOUTH, loi: 'ARTAC' },
  { pays: 'CI', region: REGION_AF_SOUTH, loi: 'ART-CI' },
  { pays: 'SN', region: REGION_AF_SOUTH, loi: 'ARTP' },
  { pays: 'ML', region: REGION_AF_SOUTH, loi: 'AMRTP' },
  { pays: 'BF', region: REGION_AF_SOUTH, loi: 'ARCEP' },
  { pays: 'GN', region: REGION_AF_SOUTH, loi: 'ARPT' },
  { pays: 'CD', region: REGION_AF_SOUTH, loi: 'ARPTC' },
  { pays: 'MG', region: REGION_AF_SOUTH, loi: 'ARTEC' },
  { pays: 'MA', region: REGION_AF_SOUTH, loi: 'CNDP' },
  { pays: 'TN', region: REGION_AF_SOUTH, loi: 'INPDP' },
  { pays: 'CF', region: REGION_AF_SOUTH, loi: 'STANDARD_AFRIQUE' },
  { pays: 'GW', region: REGION_AF_SOUTH, loi: 'STANDARD_AFRIQUE' },
  { pays: 'LR', region: REGION_AF_SOUTH, loi: 'STANDARD_AFRIQUE' },
  { pays: 'SL', region: REGION_AF_SOUTH, loi: 'STANDARD_AFRIQUE' },
  { pays: 'BW', region: REGION_AF_SOUTH, loi: 'STANDARD_AFRIQUE' },
  // Moyen-Orient
  { pays: 'JO', region: REGION_ME_SOUTH, loi: 'TRC' },
  { pays: 'EG', region: REGION_ME_SOUTH, loi: 'NTRA' },
  // Amérique du Nord
  { pays: 'US', region: REGION_US_EAST, loi: 'CCPA' },
  { pays: 'CA', region: REGION_US_EAST, loi: 'PIPEDA' }
].map((entree) => Object.freeze(entree)))

const REGIONS_AUTORISEES_PAR_ZONE = Object.freeze({
  [REGION_EU_WEST]: [REGION_EU_WEST, REGION_EU_CENTRAL],
  [REGION_EU_CENTRAL]: [REGION_EU_WEST, REGION_EU_CENTRAL],
  [REGION_AF_SOUTH]: [REGION_AF_SOUTH],
  [REGION_ME_SOUTH]: [REGION_ME_SOUTH],
  [REGION_US_EAST]: [REGION_US_EAST]
})

const chargerTableRoutage = () => TABLE_ROUTAGE

const recupererProfilResidence = async (userId) => donnees(
  await supabase.from('users').select('country_of_residence, data_region').eq('user_id', userId).maybeSingle(),
  'lecture du pays de résidence'
)

const recupererRegionPays = async (paysISO) => {
  const pays = donnees(
    await supabase.from('country').select('data_region').eq('country_iso', paysISO).maybeSingle(),
    'lecture de la région du pays'
  )
  return pays && pays.data_region ? pays.data_region : null
}

// Résolution pure : région de la base si connue, sinon table statique, sinon défaut signalé.
const resoudreRegionCloud = (paysResidence, tableRoutage = TABLE_ROUTAGE, regionBase = null) => {
  const entree = tableRoutage.find((ligne) => ligne.pays === paysResidence)
  if (regionBase) return { pays: paysResidence, region: regionBase, loi: entree ? entree.loi : 'SELON_REFERENTIEL', reference: true }
  if (entree) return { ...entree, reference: true }
  return { pays: paysResidence, region: REGION_PAR_DEFAUT, loi: 'NON_REFERENCE', reference: false }
}

// La région cible doit appartenir à la zone légale de la région attendue.
const verifierConformiteRegion = (regionCible, regionAttendue) => {
  const autorisees = REGIONS_AUTORISEES_PAR_ZONE[regionAttendue]
  return autorisees ? autorisees.includes(regionCible) : regionCible === regionAttendue
}

const construireEtiquetteSouverainete = (paysResidence, regionCible, loi, typeDonnee) =>
  [paysResidence, regionCible, loi, typeDonnee, new Date().toISOString()].join('|')

// ── Procédures ──────────────────────────────────────────────
const journaliserOperationSouverainete = (userId, typeOperation, typeDonnee, regionCible, autorisee) => {
  void journaliserAudit({
    userId,
    entite: 'DATA_SOVEREIGNTY',
    action: `${typeOperation}_${typeDonnee}_${regionCible}_AUTORISEE_${autorisee}`,
    extra: { data_region: regionCible }
  })
}

const bloquerOperationNonConforme = (userId, regionCible, paysResidence, raison) => {
  logger.error('Violation de souveraineté bloquée : écriture refusée', { userId, paysResidence, regionCible, raison })
}

const mettreAJourRegionUtilisateur = async (userId, regionCible) => {
  donnees(
    await supabase.from('users').update({ data_region: regionCible }).eq('user_id', userId),
    'mise à jour de la région de l\'utilisateur'
  )
  logger.info('Région de stockage de l\'utilisateur mise à jour', { userId, regionCible })
}

// ── Algorithme principal — écriture ─────────────────────────
// regionDemandee : région où l'appelant compte écrire (par défaut, la région résolue).
const routerEcriture = async (userId, typeDonnee, { regionDemandee = null } = {}) => {
  const profil = await recupererProfilResidence(userId)
  if (!profil || !profil.country_of_residence) {
    return { autorisee: false, raison: 'PAYS_DE_RESIDENCE_INCONNU' }
  }

  const paysResidence = profil.country_of_residence
  const routage = resoudreRegionCloud(paysResidence, TABLE_ROUTAGE, await recupererRegionPays(paysResidence))
  if (!routage.reference) {
    logger.warn('Pays absent du référentiel de souveraineté : région par défaut appliquée', { paysResidence })
  }

  const regionCible = regionDemandee || routage.region
  if (!verifierConformiteRegion(regionCible, routage.region)) {
    bloquerOperationNonConforme(userId, regionCible, paysResidence, 'REGION_NON_CONFORME')
    journaliserOperationSouverainete(userId, OPERATION_WRITE, typeDonnee, regionCible, false)
    return { autorisee: false, raison: 'VIOLATION_SOUVERAINETE', regionAttendue: routage.region }
  }

  if (profil.data_region !== routage.region) await mettreAJourRegionUtilisateur(userId, routage.region)

  const etiquette = construireEtiquetteSouverainete(paysResidence, regionCible, routage.loi, typeDonnee)
  journaliserOperationSouverainete(userId, OPERATION_WRITE, typeDonnee, regionCible, true)
  return { autorisee: true, regionCible, etiquette, referencee: routage.reference }
}

// ── Algorithme principal — lecture ──────────────────────────
const routerLecture = async (userId, typeDonnee) => {
  const profil = await recupererProfilResidence(userId)
  if (!profil) return { autorisee: false, raison: 'UTILISATEUR_INCONNU' }

  const regionLecture = profil.data_region ||
    resoudreRegionCloud(profil.country_of_residence, TABLE_ROUTAGE, await recupererRegionPays(profil.country_of_residence)).region

  journaliserOperationSouverainete(userId, OPERATION_READ, typeDonnee, regionLecture, true)
  return { autorisee: true, regionLecture }
}

module.exports = {
  REGION_PAR_DEFAUT,
  chargerTableRoutage,
  resoudreRegionCloud,
  verifierConformiteRegion,
  construireEtiquetteSouverainete,
  recupererRegionPays,
  routerEcriture,
  routerLecture
}
