// src/algorithms/cloisonnementSouverainete.js

const supabase = require('../supabase')

// ════════════════════════════════════════════
// CONSTANTES
// ════════════════════════════════════════════

const REGION_EU_WEST    = 'eu-west-1'
const REGION_EU_CENTRAL = 'eu-central-1'
const REGION_AF_SOUTH   = 'af-south-1'
const REGION_ME_SOUTH   = 'me-south-1'
const REGION_US_EAST    = 'us-east-1'

const OPERATION_READ  = 'READ'
const OPERATION_WRITE = 'WRITE'

// ════════════════════════════════════════════
// FONCTION 1 — chargerTableRoutage
// ════════════════════════════════════════════
const chargerTableRoutage = () => {
  return [
    // PAYS UE
    { pays: 'FR', region: REGION_EU_WEST,    loi: 'RGPD'   },
    { pays: 'BE', region: REGION_EU_WEST,    loi: 'RGPD'   },
    { pays: 'ES', region: REGION_EU_WEST,    loi: 'RGPD'   },
    { pays: 'LU', region: REGION_EU_WEST,    loi: 'RGPD'   },
    { pays: 'PL', region: REGION_EU_CENTRAL, loi: 'RGPD'   },
    { pays: 'RO', region: REGION_EU_CENTRAL, loi: 'RGPD'   },
    { pays: 'SK', region: REGION_EU_CENTRAL, loi: 'RGPD'   },
    { pays: 'MD', region: REGION_EU_CENTRAL, loi: 'RGPD'   },
    // PAYS AFRIQUE
    { pays: 'CM', region: REGION_AF_SOUTH,   loi: 'ARTAC'  },
    { pays: 'CI', region: REGION_AF_SOUTH,   loi: 'ART-CI' },
    { pays: 'SN', region: REGION_AF_SOUTH,   loi: 'ARTP'   },
    { pays: 'ML', region: REGION_AF_SOUTH,   loi: 'AMRTP'  },
    { pays: 'BF', region: REGION_AF_SOUTH,   loi: 'ARCEP'  },
    { pays: 'GN', region: REGION_AF_SOUTH,   loi: 'ARPT'   },
    { pays: 'CD', region: REGION_AF_SOUTH,   loi: 'ARPTC'  },
    { pays: 'MG', region: REGION_AF_SOUTH,   loi: 'ARTEC'  },
    // PAYS MOYEN-ORIENT
    { pays: 'JO', region: REGION_ME_SOUTH,   loi: 'TRC'    },
    { pays: 'EG', region: REGION_ME_SOUTH,   loi: 'NTRA'   },
    // PAYS STANDARD
    { pays: 'US', region: REGION_US_EAST,    loi: 'CCPA'   },
    { pays: 'CA', region: REGION_US_EAST,    loi: 'PIPEDA' }
  ]
}

// ════════════════════════════════════════════
// FONCTION 2 — recupererPaysResidence
// ════════════════════════════════════════════
const recupererPaysResidence = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('country_of_residence')
      .eq('user_id', userId)
      .single()

    if (error || !data) return null
    return data.country_of_residence
  } catch {
    return null
  }
}

// ════════════════════════════════════════════
// FONCTION 3 — resoudreRegionCloud
// ════════════════════════════════════════════
const resoudreRegionCloud = (paysResidence, tableRoutage) => {
  let   i      = 0
  let   trouve = false
  let   entree = null

  while (i < tableRoutage.length && !trouve) {
    if (tableRoutage[i].pays === paysResidence) {
      entree = tableRoutage[i]
      trouve = true
    }
    i++
  }

  if (trouve) return entree

  // Région par défaut si pays non trouvé
  return {
    pays   : paysResidence,
    region : REGION_EU_WEST,
    loi    : 'STANDARD'
  }
}

// ════════════════════════════════════════════
// FONCTION 4 — verifierConformiteRegion
// ════════════════════════════════════════════
const verifierConformiteRegion = (regionCible, paysResidence) => {
  const paysUE      = ['FR','BE','ES','LU','PL','RO','SK','MD']
  const paysAfrique = ['CM','CI','SN','ML','BF','GN','CD','MG']
  const paysOrient  = ['JO','EG']

  // Vérifier UE
  if (paysUE.includes(paysResidence)) {
    return regionCible === REGION_EU_WEST ||
           regionCible === REGION_EU_CENTRAL
  }

  // Vérifier Afrique
  if (paysAfrique.includes(paysResidence)) {
    return regionCible === REGION_AF_SOUTH
  }

  // Vérifier Moyen-Orient
  if (paysOrient.includes(paysResidence)) {
    return regionCible === REGION_ME_SOUTH
  }

  // Autres pays — conformité standard
  return true
}

// ════════════════════════════════════════════
// FONCTION 5 — construireEtiquetteSouverainete
// ════════════════════════════════════════════
const construireEtiquetteSouverainete = (paysResidence,
                                          regionCible,
                                          loi,
                                          typeDonnee) => {
  return paysResidence + '|' +
         regionCible   + '|' +
         loi           + '|' +
         typeDonnee    + '|' +
         new Date().toISOString()
}

