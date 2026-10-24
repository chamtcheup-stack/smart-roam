const supabase = require ('../supabase')

const poidsMCCMNC = 0.40
const poidsCellId = 0.30
const poidIp = 0.20
const poidsWifi = 0.10
const seuilHaute = 70
const seuilMoyenne = 50
const dureeAttenteMax = 5
const intervalleAttente = 1

const arrondir = (valeur) => Math.round(valeur);

const attendre = (secondes) => new Promise((resolve) => setTimeout(resolve, secondes * 1000));

// Simule la lecture d'un signal réseau entrant (à adapter selon ton implémentation réelle)
const lireSignalDisponible = () => {
    return null;
};

const calculerContributionCellID = (signalCellID, paysDestintion) =>{
    let contribution

    if (signalCellID === null){
        return 0
    }

    if (signalCellID.changement_detecte === false){
        return 0
    }
    contribution = poidsCellId * 100
    return contribution
}

const calculerContributionMCCMNC = (signalMCCMNC, paysDestination) =>{
    let contribution

    if (signalMCCMNC === null){
        return 0
    }

    if (signalMCCMNC.confiance === 100){
        contribution = poidsMCCMNC * 100
    }

    if (signalMCCMNC.confiance === 80){
        contribution = poidsMCCMNC * 80
    }

    if (signalMCCMNC.confiance === 0){
        contribution = 0
    }
    return contribution 
}

const calculerContributionWifi = (signalWifi, paysDestination) =>{
    let contribution

    if (signalWifi === null){
        return 0
    }

    if (signalWifi.aeroport_reconnu === true && signalWifi.pays_iso === paysDestination){
        contribution = poidsWifi * 100
    } else {
        contribution = 0
    }
    return contribution
}

const calculerContributionIP = (signalIP, paysDestination) =>{
    let conntribution

    if (signalIP === null){
        return 0
    }

    if (signalIP.pays_iso === paysDestination){
        contribution = poidsIP * 100
    } else {
        contribution = 0
    }
    return contribution
}

const fusionnerScoresBayesien = (scoreCellID, scoreMCCMNC, scoreWifi, scoreIP) =>{
    let scoreTotal
    let scoreFinalEntier

    scoreTotal = scoreCellID + scoreMCCMNC + scoreWifi + scoreIP
    if (scoreToatal > 100){
        scoreTotal = 100
    }

    scoreFinalEntier = arrondir(scoreTotal)
    return scoreFinalEntier
}

const determinerNiveauCertitude = (scoreFinal) =>{
    let niveau 

    if (scoreFinal >= seuilHaute){
        niveau = "HAUTE"
    }

    if (scoreFinal >= seuilMoyenne && scoreFinal < seuilHaute){
        niveau = "MOYENNE"
    }

    if (scoreFinal < seuilMoyenne){
        niveau = "FAIBLE"
    }
    return niveau
}

const determinerPaysCandidat = (signalMCCMNC, signalWifi, signalIP) =>{
    let pays

    if (signalMCCMNC != null && signalMCCMNC.confiance >= 80){
        return signalMCCMNC.paysISO
    }

    if (signalWifi != null && signalWifi.aeroport_reconnu === true){
        return signalWifi.paysISO
    }

    if (signalIP != null){
        return signalIP.paysISO
    }
    return null;
}

const attendreSignalSupplementaire = async (dureeMax) =>{
    let secondesEcoulees
    let nouveauSignal

    secondesEcoulees = 0
    nouveauSignal = null

    while (secondesEcoulees < dureeMax && nouveauSignal === null){
        await intervalleAttente  
        nouveauSignal = lireSignalDisponible()
        secondesEcoulees = secondesEcoulees + intervalleAttente
    }
    return nouveauSignal
}

// procédures
const journaliserScore = async(userId, scoreFinal, niveauCeritude, paysCandidat, paysDestination) =>{

    try{
        const{data, error} = await supabase
        .from('audit_log')
        .insert([
            {
                user_id: userId,
                entity_type: "GEOLOCALISATION",
                action: `SCORE_${scoreFinal}_PAYS_${paysCandidat}_DEST_${paysDestination}`,
                created_at: new Date().toISOString()
            }
        ])
    } catch (error){
        console.error("Une erreur est survenue:", error)
        return null
    }
    console.log("Score calculé  : " + scoreFinal + "/100")
    console.log("Certitude      : " + niveauCertitude)
    console.log("Pays candidat  : " + paysCandidat)
    console.log("Pays destination : " + paysDestination)
}

