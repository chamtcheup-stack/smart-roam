const supabase = require ('../supabase')

const distanceMaxFuzzy     = 2    // distance max acceptée
const bonusMatchExact      = 30   // bonus confiance exact
const bonusMatchFuzzy      = 15   // bonus confiance fuzzy
const longueurMinSSID      = 3    // SSID minimum 3 caractères
const frequenceMAJ         = "TRIMESTRIELLE" // mise à jour base

const chargerBaseSSIDs = () =>{
    let base 

    base = [
      // AFRIQUE
      { ssid: "AEROPORT_YDE_WIFI",    iata: "YDE", pays: "CM" },
      { ssid: "NSI_AIRPORT_FREE",     iata: "YDE", pays: "CM" },
      { ssid: "DLA_AIRPORT_WIFI",     iata: "DLA", pays: "CM" },
      { ssid: "ABIDJAN_AIRPORT",      iata: "ABJ", pays: "CI" },
      { ssid: "DAKAR_AIRPORT_WIFI",   iata: "DSS", pays: "SN" },
      { ssid: "LEOPOLD_WIFI",         iata: "DSS", pays: "SN" },
      { ssid: "BAMAKO_AIRPORT",       iata: "BKO", pays: "ML" },
      { ssid: "OUAGA_AERO_WIFI",      iata: "OUA", pays: "BF" },
      { ssid: "CONAKRY_AIRPORT",      iata: "CKY", pays: "GN" },
      // EUROPE
      { ssid: "CDG_WIFI",             iata: "CDG", pays: "FR" },
      { ssid: "PARIS_AIRPORT_FREE",   iata: "CDG", pays: "FR" },
      { ssid: "ORLY_AIRPORT_WIFI",    iata: "ORY", pays: "FR" },
      { ssid: "BRUSSELS_AIRPORT",     iata: "BRU", pays: "BE" },
      { ssid: "BRU_FREE_WIFI",        iata: "BRU", pays: "BE" },
      { ssid: "MADRID_BARAJAS_WIFI",  iata: "MAD", pays: "ES" },
      { ssid: "WARSAW_CHOPIN_WIFI",   iata: "WAW", pays: "PL" },
      { ssid: "BUCHAREST_AIRPORT",    iata: "OTP", pays: "RO" },
      // MOYEN-ORIENT
      { ssid: "AMMAN_AIRPORT_WIFI",   iata: "AMM", pays: "JO" },
      { ssid: "CAIRO_AIRPORT_FREE",   iata: "CAI", pays: "EG" },
      // AMERIQUE
      { ssid: "JFK_AIRPORT_WIFI",     iata: "JFK", pays: "US" },
      { ssid: "PEARSON_WIFI",         iata: "YYZ", pays: "CA" }
      // ... 130+ autres aéroports
    ]
    return base 
}

const normaliserSSID = (ssid) =>{
    let ssidNorm 

    ssidNorm = MAJUSCULES(ssid)
    ssidNorm = SUPPRIMER_ESPACES_DEBUT_FIN(ssidNorm)
    ssidNorm = REMPLACER(ssidNorm, "-", "_")

    return ssidNorm
}

const rechercherMatchExact = (ssidNormalise, baseSSIDs) =>{
    let i 
    let resultat

    resultat = null
    i = 0

    while (i < baseSSIDs.length && resultat === null){
        if (normaliserSSID(baseSSIDs[i].ssid) === ssidNormalise){
            resultat = baseSSIDs[i]
        }
        i++
    }
    return resultat
}

const calculerDistanceLevenstein = (chaine1, chaine2) =>{
    let longueurS1
    let longueurS2
    let matriceDistance
    let i 
    let j 
    let coutSubstitution 
    let minimum

    longueurS1 = chaine1.length  
    longueurS2 = chaine2.length

    if (longueurS1 === 0){
        return longueurS2
    }

    if (longueurS2 === 0){
        return longueurS1
    }

    for (let i = 0; i < longueurS1; i++) {
        matrice[i][0] = i
    }

    for (j = 0; j < longueurS2; i++){
        matrice[0][j] = j
    }

    for (i = 1; i < longueurS1;){
        for (j = 1; j < longueurS2;){
            if (caractere(chaine1, i) === caractere(chaine2,j)){
                coutSubstitution = 0
            }else{
                coutSubstitution = 1
            }

            minimum = matriceDistance[i][j-1]+1
            if (matriceDistance[i][j-1]+1 < minimum){
                minimum = matriceDistance[i][j-1]+1
            }

            if (matriceDistance[i-1][j-1] + coutSubstitution < minimum){
                minimum = matriceDistance[i-1][j-1]+coutSubstitution
            }
            matriceDistance[i][j] = minimum
        }
    }
    return matriceDistance[longueurS1][longueurS2]
}

