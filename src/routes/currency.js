const supabase = require ('../supabase')

const tauxCommission = 0.015
const TTLCache = 60
const seuilFluctuation = 0.03
const montantMinXAF = 500
const montantMaxXAF = 10000000

const appelerAPI_BCE = async (source, cible) => null;
const appelerAPI_BEAC = async (source, cible) => null;
const appelerAPI_XE = async (source, cible) => null;
const lireReponseUtilisateur = () => true;

const verifierCorridor = async (deviseSource, deviseCible) =>{
    let resultat

    try{
        const{data, error} =await supabase
        .from('current_exchange_corridor')
        .select('*')
        .eq('source_currency', deviseSource)
        .eq('target_currecy', deviseCible)
        .eq('is_active', true)
        .single()

        if (error){
            resultat = null;
        } else {
            resultat = data;
        }
        console.log(resultat);
    } catch (error){
        console.error('Une erreur réseau ou système est survenue:', error)
        return null
    }

    if (resultat != null){
        return resultat;
    } else {
        return null;
    }
};


const verifierCircuitBreaker = (corridor) =>{
    let statut

    statut = corridor.circuit_breaker_status
    if (statut === "OPEN"){
        return true;
    }

    if (statut === "TRIPPED"){
        return false;
    }

    if (statut === "HALF_OPEN"){
        return true;
    }

    return false;
};

const recupererTauxChange = async (deviseSource, deviseCible) =>{
    let tauxEnCache
    let tauxAPI
    

    try{
        const cleCache = `${deviseSource}_${deviseCible}`;
        const limiteValidite = new Date(Date.now() - TTLCache * 1000).toISOString();

        const{data, error} = await supabase
        .from('cache_redia')
        .select('*')
        .eq('cle', cleCache)
        .eq(tauxEnCache = (updatedAt.getTime() >= limiteValidite)) 

        if (tauxEnCache != null){
            return{
                taux: tauxEnCache.valeur,
                source: tauxEnCache.source
            }
        }

        tauxAPI = appelerAPI_BCE(deviseSource, deviseCible)
        if (tauxAPI === null){
            tauxAPI = appelerAPI_BEAC(deviseSource, deviseCible)
        }

        if (tauxAPI === null){
            tauxAPI = appelerAPI_XE(deviseSource, deviseCible)
        }

        if (tauxAPI === null){
            return null
        }

        if (tripError) throw tripError;
        const {updateData, updateError} = await supabase
        .from('cache_redis')
        .update({
            valeur: tauxAPI.taux,
            source: tauxAPI.source,
            updated_at: new Date().toISOString(),
        })
        .eq('cle', cleCache)

        return tauxAPI;
    } catch (error){
        console.error('Une erreur réseau ou système est survenue:', error)
        return null;
    }
};


const calculerMontantBrut = (montantSource, tauxChange) =>{
    let resultat

    resultat = montantSource * tauxChange;
    return resultat;
};


const calculerCommission = (montantBrut) =>{
    

    const commission = montantBrut * tauxCommission;
    return commission;
};


const calculerMontantNet = (montantBrut, montantCommission) =>{
    let resultat

    resultat = montantBrut - montantCommission;
    return resultat;
};


const verifierMontant = (montantSource, deviseSource, tauxChange) =>{
    let montantEnXAF

    if (deviseSource === XAF){
        montantEnXAF = montantSource;
    } else {
        montantEnXAF = montantSource * tauxChange
    }

    if (montantEnXAF < montantMinXAF){
        console.log("Montant trop faible" + montantMinXAF + "XAF")
        return false;
    }

    if (montantEnXAF > montantMaxXAF){
        console.log("Montant trop élévé" + montantMaxXAF + "XAF(limite AML")
        return false;
    }
    return true;
};


const detecterFluctuation = (corridor, tauxActuel) =>{
    
    let fluctue

    const tauxPrecedent = corridor.last_rate_checked

    if (tauxPrecedent === null){
        return false;
    }

    const variation = Math.abs(tauxActuel - tauxPrecedent)/tauxPrecedent

    if (variation > seuilFluctuation){
        fluctue = true;
    } else {
        fluctue : false;
    }

    return fluctue;
};

