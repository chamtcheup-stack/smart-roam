const supabase = require ('../supabase')

const seuilOccupation = 0.90;
const seuilJours = 7;
const margeSecurite = 1.5;
const quantiteMinimum = 10000;
const periodeAnalyse = 30;

const appelerApiPartenaires = async (endpoint, payload) => {
    return true;
};

const lireTousLesPools = async ()=>{
    let resultat

    try{
        const{data, error} = await supabase
        .from ('did_pool')
        .select('*')
        .eq('status', "ACTIVE")
        

        if (error){
            resultat = [];
        } else {
            resultat = data;
        }
        console.log(resultat);
    } catch (error){
        console.error("Une erreur réseau ou système est survenue : ", error)
        return null;
    }

    if (resultat != null){
        return resultat;
    } else {
        return [];
    }
}

const calculerTauxOccupation =  (allocatedCount, totalNumber) =>{
    let taux;

    taux = allocatedCount/ totalNumber;
    return taux;
}


const calculerTauxCroissance = async (paysIso) =>{
     
    

    try {
        const dateLimite = new Date(Date.now() - periodeAnalyse * 24 * 60 * 60 * 1000).toISOString();

        const {count, error} = await supabase
        .from ('virtual_number')
        .select('*', { count: 'exact', head: true })
        .eq('country_iso', paysISO)
        .eq('created_at', dateLimite)

    } catch (error){
        console.error("Une erreur réseau ou sytème est survenue : ", error)
        return null;
    }

    const totalAttribues = count || 0 ;
    const tauxJournalier = totalAttribues / periodeAnalyse;
    return tauxJournalier;
}


const calculerJourAvantEpuisement = (pool, tauxCroissance) =>{
    

    const numerosRestants = pool.total_numbers - pool.allocated_count;

    if (tauxCroissance === 0){
        return 9999;
    }

    const joursRestants = numerosRestants / tauxCroissance;
    return joursRestants;
}


const calculerQuantiteCommande = (tauxCroissance) =>{
    

    const besoin30Jours = tauxCroissance * periodeAnalyse;
    let quantite = besoin30Jours * margeSecurite;

    if (quantite < quantiteMinimum){
        quantite = quantiteMinimum
    }

    return Math.round(quantite);

}


const chercherMeilleurPartenaire = async (paysISO) =>{
    let resultat;

    try{
        const{data, error} = await supabase
        .from('mvno_partner')
        .select('*')
        .eq('country_iso', paysISO)
        .eq('agreement_status', 'ACTIVE')
        .order('failover_priority' ,{ascending : true})
        .limit(1)
        .maybeSingle();

        if (error) {
            console.error("Erreur partenaire :", error);
            return null;
        }

        return data;

    } catch (error){
        console.error("Une erreur réseau ou système est survenue: ", error)
        return null;
    }

    if (resultat != null){
        return resultat;
    } else {
        return null;
    }
}


const verifierCommandeEnCours = async (poolId) =>{
    let resultat;

    try{
        const{data, error} = await supabase
        .from('did_pool')
        .select('*')
        .eq('pool_id', poolId)
        .eq('reorder_status', 'REORDER_PENDING')
        .maybeSingle();

        if (error) {
            console.error("Erreur vérification commande :", error);
            return false;
        }

        return data !== null;

    } catch (error){
        console.error("Une erreur est survenue :", error)
        return null;
    }

    if (resultat != null){
        return true;
    } else {
        return false;
    }
}


// procédures
const passerCommande = async (pool, partenaire, quantite) =>{

    try{
        await appelerApiPartenaires(
            partenaire.sip_endpoint,
            {
                pays: pool.country_iso,
                quantite: quantite,
                debut: pool.range_end + 1
            }
        );
        console.log(`Commande envoyée à ${partenaire.name}`);
        console.log(`Pays     : ${pool.country_iso}`);
        console.log(`Quantité : ${quantite} numéros`);
    } catch (error){
        console.error("Erreur lors de l'envoi de la commande :", error);
        return null;
    }
}


const marquerCommandeEnCours = async (poolId) => {
    try {
        const { error } = await supabase
            .from('did_pool')
            .update({ reorder_status: 'REORDER_PENDING' })
            .eq('pool_id', poolId);

        if (error) {
            throw error;
        }

        console.log(`Pool ${poolId} marqué REORDER_PENDING`);

    } catch (error) {
        console.error(`Erreur lors de la mise à jour du pool ${poolId} :`, error.message);
    }
};


const notifierEquipeOrange = (pool, partenaire, quantite, tauxOccupation, joursRestants) => {

    console.log("══════════════════════════════════════");
    console.log("ALERTE STOCK — RÉAPPROVISIONNEMENT");
    console.log("══════════════════════════════════════");
    console.log(`Pays          : ${pool.country_iso}`);
    console.log(`Occupation    : ${tauxOccupation * 100}%`);
    console.log(`Jours restants: ${joursRestants}`);
    console.log(`Partenaire    : ${partenaire.name}`);
    console.log(`Quantité      : ${quantite} numéros`);
    console.log("Statut        : REORDER_PENDING");
    console.log("══════════════════════════════════════");
};


const signalerAucunPartenaire = (paysISO) =>{

    console.log("Erreur critique : aucun partenaire MVNO");
    console.log("Disponible pour le pays :" + paysISO);
    console.log("Intervention manuelle requise");
};


const signalerCommandeDejaEnCours = (poolId, paysISO) =>{
    console.log("Commande en cours pour le pool " + poolId)
    console.log("pays :" + paysISO)
    console.log("Aucune action supplémentaire nécessaire")
};


// traitement principal
const JITStockManager = async () =>{
    
    
    const tousLesPools = await lireTousLesPools()
    if (tousLesPools === null){
        console.log("Aucun pool actif trouvé")
        return null;
    }

    for (let i = 0; i < tousLesPools.length; i++){
        const pool = tousLesPools[i];

        const tauxOccupation = calculerTauxOccupation(pool.allocated_count, pool.toatal_numbers)

        const tauxCroissance = await calculerTauxCroissance (pool.country_iso)
        const jourAvantEpuisement = calculerJourAvantEpuisement (pool, tauxCroissance)

        if ((tauxOcupation >= seuilOccupation) || (joursAvantEpuisement <= seuilOccupation)){
            if (verifierCommandeEnCours(pool.pool_id) === true){
                signalerCommandeDejaEnCours(pool.pool_id, pool.country_iso);

                continue;
            }
        

            const partenaire = await chercherMeilleurPartenaire(pool.country_iso)

            if (partenaire === null){
                signalerAucunPartenaire(pool.country_iso)
                continue;
            }

            const quantiteCommande = calculerQuantiteCommande (tauxCroissance)

            await marquerCommandeEnCours (pool.pool_id)
            await passerCommande(
                pool,
                partenaire,
                quantiteCommande,
                
            )

            notifierEquipeOrange(
                pool,
                partenaire,
                quantiteCommande,
                tauxOccupation,
                jourAvantEpuisement
            )

        } else {
            console.log("pool" + pool.country_iso + "OK - occupation : " + tauxOccupation * 100 + "%")
        }
    }
    console.log("Analyse JIT Stock Manager terminée")
    return null;
};