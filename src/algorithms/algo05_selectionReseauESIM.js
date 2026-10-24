const supabase = require ('../supabase')

const maxTentatives = 3
const poidsCouverture = 0.60
const poidsLatence = 0.30
const poidsCout = 0.10
const delaiProvisioning = 60
const planDefaut = "WEEK"

const verifierBYOE = async (userId, numberId) =>{
    let resultat

    try{
        const {data, error} = await supabase
        .from('trip_declaration')
        .select('*')
        .eq('user_id', userId)
        .eq('number_id', numberId)
        .eq('has_own_esim', true)
        .in('status', ['PENDING', 'CONFIRMED'])
        .maybeSingle()
    } catch (error){
        console.error("Une erreur réseau ou système est survenue:", error)
        return 
    }

    if (resultat != null){
        return true
    } else {
        return false
    }
}

const verifierZoneRoamingGratuit = (paysOrigine, paysDestination) =>{
    
    let resultatOrigine
    let resultatDest

    try{
        const {data, error} = await supabase
        .from('country')
        .select('roaming_zone')
        .eq('country_iso', paysOrigine)
        .maybeSingle()

        if (error){
            throw error
        }

        const{data, error} = await supabase
        .from('country')
        .select('roaming_zone')
        .eq('country_iso', paysDestination)
        .maybeSingle()

        if (resultatOrigine === null || resultatDest === null){
            return false;
        }

        const zoneOrigine     =resultatOrigine.roaming_zone
        const zoneDestination =resultatDest.roaming_zone

        if (zoneOrigine === "EU_FREE" && zoneDestination === "EU_FREE"){
            return true
        } else {
            return false
        }
    } catch (error){
        console.error("Une erreur est survenue:", error)
        return null
    }
}

const recupererPartenaireActifs = (paysISO) =>{
    let resultat

    try{
        const{data, error} = await supabase
        .from('mvno_partner')
        .select('*')
        .eq('country_iso', paysISO)
        .eq('agreement_status', "ACTIVE")
        .order('failover_priority', {ascending: true})

        if (error){
            resultat = []
        } else {
            resultat = data
        }
    } catch (error){
        console.error("Une erreur réseau ou système est survenue:", error)
        return []
    }

    if (resultat != null){
        return resultat
    } else {
        return []
    }
}

const recupererScoreCouverture = (partnerId, paysISO ) =>{
    let resultat
    let score 

    try{
        const{data, error} = await supabase
        .from('mvno_partner')
        .select('coverage_score')
        .eq('partner_id', partnerId)
        .eq('country_iso', paysISO)
        .maybeSingle()

        if (resultat != null){
            score = resultat.coverage_score
        } else {
            score = 0.50
        }

        return score
    } catch (error){
        console.error("Une erreur est survenue:", error)
        return null
    }
}


const recupererLatence  = async (partnerId) =>{
    

    const latence = await mesusrerLatence(resultat.coverage_score)
    if (latence >= 1000){
        return 0
    }
    return  (1000 - latence) / 1000
}

const recupererScoreCout = async (partnerId ,paysISO) =>{
    let resultat
    let scoreNorm

    try{
        const{data, error} = await supabase
        .from('mvno_partner')
        .select('cost_per_day_xaf')
        .eq('partner_id', partnerId)
        .eq('country_iso', paysISO)
        .maybeSingle()

        if (resultat === null){
            return 0.50
        }

        const coutXAF = resultat.cost_per_day_xaf

        if (coutXAF >= 5000){
            return 0
        }
        scoreNorm = (5000 - coutXAF) / 5000
        return scoreNorm
    } catch (error){
        console.error("Une erreur est survenue:", error)
        return null
        
    }
}

const calculerScorePartenaire = (scoreCouverture, scoreLatence, scoreCout) =>{
    let scoreTotal

    scoreTotal = (scoreCouverture * POIDS_COUVERTURE) + (scoreLatence * POIDS_LATENCE)  + (scoreCout * POIDS_COUT)
    return scoreTotal;


}

const trouverMeilleurPartenaire = (partenaireScore) =>{
    let meilleure
    let scoreMax
    let i 

    if (partenaireScore.length === 0){
        return null
    }

    meilleur = partenaireScores[0]
    scoreMax = partenaireScores[0].score
    i        = 1

    while (i < partenaireScore.length){
        if (partenaireScores[i].score > scoreMax){
            meilleur = partenaireScores[i]
            scoreMax = partenaireScores[i].score
        }
        i++
    }
    return meilleur
}

const cryptoRandomDigits = (length) => {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += Math.floor(Math.random() * 10);
    }
    return result;
};

const genererICCID = (partnerId, paysISO) =>{
    let iccid 

    iccid = genererICCIDUnique({
        prefix: "8930" + paysISO,
        partnerId: partnerId,
        aleatoire: cryptoRandomDigits(10)
    })
    return `${prefix}${partnerId.slice(0, 4)}${aleatoire}`.slice(0, 22);
}

const appelerSMDPPlus = async (url, iccid, userId, timeoutSec) => {
    // Simulation d'un appel API vers le SM-DP+ distant
    return { statut: "SUCCESS" };
};

const provisionnerOTA = async (parSemaine, iccid, userId) =>{
    let reponse 
    try {
        const reponse = await appelerSNDPPlus({
            url: partenaire.esim_sm_dp_url,
            iccid: iccid,
            userId: userId,
            timeout: delaiProvisioningSecondes,
        })
    } catch (error){
        console.error("Erreur lors du provisioning OTA :", error)
        return false 
    }
    if (reponse.status === "SUCCESS"){
        return true
    }else{
        return false
    }
}

