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