const rechercherMatchFuzzy = (ssidNormalise, baseSSIDs) =>{
    let i 
    let distance
    let distanceMin 
    let entreeCandidate 
    let ssidBaseNorm 

    i = 0
    distanceMin = distanceMaxFuzzy + 1
    entreeCandidate = null

    while (i < baseSSIDs.length){
        ssidBaseNorm =  normaliserSSID(baseSSIDs[i].ssid)

        distance = calculerDistanceLevenstein(ssidNormalise, ssidBaseNorm)

        if (distance < distanceMin && distance <= distanceMaxFuzzy){
            distanceMin = distance
            entreeCandidate = baseSSIDs[i]
        }
        i++
    }
    return entreeCandidate
}

const determinerBonusConfiance = (typeMatch) =>{
    let bonus

    if (typeMatch === "EXACT"){
        bonus = bonusMatchExact
    }

    if (typeMatch === "FUZZY"){
        bonus = bonusMatchFuzzy
    }

    if (typeMatch === "AUCUN"){
        bonus = 0
    }
    return bonus
}

const verifierSSIDValide = (ssid) =>{
    let valide

    if (ssid === null){
        return false
    }

    if (ssid.length < longueurMinSSID){
        return false
    }

    if (ssid === " " || ssid === "<hidden>"){
        return false
    }
    return true
}

// procédures
const journaliserMatchTrouve = (ssidActuel, entreeCandidate, typeMatch, bonusConfirme) =>{

    console.log("══════════════════════════════════════")
    console.log("AÉROPORT RECONNU")
    console.log("══════════════════════════════════════")
    console.log("SSID détecté   : " + ssidActuel)
    console.log("Aéroport       : " + entreeCandidate.iata)
    console.log("Pays           : " + entreeCandidate.pays)
    console.log("Type match     : " + typeMatch)
    console.log("Bonus confiance : +" + bonusConfiance + " points")
    console.log("══════════════════════════════════════")
}

const journaliserAucunMatch = (ssidActuel) =>{

    console.log("Aucun aéroport reconnu")
    console.log("SSID analysé : " + ssidActuel)
    console.log("Aucun bonus de confiance ajouté")
}

const journaliserSSIDInvalide = (ssidActuel) =>{
    console.log("SSID invalide ou non analysable")
    console.log("SSID reçu : " + ssidActuel)
    console.log("Analyse abandonnée")
}

const miseAJourBaseSSID = () =>{

    telechargerDepuisCDN ({
        url  : "cdn.orange.com/smart-roam/airport-ssids.json",
        dest : "cache_local/airport-ssids.json"
    })
    console.log("Base SSIDs mise à jour depuis CDN Orange")
    console.log("Fréquence : " + FREQUENCE_MAJ)
    console.log("Aéroports couverts : 150+")
}

// traitement principal 
const reconnaissanceSSID = (ssidActuel) => {
  try {

    // ÉTAPE 1 : Charger la base en mémoire
    const baseSSIDs = chargerBaseSSIDs()

    // ÉTAPE 2 : Vérifier que le SSID est valide
    if (!verifierSSIDValide(ssidActuel)) {
      journaliserSSIDInvalide(ssidActuel)
      return {
        matchTrouve    : false,
        codeIATA       : null,
        paysISO        : null,
        bonusConfiance : 0,
        typeMatch      : 'AUCUN'
      }
    }

    // ÉTAPE 3 : Normaliser le SSID
    const ssidNormalise = normaliserSSID(ssidActuel)

    // ÉTAPE 4 : Chercher un match exact
    let entreeCandidate = rechercherMatchExact(
      ssidNormalise,
      baseSSIDs
    )

    if (entreeCandidate !== null) {
      const typeMatch      = 'EXACT'
      const bonusConfiance = determinerBonusConfiance(typeMatch)
      journaliserMatchTrouve(
        ssidActuel,
        entreeCandidate,
        typeMatch,
        bonusConfiance
      )
      return {
        matchTrouve    : true,
        codeIATA       : entreeCandidate.iata,
        paysISO        : entreeCandidate.pays,
        bonusConfiance : bonusConfiance,
        typeMatch      : typeMatch
      }
    }

    // ÉTAPE 5 : Chercher un match fuzzy
    entreeCandidate = rechercherMatchFuzzy(
      ssidNormalise,
      baseSSIDs
    )

    if (entreeCandidate !== null) {
      const typeMatch      = 'FUZZY'
      const bonusConfiance = determinerBonusConfiance(typeMatch)
      journaliserMatchTrouve(
        ssidActuel,
        entreeCandidate,
        typeMatch,
        bonusConfiance
      )
      return {
        matchTrouve    : true,
        codeIATA       : entreeCandidate.iata,
        paysISO        : entreeCandidate.pays,
        bonusConfiance : bonusConfiance,
        typeMatch      : typeMatch
      }
    }

    // ÉTAPE 6 : Aucun match trouvé
    journaliserAucunMatch(ssidActuel)
    return {
      matchTrouve    : false,
      codeIATA       : null,
      paysISO        : null,
      bonusConfiance : 0,
      typeMatch      : 'AUCUN'
    }

  } catch (error) {
    console.error('Erreur reconnaissance SSID :', error)
    return null
  }
}

module.exports = {
  reconnaissanceSSID,
  calculerDistanceLevenshtein,
  normaliserSSID,
  verifierSSIDValide
}