// procédure
const afficherPreview = (montantSource, deviseSource, montantBrut, montantCommission, montantNet, deviseCible, tauxChange, sourceUtilisee) =>{

    console.log("APERçU DE VOTRE CONVERSION")
    console.log("Vous envoyez :" + montantSource + " " + deviseSource);
    console.log("Taux appliqué :" + tauxChange + "(" + sourceUtilisee + ")");
    console.log("Montant brut :" + montantBrut + " " + deviseCible);
    console.log("Commission 1.5% :" + montantCommission + " " + deviseCible);
    console.log("Vous recevez : " + montantNet + " " + deviseCible);
    console.log("Confirmez vous cette conversion ? OUI ou NON");
};


const executerTransaction = async (userId, deviseSource, deviseCible, montantSource, montantBrut, montantCommission, montantNet, tauxChange, sourceUtilisee) =>{


    try{
        const{data, error} = await supabase
        .from('currency_transaction')
        .insert([
            {
                user_id: userId,
                source_currency: deviseSource,
                target_currency: deviseCible,
                source_amount: montantSource,
                gross_amount:montantBrut,
                commission_amount:montantCommission,
                net_amount:montantNet,
                exchange_rate: tauxChange,
                rate_source: sourceUtilisee,
                rate_timestamp: new Date(),
                statut: "CONFIRMED",
            }
        ])
        console.log("Transaction effectuée via Orange Money");
        console.log("Référence : " + transaction.transaction_id);
    } catch (error){
        console.error('Une erreur réseau ou système est survenue:', error)
        return null;
    }
    
};


const declencherCircuitBreaker = async (corridorId, deviseSource, deviseCible) =>{

    try{
        const{data, error} =await supabase
        .from('currency_exchange_corridor')
        .update({
            circuit_breaker_statut: "TRIPPED",
            circuit_breaker_tripped_at: new Date(),
        })
        .eq('corridor_id', corridorId)

        console.log("ALERTE CIRCUIT BREAKER :" + deviseSource + " ->" + deviseCible)
        console.log("Fluctuation > 3% en 1h détectée")
        console.log("Transactions suspendues sur ce corridor")
        console.log("équipe Orange notifiée")
    } catch (error){
        console.error('une erreur réseau ou système est survenue:', error)
        return null;
    }
};


const mettreAJourDernierTaux = async (corridorId, tauxActuel) =>{

    try{
        const{data,error} = await supabase
        .from('ccurrency_exchange_corridor')
        .update({last_rate_checked: tauxActuel})
        .eq('corridor_id', corridorId)
    } catch (error){
        console.error('Une erreur réseau ou système est survenue:', error)
        return null;
    }
};

// traitement principal
const conversionDevise = (userId, deviseSource, deviseCible, montantSource) =>{
    const corridor = await verifierCorridor(deviseSource,deviseCible)

    if (corridor === null){
        console.log("Conversion" + deviseSource + "->" + deviseCible + "non disponible")
        return null;
    }
    const circuitBreakerOk = verifierCircuitBreaker(corridor)
    if (circuitBreakerOk === false){
        console.log("Service temporairement suspendu");
        console.log("Taux de change instable en ce moment");
        console.log("Veuillez reéssayez dans queques minutes");
        return null;
    } 

    const tauxResultat = await recupererTauxChange(deviseSource, deviseCible)
    if (tauxResultat === null){
        console.log("Impossible de récupérer le taux de change");
        console.log("Veuillez reéssayer dans quelques minutes");
        return null;
    }

    const tauxChange = tauxResultat.taux
    const sourceUtilisee = tauxResultat.source

    if (detecterFluctuation(corridor, tauxChange) === true){
        await declencherCircuitBreaker(corridor.corridor_id, deviseSource, deviseCible)
        console.log("Conversion annulée pour votre protection")
        return null;
    }

    mettreAJourDernierTaux(corridor.corridor_id, tauxChange)

    const montantBrut = calculerMontantBrut(montantSource, tauxChange)
    const montantCommission = calculerCommission(montantBrut)
    const montantNet = calculerMontantNet(montantBrut, montantCommission)

    afficherPreview(montantSource, deviseSource, montantBrut, montantCommission,montantNet, deviseCible, tauxChange,sourceUtilisee)

    const confirmation = lireReponseUtilisateur();
    if (confirmation === false){
        console.log("Conversion annulée par l'utilisateur")
        return null;
    }

    const transaction = executerTransaction(userId, deviseSource, deviseCible, montantSource, montantBrut,montantCommission, montantNet, tauxChange, sourceUtilisee)
    return transaction;

}