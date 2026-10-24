const supabase = require ('../supabase')

const attendre = (secondes) => new Promise((resolve) => setTimeout(resolve, secondes * 1000));

const poidsMCCMNC = 0.40;
const poidsCellID = 0.30;
const poidsIP = 0.20;
const poidsWifi = 0.10;
const seuilActivation = 70;
const seuilAttente = 50;
const dureeAttente = 5;

const lireDestinationDeclaree = async (userId) =>{
    let resultat;

    try{
        const {data, error} = await supabase
        .from ('trip_declaration')
        .select('destination_country')
        .eq('user_id', userId)
        .eq('status', "PENDING")
        .limit(1)
        .maybeSingle()

        if (error){
            resultat = null;
        } else {
            resultat = data;
        }
        console.log(resultat);

    }catch (error){
        console.error('Une erreur est survenue:', error)
        return null;
    }

    if (resultat != null){
        return resultat.destination_country;
    } else {
        return null;
    }
};


const lirePaysOrigine = async (userId) =>{
    let resultat;

    try{
        const {data, error} =await supabase
        .from('users')
        .select('country_of_residence')
        .eq('user_id', userId)
        .single()

        if (error){
            resultat = null;
        } else {
            resultat = data;
        }
        console.log(resultat);

    } catch (error){
        console.error("Une erreur réseau ou système est survenue:",error)
        return null;
    }

    if (resultat != null){
        return resultat.country_of_residence;
    } else {
        return null;
    }
};


const calculerScoreCellID =  (signalCellID, paysDestination) =>{
    let score;

    if (signalCellID === null){
        return 0;
    }
    score = poidsCellID * 100;
    return score;
};


const calculerScoreMCCMNC = (signalMCCMNC, paysDestinatio) =>{
    let score;

    if (signatMCCMNC === null){
        return 0;
    }

    if (signalMCCMNC.confiance === 100) {
        score = poidsMCCMNC * 100;
    }

    if (signalMCCMNC.confiance === 80){
        score = poidsMCCMNC * 80;
    }
    return score;
};


const calculerScoreWifi = (signalWifi, paysDestination) =>{
    let score;

    if (signalWifi === null){
        return 0;
    }
    
    if (signalWifi.aeroports === true){
        score = poidsWifi * 100;
    } else {
        score = 0;
    }
    return score;
};


const calculerScoreIP = (signalIP, paysDestination) =>{
    let score

    if (signalIP === null){
        return 0;
    }

    if (signalIP === paysDestination){
        score = poidsIP * 100;
    } else {
        score = 0;
    }
    return score;
};


const fusionnerScores = (scoreCellID, scoreMCCMNC, scoreWifi, scoreIP) =>{
    let scoreFinal

    scoreFinal = scoreCellID + scoreMCCMNC + scoreWifi + scoreIP;

    if (scoreFinal > 100){
        scoreFinal = 100
    }
    return scoreFinal;
};


const determinerPaysDetecte = (signalMCCMNC, signalWifi, signalIP) =>{


    if (signalMCCMNC != null){
        return signalMCCMNC.paysISO
    }

    if ((signalWifi != null) && (signalWifi.aeroports === true)){
        return signalWifi.paysISO;
    }

    if (signalIP != null){
        return signalIP;
    }

    return null;
};