const journaliserEvenementManque = async (userId, scoreFinal, paysDestination) =>{

    try{
        const {data, error} = await supabase
        .from('audit_log')
        .insert([
            {
                user_id: userId,
                entity_type: "GEOLOCALISATION",
                action: "ACTIVATION_MANQUEE_SCORE" + scoreFinal,
                actor_type: "SYSTEM",
                created_at: new Date().toISOString(),
            }
        ])
    } catch (error){
        console.error("Une erreur est survenue:", error)
        return null
    }
    console.log("Activation manquée — Score insuffisant")
    console.log("Score obtenu   : " + scoreFinal + "/100")
    console.log("Score minimum  : " + SEUIL_HAUTE + "/100")
    console.log("Score minimum  : " + SEUIL_HAUTE + "/100")
}

const signalerScoreFaible = (scoreFinal, paysDestination) =>{

    console.log("Score de confiance insuffisant : " + scoreFinal + "/100")
    console.log( "Minimum requis : " + SEUIL_MOYENNE + "/100")
    console.log("Pays visé      : " + paysDestination)
    console.log("Activation non déclenchée")
}

const signalAttente = (scoreFinal, dureeAttente) =>{

    console.log("Score intermédiaire : " + scoreFinal + "/100")
    console.log("En attente d'un signal supplémentaire")
    console.log("Durée maximum      : " + dureeAttente + " secondes")
}

// traitement principal
const scoringConfianceGeographique = () =>{


    let scoreCellID = calculerContributionCellID(signalCellID, paysDestination)
    let scoreMCCMNC = calculerContributionMCCMNC(signalMCCMNC, paysDestination)
    let scoreWifi = calculerContributionWifi(signalWifi, paysDestintion)
    let scoreIP = calculerContributionIP(signalIP, paysDestination)
    let scoreFinal = fusionnerScoresBayesien(scoreCellID, scoreMCCMNC, scoreWifi, scoreIP)
    let niveauCertitude = determinerNiveauCertitude(scoreFinal)
    let paysCandidat = determinerPaysCandidat(signalMCCMNC, signalWifi, signalIP)
    await journaliserScore (userId, scoreFinal,niveauCertitude, paysCandidat, paysDestination)
    let decision = "";

    if (niveauCertitude === "HAUTE"){
        const decision = "ACTIVATION_IMMEDIATE"
        return {
            decision        : decision,
            scoreFinal      : scoreFinal,
            niveauCertitude : niveauCertitude,
            paysCandidat    : paysCandidat
        }
    }

    if (niveauCertitude === "MOYENNE"){
        signalerAttente (scoreFinal, dureeAttenteMax)
        const signalSupp = attendreSignalSupplementaire(dureeAttenteMax)

        if (signalSupp != null){

            if (signalSupp.type === "MMCC_MNC"){
                signalMCCMNC = signalSupp
            }

            if (signalSupp.type = "CellID"){
                signalCellID = signalSupp
            }

            if (signalSupp.type === "WIFI"){
                signalWifi = signalSupp
            }

            if (signalSupp.type === "IP"){
                signalIP = signalSupp
            }
            scoreCellID = calculerContributionCellID(signalCellID, paysDestination)
            scoreMCCMNC = calculerContributionMCCMNC(signalMCCMNC, paysDestination)
            scoreWifi = calculerContributionWifi(signalWifi, paysDestination)
            scoreIP = calculerContributionIP(signalIP, paysDestination)
            scoreFinal = fusionnerScoresBayesien(scoreCellID, scoreMCCMNC, scoreWifi, scoreIP)
            niveauCertitude = determinerNiveauCertitude(scoreFinal)
            paysCandidat    = determinerPaysCandidat(signalMCCMNC, signalWifi, signalIP);

            if (niveauCertitude === "HAUTE"){
                decision = "ACTIVATION_APRES_ATTENTE"
                return {
                    decision        : decision,
                    scoreFinal      : scoreFinal,
                    niveauCertitude : niveauCertitude,
                    paysCandidat    : paysCandidat
                }
            }
        }
    }

    await journaliserEvenementManque(userId, scoreFinal, paysDestination)
    decision = "ACTIVATION_ECHOUEE"
    return {
        decision        : decision,
        scoreFinal      : scoreFinal,
        niveauCertitude : niveauCertitude,
        paysCandidat    : paysCandidat
    }

    if (niveauCertitude === "FAIBLE"){
        signalerScoreFaible(scoreFinal, paysDestination)
        await journaliserEvenementManque(userId, scoreFinal, paysDestination)
        decision = "ACTIVATION_IMPOSSIBLE"
        return {
            decision        : decision,
            scoreFinal      : scoreFinal,
            niveauCertitude : niveauCertitude,
            paysCandidat    : paysCandidat
        }
    }
}

module.exports = {
    scoringConfianceGeographique
};