// procédures
const enregistrerESIM = async (userId, numberId, partnerId, iccid, paysISO, planChoisi) =>{

    try{
        const{data, error} = await supabase
        .from('esim_profile')
        .insert([
            {
                user_id: userId,
                number_id: numberId,
                iccid: iccid,
                provider_id: partnerId,
                country_iso: paysISO,
                plan_type: planChoisi,
                data_quota_mb: 1024,
                data_used_mb: 0,
                status: "ACTIVE",
                activated_at: new Date().toISOString()
            }
        ])
        console.log("eSIM enregistrée en base")
        console.log("ICCID : " + iccid)
        console.log("Plan  : " + planChoisi)
    } catch (error){
        console.error("Une erreur réseau ou système est survenue:", error)
        return null
    }
}

const enregistrerBYOE = async (userId, numberId, paysISO) =>{

    try {
        const {data, error} = await supabase
        .from('esim_profile')
        .insert([
            {
                user_id: userId,
                number_id: numberId,
                country_iso: paysISO,
                plan_type: "BYOE",
                status: "ACTIVE",
                activated_at: new Date().toISOString(),
            }
        ])
        console.log("Mode BYOE enregistré")
        console.log("L'utilisateur utilise sa propre eSIM")
    } catch (error){
        console.error("Une erreur réseau ou système est survenue:", error)
        return null
    }
}

const notifierProvisionningReussi = (userId, partenaire, iccid) =>{
    
    console.log("══════════════════════════════════════")
    console.log("eSIM PROVISIONNÉE AVEC SUCCÈS")
    console.log("══════════════════════════════════════")
    console.log("Utilisateur : " + userId)
    console.log("Opérateur   : " + partenaire.name)
    console.log("ICCID       : " + iccid)
    console.log("Délai       : < " + DELAI_PROVISIONING + "s")
    console.log("══════════════════════════════════════")
}

const notifierRoamingGratuit = (paysOrigine, paysDestination) =>{

    console.log("══════════════════════════════════════")
    console.log("ROAMING DATA GRATUIT")
    console.log("══════════════════════════════════════")
    console.log("Déplacement intra-UE détecté")
    console.log("Pays origine      : " + paysOrigine)
    console.log("Pays destination  : " + paysDestination)
    console.log("Règlement UE 2017 : roaming data inclus")
    console.log("Aucune eSIM locale nécessaire")
    console.log("══════════════════════════════════════")
}

const signalerEchecProvisionning = (paysISO, tentatives) =>{
    console.log("ERREUR : Provisioning eSIM échoué")
    console.log("Pays         : " + paysISO)
    console.log("Tentatives   : " + tentatives)
    console.log("Tous les partenaires MVNO ont échoué")
    console.log("Intervention manuelle requise")
}

const signalerAucunPartenaire = (paysISO) =>{

    console.log("ERREUR : Aucun partenaire MVNO actif")
    console.log("Pays : " + paysISO)
    console.log("eSIM non disponible pour ce pays")
}

// traitement principal
const selectionReseauEsim = () =>{

    const utilisateurHasESIM = await verifierBYOE(userId, numberId)
    if (utilisateurHasESIM === true){
        await enregistrerBYOE(userId, numberId, paysISO)
        console.log("Mode BYOE activé — pas de provisioning")
        return {
            statut : "BYOE",
            iccid  : NULL
        }
    }
    const paysOrigine = await recupererPaysOrigine(userId)
    if (verifierZoneRoamingGratuit(paysOrigine, paysISO) === true){
        notifierRoamingGratuit(paysOrigine, paysISO)
        return {
            statut  : "ROAMING_GRATUIT",
            iccid   : null
        }
    }

    const partenaires = await recupererPartenairesActifs(paysISO)
    if (partenaires.length === 0){
        signalerAucunPartenaire(paysISO)
        return null
    }

    const partenaireScores = []
    let i                = 0

    while (i < partenaires.length){
        const scoreCouverture = await recupererScoreCouverture(partenaires[i].partner_id, paysISO)
        const scoreLatence = await recupererLatence(partenaires[i].partner_id)
        const scoreCout = await recupererScoreCout(partenaires[i].partner_id, paysISO)
        const scoreTotal = calculerScorePartenaire(scoreCouverture, scoreLatence, scoreCout)
        const p = partenaires[i]
        
        partenaireScores.push({
            partenaire: p,
            score: scoreTotal
        });
        i++
    }

    const meilleurPartenaire = trouverMeilleurPartenaire(partenaireScores)
    

    let provisioningOK  = FALSE
    let tentatives      = 0
    let indexPartenaire = 0
    let partenaireCourant = null;
    let iccid = null;

    while (provisioningOK === false && tentatives < maxTentatives && indexPartenaire < partenaireScores.length){
        provisionningOk = await provisionnerOTA(partenaireCourant, iccid, userId)
        iccid = genererICCID(meilleurPartenaire.partenaire.partner_id, paysISO)

        if (provisionningOk === false){
            console.log("Partenaire " + partenaireCourant.name + " en échec — tentative suivante")
            indexPartenaire = indexPartenaire + 1
            tentatives = tentatives + 1
        }
    }

    if (provisionningOk === false){
        signalerEchecProvisioning(paysISO, tentatives)
        return null
    }

    await enregistrerESIM(userId, numberId, partenaireCourant.partner_id, iccid, paysISO, PLAN_DEFAUT)
    notifierProvisionningReussi(userId, partenaireCourant, iccid)
    return {
        statut     : "SUCCES",
        iccid      : iccid,
        partenaire : partenaireCourant.name,
        plan       : PLAN_DEFAUT

    }
}