// ════════════════════════════════════════════
// PROCÉDURE 1 — journaliserOperationSouverainete
// ════════════════════════════════════════════
const journaliserOperationSouverainete = async (userId,
                                                  typeOperation,
                                                  typeDonnee,
                                                  regionCible,
                                                  autorisee) => {
  await supabase
    .from('audit_log')
    .insert([{
      user_id     : userId,
      entity_type : 'DATA_SOVEREIGNTY',
      action      : typeOperation + '_' + typeDonnee +
                    '_' + regionCible +
                    '_AUTORISEE_' + autorisee,
      actor_type  : 'SYSTEM',
      data_region : regionCible
    }])

  console.log('Audit souveraineté : ' + typeOperation +
    ' | Type : ' + typeDonnee +
    ' | Région : ' + regionCible +
    ' | Autorisée : ' + autorisee)
}

// ════════════════════════════════════════════
// PROCÉDURE 2 — bloquerOperationNonConforme
// ════════════════════════════════════════════
const bloquerOperationNonConforme = (userId, regionCible,
                                      paysResidence, raison) => {
  console.log('══════════════════════════════════')
  console.log('VIOLATION SOUVERAINETÉ BLOQUÉE')
  console.log('Utilisateur    : ' + userId)
  console.log('Pays résidence : ' + paysResidence)
  console.log('Région tentée  : ' + regionCible)
  console.log('Raison         : ' + raison)
  console.log('Action         : Écriture refusée')
  console.log('══════════════════════════════════')
}

// ════════════════════════════════════════════
// PROCÉDURE 3 — mettreAJourRegionUtilisateur
// ════════════════════════════════════════════
const mettreAJourRegionUtilisateur = async (userId,
                                             regionCible) => {
  await supabase
    .from('users')
    .update({ data_region: regionCible })
    .eq('user_id', userId)

  console.log('Région utilisateur mise à jour : ' + regionCible)
}

// ════════════════════════════════════════════
// ALGORITHME PRINCIPAL — ÉCRITURE
// ════════════════════════════════════════════
const routerEcriture = async (userId, typeDonnee,
                               donneeAEcrire) => {
  try {

    // ÉTAPE 1 : Charger la table de routage
    const tableRoutage = chargerTableRoutage()

    // ÉTAPE 2 : Récupérer le pays de résidence
    let paysResidence = await recupererPaysResidence(userId)

    if (!paysResidence) {
      console.log('Pays inconnu — région par défaut appliquée')
      paysResidence = 'FR'
    }

    // ÉTAPE 3 : Résoudre la région cloud
    const entreeRoutage = resoudreRegionCloud(
      paysResidence,
      tableRoutage
    )
    const regionCible = entreeRoutage.region

    // ÉTAPE 4 : Vérifier la conformité
    if (!verifierConformiteRegion(regionCible, paysResidence)) {
      bloquerOperationNonConforme(
        userId,
        regionCible,
        paysResidence,
        'REGION_NON_CONFORME'
      )

      await journaliserOperationSouverainete(
        userId,
        OPERATION_WRITE,
        typeDonnee,
        regionCible,
        false
      )

      return {
        autorisee : false,
        raison    : 'VIOLATION_SOUVERAINETE'
      }
    }

    // ÉTAPE 5 : Construire l'étiquette
    const etiquette = construireEtiquetteSouverainete(
      paysResidence,
      regionCible,
      entreeRoutage.loi,
      typeDonnee
    )

    // ÉTAPE 6 : Mettre à jour la région user
    await mettreAJourRegionUtilisateur(userId, regionCible)

    // ÉTAPE 7 : Journaliser
    await journaliserOperationSouverainete(
      userId,
      OPERATION_WRITE,
      typeDonnee,
      regionCible,
      true
    )

    console.log('Donnée routée vers : ' + regionCible)
    console.log('Étiquette          : ' + etiquette)

    return {
      autorisee   : true,
      regionCible : regionCible,
      etiquette   : etiquette
    }

  } catch (error) {
    console.error('Erreur cloisonnement :', error)
    return { autorisee: false, raison: 'ERREUR_INTERNE' }
  }
}

// ════════════════════════════════════════════
// ALGORITHME PRINCIPAL — LECTURE
// ════════════════════════════════════════════
const routerLecture = async (userId, typeDonnee) => {
  try {

    // ÉTAPE 1 : Récupérer la région d'origine
    const { data } = await supabase
      .from('users')
      .select('data_region')
      .eq('user_id', userId)
      .single()

    const regionOrigine = data ? data.data_region : REGION_EU_WEST

    // ÉTAPE 2 : Journaliser la lecture
    await journaliserOperationSouverainete(
      userId,
      OPERATION_READ,
      typeDonnee,
      regionOrigine,
      true
    )

    console.log('Lecture routée depuis : ' + regionOrigine)

    return {
      autorisee     : true,
      regionLecture : regionOrigine
    }

  } catch (error) {
    console.error('Erreur lecture souveraineté :', error)
    return { autorisee: false }
  }
}

module.exports = {
  routerEcriture,
  routerLecture,
  resoudreRegionCloud,
  verifierConformiteRegion,
  chargerTableRoutage
}