const supabase = require ('../supabase')

const seuilSuggestion = 0.60
const moisHistorique = 24
const minimumVoyage = 3
const poidsFrequence = 0.50
const poidsSaison = 0.30
const poidsJousSemaine = 0.20

const extraireMois = (dateString) => {
    const date = new Date(dateString);
    return date.getMonth() + 1; // 1 (Janvier) à 12 (Décembre)
};

const extraireJourSemaine = (dateString) => {
    const date = new Date(dateString);
    const day = date.getDay();
    return day === 0 ? 7 : day; // 1 (Lundi) à 7 (Dimanche)
};

const recupererHistoriqueVoyage = async (userId, nbMois) =>{
    let resultat = []

    try {
        const dateLimite = new Date();
        dateLimite.setMonth(dateLimite.getMonth() - nbMois);

        const{data, error} = await supabase
        .from('travel_history')
        .select('*')
        .eq('user_id', userId)
        .gte('arrival_detected_at' >= dateLimite.toISOString() )
        .order('arrivaldetected_at', {descending: true})

        if (error){
            resultat = null
        } else {
            resultat  = data
        }
        console.log(resultat)
    } catch (error){
        console.error("Une erreur est survenue lors de la récupération de l'historique:", error)
        return []
    }

    if (resultat != null){
        return resultat
    } else {
        return []
    }
}

const compterVoyageParDestination = (historiqueVoyages, paysISO) =>{
    let compteur
    let i 

    i = 0
    compteur = 0
    while (i < historiqueVoyages.length){
        if (historiqueVoyages[i].country_iso === paysISO){
            compteur = compteur + 1
        }
        i = i + 1
    }
    return compteur
}

const calculerScoreFrequence = (nbVoyagePays, nbVoyagesTotal) =>{
     

    if (nbVoyagesTotal === 0){
        return 0
    }
    const score = nbVoyagesPays / nbVoyagesTotal
    return score 

}

const calculerScoreSaison = (historiqueVoyages, paysISO, moisActuel) =>{
    let nbVoyagesMoisSimilaires
    let nbVoyagesPays
    let i 

    nbVoyagesMoisSimilaires = 0
    nbVoyagesPays  = 0
    i = 0

    while (i < historiqueVoyages.length){
        if (historiqueVoyages[i].country_iso === pays_iso){
            nbVoyagesPays = nbVoyagesPays + 1
            const moisVoyage = extraireMois(histooriqueVoyages[i].arrival_detected_at)

            if (Math.abs(moisVoyage - moisActuel) <= 1){
            nbVoyagesMoisSimilaires = nbVoyagesMoisSimilaires + 1
            }
        }
        i++
    }

    if (nbVoyagesPays === 0){
        return 0
    }

    const score = nbVoyagesMoisSimilaires/ nbVoyagesPays
    return score;
}

const calculerScoreJourSemaine = (historiqueVoyages, paysISO, jourSemaine) =>{
    let nbVoyagesJourSimilaire
    let nbVoyagesPays
    let i 

    nbVoyagesJourSimilaire = 0
    nbVoyagesPays = 0
    i = 0
    while (i < historiqueVoyages.length){
        if (historiqueVoyages[i].country_iso === paysISO){
            nbVoyagespays++
            const jourVoyage = extraireJourSemaine(historiqueVoyages[i].arrival_detected_at)

            if (jourVoyage === jourSemaine){
            nbVoyagesJourSimilaire++
            }
        }
        i++
    }

    if (nbVoyagesPays ===0){
        return 0
    }

    const score = nbVoyagesJourSimilaire/nbVoyagesPays
    return score 
}

const calculerProbabiliteFinale =(scoreFrequence, scoreSaison, scoreJourSemaine) =>{
    let probabilite 

    probabilite = (scoreFrequence * poidsFrequence) + (scoreSaison * poidsSaison) + (scoreJourSemaine * poidsJousSemaine)
    if (probabilite > 1){
        probabilite = 1
    }
    return probabilite
}

const extraireDestinationUniques = (historiqueVoyages) =>{
    let destinations = []
    let dejaTrouve = false
    let i = 0
    let j 
    
    
    while (i < historiqueVoyages.length) {
        const paysISO = historiqueVoyages[i].country_iso;
        let dejaTrouve = false;
        let j = 0;

        while (j < destinations.length) {
            if (destinations[j] === paysISO) {
                dejaTrouve = true;
            }
            j = j + 1;
        }

        if (dejaTrouve === false) {
            destinations.push(paysISO);
        }

        i = i + 1;
    }

    return destinations 
}

