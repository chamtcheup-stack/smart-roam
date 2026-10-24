const supabase = require ('../supabase')


const  actionForward    = "FORWARD"    // rediriger
const  actionVoiceMail  = "VOICEMAIL"  // messagerie
const  actionReject     = "REJECT"     // rejeter
const  actionRing       = "RING"       // sonnerie directe

const  conditionAlways     = "ALWAYS"      // toujours
const  conditionBusy       = "BUSY"        // si occupé
const  conditionNoAnswer   = "NO_ANSWER"   // si pas de réponse
const  conditionNever      = "NEVER"       // jamais

const  TTLCacheRegles   = 300  // 5 minutes en secondes
const  codeSIPReject    = "486 Busy Here"
const  codeSIPForward   = "302 Moved Temporarily"

const lireCacheRedis = async (cle) => null; // À implémenter avec un client Redis (ex: ioredis)
const ecrireCacheRedis = async (cle, valeur, ttl) => {}; 
const envoyerCommandeSip = (params) => {
    console.log(`[SIP] Envoi commande ${params.type} pour ${params.appelant} -> ${params.destination || 'N/A'}`);
};


const resoudreUserIdDepuisNumero = async (numeroAppele) =>{
    let resultat;

    try{
        const {data, error} = await supabase
        .from('virtual_number')
        .select('user_id')
        .eq('did_number', numeroAppele)
        .eq('status', "ACTIVE")
        .maybeSingle()

        if (error){
            resultat = null
        } else {
            resultat = data
        }
        return data.user_id;
    } catch (error){
        console.error("Une erreur réseau ou système s'est produit:", error)
        return null
    }

    if (resultat != null){
        return resultat.user_id
    } else {
        return null
    }
}


const chargerRegles = async (userId) =>{
    let reglesEnCache
    let reglesEnBase

    reglesEnCache = lireCacheRedis("Regles_" + userId)
    if (reglsEnCache != null){
        return reglesEnCache
    }
    try{
        const{data, error} = await supabase
        .from('forwarding_rule')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('priority', {ascending : true});

    } catch (error){
        console.log("Une érreur est survenue:", error)
        return [];
    }

    if (reglesEnBase != null){
        await ecrireCashRedis  ({
            cle    : "REGLES_" + userId,
            valeur : reglesEnBase,
            ttl    : TTL_CACHE_REGLES
        })
        return reglesEnBase
    } else {
        return [];
    }
}


const recupererNumeroVirtuelActif = async (userId) =>{
    let resultat

    try{
        const{data, error} = await supabase
        .from('virtual_number')
        .select('did_number')
        .eq('user_id', userId)
        .eq('status', "ACTIVE")
        .limit(1)
        .maybeSingle()

        if (error){
            resultat = null;
        } else {
            resultat = data;
        }
        console.log(resultat)
    } catch (error){
        console.error("Une erreur réseau ou système est survenue :", error)
        return null;
    }

    if (resultat != null){
        return resultat.did_number
    } else {
        return null;
    }
}


const evaluerCondition = (cle ,statusLigne) =>{
    let conditionRemplie

    if (regles.triggger_condition === conditionAlways){
        conditionRemplie =true 
    }

    if ((regles.trigger_condition === conditionBusy) && (statusLigne === "OCCUPE")){
        conditionRemplie = true 
    }

    if ((regles.trigger_condition === conditionNoAnswer) && (statusLigne === "Sans_Reponse")){
        conditionRemplie = true 
    }

    if (regles.trigger_condition === conditionNever){
        conditionRemplie = false 
    }
    return conditionRemplie
}


const determinerDestination = (regle, numeroVirtuelActif, userId, numeroAppele) =>{
    let destination = null

    if (regle.action === actionForward){
        if (regle.target_number != null){
            destination = regle.target_number 
        } else {
            destination = numeroVirtuelActif
        }
    }

    if (regle.action === actionVoiceMail){
        destination = "VOICEMAIL" + userId
    }

    if (regle.action === actionReject){
        destination = null 
    }

    if (regle.action === actionRing){
        destination = numeroAppele
    }

    return destination;
};

