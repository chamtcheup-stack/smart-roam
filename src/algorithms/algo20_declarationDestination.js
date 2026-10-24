const supabase = require ('../supabase')

const verifierPaysSupporte = async (paysISO) =>{
    let resultat

    try{
        const{data,error} = await supabase
        .from ('country')
        .select('*')
        .eq('country_iso', paysISO)
        .eq('did_enabled', true)
        .single()

        if (error){
            resultat = null
        }else{
            resultat = data
        }

        console.log(resultat);
    } catch(error){
        console.error('Une erreur est survenue:', error)
        return null
    }
    if (resultat != null){
        return resultat;
    } else {
        return null;
    }
};


const verifierDeclarationExistante = async (userId, paysISO) =>{
    let resultat;

    try{
        const{data,error} = await supabase
        .from('trip_declaration')
        .select('*')
        .eq('user_id', userId)
        .eq('destination_country', paysISO)
        .eq('statut', PENDING)
        .single()

        if (error){
            resultat = null
        } else {
            resultat = data
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
// procédures

const enregistrerDeclaration = async (userId, paysISO, dateDepart, dateRetour, numberId) =>{
    let nouvelleEntree
     try {
        const {data, error} = await supabase
        .from('trip_declaration')
        .insert([
            {
               user_id: userId,
               destination_country: paysISO,
               departure_date: dateDepart,
               return_date: dateRetour,
               status: "PENDING",
               number_id: numberId,
               vault_prepared: false,
               declaration_time: NOW() 
            }
        ])
        .select()
        .single();

        if (error){
            console.error('Une erreur est survenue:', error)
            return null;
        }

        const nouvelleEntree = data
        console.log("Votre déclaration a été enregistré avec succès !:", nouvelleEntree)
        return nouvelleEntree;

     } catch (error){
        console.error('Une erreur est survenue:', error)
        return null;
     }
};


const enregistrerHistorique = async (userId, paysISO) =>{

    try{
        const{data,error} = await supabase
        .from ('travel_history')
        .insert([
            {
                user_id: userId,
                country_iso: paysISO,
                declared_destination: paysISO,
                declaration_time: NOW(),
                detection_method: "MANUAL",

            }
        ])
        .select()
        .single();
    } catch (error){
        console.error('Une erreur est survenue:', error)
        return null;
    }
}


const notifierUtilisateur = (numeroVirtuel) =>{

    console.log("Votre numéro" + numeroVirtuel.did_number + "est prêt pour" + pays.name_fr + "il s'activera à votre arrivée.");
};

// Traitement final
const declarerDestination = (userId, paysISO)=>{

    pays = verifierPaysSupporte(paysISO)
    if (pays = null){
        console.log("Ce pays n'est pas encore disponible sur smart roam")
        return null;
    }

    declarationExistante = verifierDeclarationExistante(userId, paysISO)
    if (declarationExistante != null){
        console.log("Vous avez déjà une déclaration active pour ce pays")
        return declarationExistante;
    }

    numeroVirtuel = attribuerNumeroDID(userId, paysISO)
    if (numeroVirtuel = null){
        console.log("Aucun numéro disponible pour ce pays pour le moment")
        return null;
    }

    enregistrerDeclaration(userId, paysISO, dateDepart, dateRetour, numeroVirtuel.number_id);

    eneregistrerHistorique(userId, paysISO);

    notifierUtilisateur(numeroVirtuel, pays);
}