// procédures
const activerNumeroVirtuel = async (userId, paysDestination) =>{

    try{
        const {data, error} = await supabase
    
        .from('trip_declaration')
        .update({
            status: "CONFIRMED",
            arrival_confirmed_at: new Date().toISIString(),
        })
        .eq('user_id', userId)
        .eq('destination_country', paysDestination)
        .eq('status', "PENDING")

        if (tripError) throw tripError;
        const {data, error} = await supabase
        .from('virtual_number')
        .update({
            status: "Active",
            activated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('country_iso', paysDestination)
        .eq('status', 'AWAITING_ARRIVAL')
        if (numberError) throw numberError;
        return {success : true}
    } catch (error){
        console.error('Une erreur réseau ou système est survenue:', error)
        return null;
    }

    console.log("Numéro activé pour" + userId + "dans" + paysDestination);
};


const activerModeParking = async (userId, paysOrigine) =>{

    try{
        const{data, error} = await supabase
        .from('virtual_number')
        .update({
            statut: "PARKED",
            suspended_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('country_iso' != paysOrigine)
        .eq('status', "ACTIVE")

        if (tripError) throw tripError;
        const {data, error} = await supabase
        .from('trip_declaration')
        .update({
            status: "COMPLETED",
            return_confirmed_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('status', "CONFIRMED")
        if (numberError) throw numberError;
        console.log("Mode Parking activé pour " + userId);
        return {success : true}
    } catch (error){
        console.error('Une erreur réseau ou système est survenue:', error)
        return null;
    }
};


const attendreSignalSupplementaire = async (userId, duree) =>{

    console.log("Score insuffisant-attente de" + duree + "secondes");
    await attendre(duree)
    console.log("Reprise de l'analyse des signaux");
};


const ignorerSignal = (paysDetecte, raison) =>{

    console.log("Signal ignoré-pays détecté :" + paysDetecte + "Raison" + raison)
};

// traitement principal
const fusionMultiSignaux = (userId, cellID, signalMCCMNC, signalWifi, signalIP) =>{
    let paysDestination;
    let paysOrigine;
    let scoreCellID;
    let scoreMCCMNC;
    let scoreWifi;
    let scoreIP;
    let scoreConfiance;
    let paysDetecte;
    let decision;

    paysDestination = await lireDestinationDeclaree(userId)
    paysOrigine = await lirePaysOrigine(userId)
    if (paysDestination ===null){
        console.log("Aucune déclaration de voyage active")
        console.log("Géofencing en mode surveillance uniquement")
        return null;
    }

    scoreCellID = calculerScoreCellID(signalCellID, paysDestination)
    scoreMCCMNC = calculerScoreMCCMNC(signalMCCMNC, paysDestination)
    scoreWifi = calculerScoreWifi(signalWifi, paysDestination);
    scoreIP = calculerScoreIP(signalIP, paysDestination)
    scoreConfiance = fusionnerScore(signalCellID, signalMCCMNC, signalWifi, signalIP)
    paysDetecte = determinerPaysDetecter(signalMCCMNC, signalWifi, signalIP)

    if ((paysDetecte === paysDestination) && (scoreConfiance >= seuilActivation)){
        decision = "ARRIVEE_CONFIRMEE"
        await activerNumeroVirtuel(userId, paysDestination)
        return decision;
    }

    if ((paysDetecte === paysOrigine) && (scoreConfiance >= seuilActivation)){
        decision = "RETOUR_DETECTEE"
        await activerModeParking(userId, paysOrigine)
        return decision
    }

    if ((scoreConfiance >= seuilAttente) && (scoreConfiance < seuilActivation)){
        await attendreSignalSupplementaire(userId, dureeAttente)
        return null;
    }

    if ((paysDetecte != paysDestination) && (paysDetecte != paysOrigine)){
        ignorerSignal(paysDetecte)
        console.log("pays non pertinent, probablement une escale")
        return null;
    }

    if (scoreConfiance < seuilAttente){
        ignorerSignal(paysDetecte)
        console.log("Score trop faible" + scoreConfiance + "/100")
        return null;
    }
};

const supabase = require ('../supabase')

const attendre = (secondes) => new Promise((resolve) => setTimeout(resolve, secondes * 1000))

const lireCellIDActuel = () =>{
    let cellID

    cellID = lireAntenneRelaisActive();

    if (cellID != null){
        return cellID;
    } else {
        return null;
    }
};


const lireCellIDPrecedent = async (userId) =>{
    let resultat

    try{
        const {data, error} = await supabase
        .from ('cache_local')
        .select('*')
        .eq('user_id', userId)
        .eq('cle', "LAST_CELL_ID")
        .single()

        if(error){
            resultat = null;
        } else {
            resultat = data;
        }
        console.log(resultat);
    } catch (error){
        console.error('Une erreur est survenue :', error)
        return null;
    }
    if (resultat != null){
        return resultat.valeur;
    } else {
        return null;
    }
};


const comparerCellID = (cellIDActuel, cellIDPrecedent) =>{
    let changement;

    if (cellIDActuel != cellIDPrecedent){
        changement = true;
    } else {
        changement = false;
    }
    return changement;
};


const attendreConfirmation = async (cellIDActuel,dureeAttente) =>{
    let cellIDVerification;
    let confirme;

    await attendre (dureeAttente);
    cellIDVerification = lireCellIDActuel();
    if (cellIDVerification === cellIDActuel){
        confirme = true;
    } else {
        confirme = false;
    }
    return confirme;
};

// procédure
const mettreAJourCacheLocal = async (userId, cellIDActuel) =>{
    
    try {
        const {data, error} = await supabase
        .from('cache_local')
        .update({
            valeur : cellIDActuel,
            updated_at : new Date()
        })
        .eq('user_id', userId)
        .eq('cle', "LAST_CELL_ID")
    } catch (error){
        console.log('Une erreur est survenue:', error)
        return null;
    }
};


const emettreEvenement = (userId, cellIDActuel, timestamp) =>{

    busEvenements.publier("CELL_ID_CHANGED", {
    user_id: userId,
    cell_id: cellIDActuel,
    timestamp: timestamp,
    source: "CELL_ID"
    });
    console.log('Evènement emis : CELL_ID_CHANGED pour' + userId);
};


const signalerFauxPositif = (cellIDActuel) =>{

    console.log("Faux positif ignoré : cell-ID" + cellIDActuel + "instable");
};

// traitement principal
const DetecterChangementcellID = async (userId) =>{
    let cellIDActuel
    let cellIDPrecedent
    let changementDetecte
    let timestamp

    cellID = lireCellIDActuel();

    if (cellIDActuel === null){
        console.log("Impossible de lire le cellID")
        return null;
    }

    cellIDPrecedent = await lireCellIDPrecedent(userId)

    if (cellIDPrecedent === null){
        await mettreAJourCacheLocal(userId, cellIDActuel)
        console.log("Premier cell-ID enregistré :" + cellIDActuel)
        return null;
    }

    changementDetecte = comparerCellIDs(cellIDActuel, cellIDPrecedent)
    if (changementDetecte === false){
        return null;
    }

    changementDetecte = await attendreConfirmation(cellIDActuel,2)
    if(changementDetecte === false){
        signalerFauxPositif(cellIDActuel)
        return null;
    }

    timestamp = new Date()
    await mettreAJourCacheLocal(userId,cellIDActuel)
    emettreEvenement(userId, cellIDActuel, timestamp);

    return {
        cellID: cellIDActuel,
        timestamp: timestamp,
        action: "CELL_ID_CHANGED"
    }
};

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

const supabase = require ('../supabase')

let mccMnc = [

    { cle: "62402", pays: "CM", operateur: "Orange CM"  },
    { cle: "62401", pays: "CM", operateur: "MTN CM"     },
    { cle: "20801", pays: "FR", operateur: "Orange FR"  },
    { cle: "20810", pays: "FR", operateur: "SFR"        },
    { cle: "20621", pays: "BE", operateur: "Orange BE"  },
    { cle: "60801", pays: "EG", operateur: "Orange EG"  },
   
]


const construireCleRecherche = (mcc, mnc) =>{

    let cle;

    cle = mcc + mnc;
    return cle;
};


const rechercherDansTable = async (cleRecherche) =>{
    let resultat;

    try{
        const{data, error} = await supabase
        .from('mccMncTable')
        .select('*')
        .eq('cle', cleRecherche)
        .single()

        if (error){
            resultat = null;
        } else {
            resultat = data;
        }
        console.log(resultat);


    } catch (error){
        console.error('Une erreur est survenue:', error)
        return null;
    }

    if (resultat != null){
        return resultat;
    } else {
        return null;
    }
};


const rechercherParMccSeul = async (mcc) =>{
    let resultat;

    try {
        const{data, error} = await supabase
        .from ('mccMncTable')
        .select('*')
        .like('cle', `${mcc}%`)
        .limit(1)
        .maybeSingle();


        if (error){
            resultat = null;
        } else {
            resultat = data;
        }
        console.log(resultat);
    } catch (error){
        console.error('Une erreur est survenue:', error)
        return null;
    }

    if (resultat != null){
        return resultat;
    } else {
        return null;
    }
};


const calculerConfiance = (mccConnu, mncConnu) =>{
    let confiance;

    if ((mccConnu === true) && (mncConnu === true)){
        confiance = 100;
    }

    if ((mccConnu === true) && (mncConnu === false)){
        confiance = 80;
    }

     if (mccConnu === false){
        confiance = 0;
    }

    return confiance;
}

// procédure
const retounerResultat = (paysISO, nomOperateur, confiance) =>{

    console.log("Pays détecté : " + paysISO);
    console.log("Oprétateur :" + nomOperateur);
    console.log("Confiance :" + "/100");
};


const signalerSignalInvalide = (mcc, mnc)=>{
     
    console.log("Signal invalide : MCC =" + mcc + "MNC =" + mnc + "inconnus")
};

// traitement principal
const decoderMCCMNC = async (mcc, mnc)=>{
    let cleRecherche
    let resultat
    let paysISO
    let nomOperateur
    let confiance

    cleRcherche = construireCleRecherche(mcc, mnc)
    resultat = await rechercherDansTable(cleRecherche)
    if (resultat != null){
        paysISO      = resultat.pays
        nomOperateur = resultat.operateur
        confiance    = calculerConfiance(true, true)

        return resultat(paysISO, nomOperateur, confiance)
        return {
        paysISO      : paysISO,
        nomOperateur : nomOperateur,
        confiance    : confiance
        }
   
    }

    resultat = await rechercherParMccSeul(mcc)
    if (resultat !=  null){
        paysISO      = resultat.pays
        nomOperateur = "Opérateur inconnu"
        confiance    = calculerConfiance(true, false )

        return resultat(paysISO, nomOperateur, confiance)
        return{
            paysISO      : paysISO,
            nomOperateur : nomOperateur,
            confiance    : confiance
        }

    }
   
    signalerSignalInvalide(mcc, mnc)
    return null;

}