// procédures
const executerForward = (numeroAppelant, numeroDestination) =>{

    envoyerCommandeSip ({
        type: CODE_SIP_FORWARD,
        appelant: numeroAppelant,
        destination: numeroDestination,
    });

    console.log("Appel redirigé vers : " + numeroDestination)
    console.log("Appelant :" + numeroAppelant)
}

const executerReject = (numeroAppelant =>{

    envoyerCommandeSip ({
        type: CODE_SIP_REJECT,
        appelant: numeroAppelant,
    })

    console.log("Appel rejété :" + CODE_SIP_REJECT)
    console.log("Appelant:" + numeroAppelant)
})


const executerVoiceMail =(numeroAppelant, userId) =>{

    encoyerCommandeSip ({
        type: CODE_SIP_FORWARD,
        appelant: numeroAppelant,
        destination: "VOICEMAIL" + userId,
    })

    console.log("Appel redirigé vers la messagerie vocale")
    console.log("Utilisateur:" + userId)
}

const journaliserDecision = async (userId, numeroAppelant, numeroAppele, action, numeroDestination) =>{

    try{
        const{data, error} = await supabase
        .from('audit_log')
        .insert([
            {
                user_id: userId,
                entity_type: "FORWARDING_RULE",
                action: "APPEL_" + action + "_VERS_" + numeroDestination,
                actor_type: "SYSTEM",
                actived_at: new Date().toISOString(),
            }
        ])

        console.log (`Log : ${action} | Appelant : ${numeroAppelant} | Appelé : ${numeroAppele} | Vers : ${numeroDestination}`);
    } catch (error){
        console.error("Une erreur est survenue:", error)
        return null;
    }
};

const signalerNumeroInconnu = (numeroAppele) =>{
    console.log("Numéro DID inconnu ou inactif : " + numeroAppele)
    console.log("Appel rejeté automatiquement")
}

const signalerAucuneRegle = (userId) =>{
    console.log("Aucune règle active pour : " + userId)
    console.log("Application règle par défaut : RING")
}

// traitement principal
const moteurRegleForwarding = async (numeroAppele, numeroAppelant, statutLigne) =>{

    const userId = await resoudreUserIdDepuisNumero(numeroAppele)
    if (userId === null){
        signalerNumeroInconnu(numeroAppele)
        executerReject(numeroAppelant)
        return null
    }

    const regles = await chargerRegles(userId)
    let action = null;
    let numeroDestination = null;

    if (regles.length === 0){
        signalerAucuneRegle(userId)
        action = actionRing
        numeroDestination = numeroAppele
        await journaliserDecision(userId, numeroAppelant, numeroAppele, action, numeroDestination)
        executerForward(numeroAppelant, numeroDestination)
        return action
    }

    const numeroVirtuelActif = await recupererNumeroVirtuelActif(userId)
    let regleTrouvee = false
    let i = 0

    while (i < regles.length && regleTrouvee === false){
        const regle = regles[i];
        

        if (evaluerCondition(regle, statusLigne) === true){
            action = regle.action
            numeroDestination = determinerDestination(regle, numeroVirtuelActif)
            regleTrouvee = true
        }

        i++;
    }

    if (regleTrouvee === false){
        action = actionRing
        numeroDestination = numeroAppele
    }

    await journaliserDecision(userId, numeroAppelant, numeroAppele, action, numeroDestination)

    if (action === actionForward){
        executerForward(numeroAppelant, numeroDestination)
    }

    if (action === actionReject){
        executerRejet(numeroAppelant)
    }

    if (action === actionVoiceMail){
        executerVoicemail(numeroAppelant, userId)
    }

    if (action === actionRing){
        executerForward(numeroAppelant, numeroAppele)
    }

    return action;
}