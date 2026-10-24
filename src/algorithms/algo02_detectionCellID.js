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