const trouverMeilleureDestination = (destinationsScorees) =>{
    let meilleure 
    let probabiliteMax 
    let i 

    if (destinationsScorees.length === 0){
        return null
    }

    meilleure = destinationsScorees[0]
    probabiliteMax = destinationsScorees[0].probabilite
    i = 1

    while (i < destinationsScorees.length){
        if (destinationsScorees[i].probabilite > probabiliteMax){
            meilleure = destinationsScorees[i]
            probabiliteMax = destinationsScorees[i].probabilite
        }
        i++
    }
    return meilleure
}

// procédures
const afficherSuggestion = (paysISO, probabilite) =>{

    console.log("══════════════════════════════════════")
    console.log("SUGGESTION SMART ROAM")
    console.log("══════════════════════════════════════")
    console.log("Vous allez souvent en " + paysISO +" à cette période.")
    console.log("Est-ce votre destination ?")
    console.log("[OUI — Préparer mon voyage]")
    console.log("[NON — Choisir une autre destination]")
    console.log("Probabilité calculée : " + probabilite * 100 + "%")
    console.log("══════════════════════════════════════")

}

const afficherEcranSelection =() =>{

    console.log( "Où souhaitez-vous aller ?")
    console.log("Sélectionnez votre destination dans la liste")
}

const enregistrerSuggestionRefusee = async (userId, paysISO) =>{

    try {
        const {data, error} = await supabase
        .from('audit_log')
        .insert([
            {
                user_id: userId,
                entity_type: "PREDICTION",
                action: "SUGGESTION REFUSEE" + paysISO,
                actor_type: "SYSTEM",
                created_at: new Date().toISOString(), 
            }
        ])
        console.log("Suggestion refusée enregistrée")
        console.log("Pays suggéré : " + paysISO)
        console.log("Modèle mis à jour pour les prochaines prédictions")
    } catch (error){
        console.error("Une erreur est survenue :", error)
        return null;
    }
}

const signalerHistoriqueInsuffisant = (userId, nombreVoyages) =>{

    console.log("Historique insuffisant pour " + userId)
    console.log("Voyages trouvés  : " + nombreVoyages)
    console.log("Minimum requis   : " + MINIMUM_VOYAGES)
    console.log( "Écran de sélection manuelle affiché")
}


// traitement principal
const predictionPreAtterissage = async (userId, paysOrigine, lireReponseUtilisateur) =>{

    const historiqueVoyages = recupererHistoriqueVoyage(userId, moisHistorique)
    const nombreVoyages = historiqueVoyages.length

    if (nombreVoyages < minimumVoyage){
        signalerHistoriqueInsuffisant(userId, nombreVoyages)
        afficherEcranSelection()
        return null
    }

    const moisActuel = extraireMois(new Date())
    const jourSemaine = extraireJourSemaine(new Date())
    const destinationUniques = extraireDestinationUniques(historiqueVoyages)
    const destinationsScorees = []
    let i = 0

    while (i < destinationUniques.length){
        const paysISO = destinationUniques[i]

        if (paysISO != paysOrigine){
            const nbVoyagesPays = compterVoyageParDestination(historiqueVoyages, paysISO)

            const scoreFrequence = calculerScoreFrequence(nbVoyagePays, nombreVoyages)

            const scoreSaison = calculerScoreSaison(historiqueVoyages, paysISO, moisActuel)

            const scoreJourSemaine = calculerScoreJourSemaine(historiqueVoyages, paysISO, jourSemaine)

            const probabilite = calculerProbabiliteFinale(scoreFrequence, scoreSaison, scoreJourSemaine)

            destinationsScorees.push({
                pays: paysISO,
                probabilite: probabilite
            });
        }
        i++
    }
    const meilleureDestination = trouverMeilleureDestination(destinationScorees)

    if (meilleureDestination === null){
        afficherEcranSelection()
        return null
    }

    if ( meilleureDestination.probabilite >= seuilSuggestion){
        afficherSuggestion(meilleureDestination.pays, meilleureDestination.probabilite)
        
        const suggestionAcceptee = await lireReponseUtilisateur()

        if (suggestionAcceptee === true){
            return meilleureDestination.pays
        } else {
            await enregistrerSuggestionRefusee(userId, meilleureDestination.pays)
            afficherEcranSelection()
            return null
        }
    } else {
        afficherEcranSelection()
        return null
    }
}