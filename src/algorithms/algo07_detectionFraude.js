const supabase = require ('../supabase')

const seuilAlerteSilencieuse = 50
const seuilSuspension = 80
const multiplicateurMontant = 5.0
const maxTransactionHeure = 20
const periodeAnalyse = 90
const tauxFauxPositifCible = 0.001
const actionAlerte = "ALERT_ONLY"
const actionSuspend = "SUSPEND_NUMBER"
const actionBlock = "BLOCK_ACCOUNT"

const recupererProfilNormal = async (userId) =>{
    let resultat 

    try {
        const {data, error} = await supabase
        .from('fraud_profile')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()

        if (error){
            resultat = null
        } else {
            resultat = data
        }
    } catch (error){
        console.error("Une erreur réseau ou système est survenue:", error)
        return null
    }

    if (resultat != null){
        return resultat
    } else {
        return null
    }
}

const compterTransactionRecentes = async (userId, nbMinutes) =>{
    let resultat

    try{
        const dateLimite = new Date();
        dateLimite.setMinutes(dateLimite.getMinutes() - nbMinutes);

        const {data, error} = await supabase
        .from('currency_transaction')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', new Date().toISOString())
        .eq('status', "CONFIRMED")
    } catch (error){
        console.error("Une erreur est survenue :", error)
        return null
    }

    return resultat.count 
}

const verifierDeviceConnu = async (userId, deviceId) =>{
    let resultat 

    try {

        const dateLimite = new Date();
        dateLimite.setDate(dateLimite.getDate() - PERIODE_ANALYSE);

        const {data, error} = await supabase
        .from('device')
        .select('*')
        .eq('user_id', userId)
        .eq('device_id', deviceId)
        .eq('last_seen_at', dateLimite.toISOString())
        .maybeSingle()

        if (error){
            resultat = false
        } else {
            resultat = true
        }
    } catch (error){
        console.error("Une erreur est survenue :", error)
        return null
    }

    if (resultat != null){
        return true
    } else {
        return false
    }
}

const verifierPaysHabituel = (profilNormal, paysActuel) =>{
    
    let i 
    let paysConnu

    const paysTypiques = profilNormal.typical_countries || []
    paysConnu = false
    i = 0

    while (i < paysTypiques.length){
        if (paysTypiques[i].iso === paysActuel){
            paysConnu = true
        }
        i++
    }

    return paysConnu
}

const evaluerRegleDeterm = async (regle, transaction, profilNormal) =>{
    let montantSeuil
    let nbTransactions
    const  resultat 

    resultat = {
        declenche: false,
        nbTransactions: null,
        score: 0,
    }

    if (regle.type === "MONTANT"){
        const montantSeuil = profilNormal.avg_transaction_amount * multiplicateurMontant

        if (transaction.source_amount > montantSeuil){
            resultat.declenche = true
            resultat.typeAnomalie = "AMOUNT"
            resultat.score = 85
        }
    }

    if (regle.type === "FREQUENCE"){
        const nbTransactions = await compterTransactionRecentes(transaction.user_id, 60)

        if (nbTransactions > maxTransactionHeure){
            resultat.declenche = true
            resultat.typeAnomalie = "FREQUENCY"
            resultat.score = 90
        }
    }

    if (regle.type === "LOCALISATION"){
        if (verifierPaysHabituel(profilNormal, transaction.target_currency) === false){
            resultat.declenche = true
            resultat.typeAnomalie = "FREQUENCY"
            resultat.score = 60
        }
    }

    if (regle.type === "DEVICE"){
        if (verifierDeviceConnu(transaction.user_id, transaction.device_id) === false){
            resultat.declenche = true
            resultat.typeAnomalie = "FREQUENCY"
            resultat.score = 70
        }
    }

    return resultat;
}

const calculerScoreML = async (transaction, profilMiroir) =>{
    let deviationMontant
    let deviationFrequence
    let scoreTotal

    if (profilNormal.avg_transaction_amount > 0){
        deviationMontant = Math.abs(transaction.source_amount - profilNormal.avg_transaction_amount)/profilNormal.avg_transaction_amount
    } else {
        deviationMontant = 0
    }

    if (profilNormal.avg_daily_transactions > 0){
        deviationFrequence = Math.abs(compterTransactionRecentes(transaction.user_id, 1400) - profilNormal.avg_daily_transactions)/profilNormal.avg_daily_transactions
    } else {
        deviationFrequence = 0
    }

    scoreTotal = (deviationMontant * 40) + (deviationFrequence * 30)
    if (score > 100){
        score = 100
    }
    return scoreTotal
}

const determinerAction = (scoreAnomalie) =>{
    let action

    if (scoreAnomalie >= seuilSuspension){
        action = actionSuspend
    }

    if (scoreAnomalie >= seuilAlerteSilencieuse && scoreAnomalie < seuilSuspension){
        action = actionAlerte
    }

    if (scoreAnomalie < seuilAlerteSilencieuse){
        action = null
    }

    return action
}

// Procédures
const creerAlerteAnomalie = async (userId, scoreAnomalie, typeAnomalie, transaction, action, profileId) =>{

    try {
        const {data, error} = await supabase
        .from('fraud_alert')
        .insert([
            {
                user_id: userId,
                profile_id: profilNormal.profile_id,
                alert_type: typeAnomalie,
                anomaly_score: scoreAnomalie,
                triggerd_by: {
                    transaction_id : transaction.transaction_id,
                    montant        : transaction.source_amount,
                    devise         : transaction.source_currency,
                    pays           : transaction.target_currency
                },
                action_taken: action,
                created_at: new Date().toISOString(),
            }
        ])
        console.log("Alerte créée — Score : " + scoreAnomalie)
        console.log("Type     : " + typeAnomalie)
        console.log("Action   : " + action)
    } catch (error){
        console.error("Une erreur est survenue:", error)
        return null
    }
}

const suspendreNumeroVirtuel = async (userId) =>{

    try{
        const{data, error} = await supabase
        .from('virtual_number')
        .update ({
            status : suspended,
            suspended_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('status', "ACTIVE")

        console.log("Numéro virtuel suspendu pour " + userId)
        console.log("Raison : Activité frauduleuse détectée")
    } catch (error){
        console.error("Une erreur est survenue:", error)
        return null
    }
}

const notifierUserId = (userId, typeAnomalie) =>{

    console.log("══════════════════════════════════════")
    console.log("NOTIFICATION SÉCURITÉ")
    console.log("══════════════════════════════════════")
    console.log("Activité anormale détectée sur votre compte")
    console.log("Type : " + typeAnomalie)
    console.log("Votre numéro virtuel a été suspendu")
    console.log("par précaution.")
    console.log("Contactez le support Orange si nécessaire.")
    console.log("══════════════════════════════════════")
}

const mettreAJourProfilML = async(userId, scoreAnomalie, totalAlertesActuel) =>{

    try{
        const{data, error} = await supabase
        .from('fraud_profile')
        .update({
            anomaly_score: scoreAnomalie,
            last_alert_at: new Date().toISOString(),
            total_alerts: totalAlertesActuel + 1,
            updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
    } catch (error){
        console.error("Une erreur est survenue lors de la mise à jour:", error)
        return null;
    }

    console.log("Profil ML mis à jour pour " + userId)
}

const journaliserTransactionNormale = async (userId, scoreAnomalie) =>{

    try{
        const {data, error} = await supabase
        .from('fraud_profile')
        .update({
            anomaly_score: scoreAnomalie,
            updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
    } catch (error){
        console.log("Une erreur réseau ou système est survenue :", error)
        return null
    }
    console.log( "Transaction normale — Score : " + scoreAnomalie + "/100")
}


// traitement principal
const detctionFraudeIA = () =>{
    
    const profilNormal = await recupererProfilNormal(userId)
    if (profilNormal === null){
        console.log("Profil ML inexistant pour " + userId)
        console.log("Transaction autorisée par défaut")
        return null
    }

    const eglesDeterm = [
        { type: "MONTANT"     },
        { type: "FREQUENCE"   },
        { type: "LOCALISATION"},
        { type: "DEVICE"      }
    ]

    let regleDeclenchee = FALSE
    let scoreAnomalie   = 0
    let typeAnomalie    = NULL
    let i               = 0

    while (i < reglesDeterm.length && regleDeclenchee === false){
        const regle = reglesDeterm[i]
        const resultat = await calculerReglesDeterm(regle, transaction, profilNormal)

        if (resultat.declenche === true){
            regleDeclenchee = TRUE
            scoreAnomalie   = resultat.score
            typeAnomalie    = resultat.typeAnomalie
        }
        i++
    }

    if (regleDeclenchee === false){
        scoreAnomalie = calculerScoreML(transaction, profilNormal)
        typeAnomalie = "ML_DETECTION"
    }

    const actionDecidee = determinerAction(scoreAnomalie)
    if (actionDecidee === null){
        await journaliserTransactionNormale(userId, scoreAnomalie)
        return {
            statut        : "NORMAL",
            scoreAnomalie : scoreAnomalie
        }
    }

    if (actionDecidee === actionAlerte){
        await creerAlerteAnomalie(userId, scoreAnomalie, typeAnomalie, transaction, actionAlerte)
        await mettreAJourProfilML (userId, scoreAnomalie)
        return {
            statut        : "ALERTE",
            scoreAnomalie : scoreAnomalie,
            typeAnomalie  : typeAnomalie
        }
    }

    if (actionDecidee = actionSuspend){
        await creerAlerteAnomalie(userId, scoreAnomalie, typeAnomlie, transaction, actionSuspend)
        await suspendreNumeroVirtuel(userId)
        notifierUtilisateur(userId, typeAnomalie)
        await mettreAJourProfilML(userId, scoreAnomalie)
        return {
            statut        : "SUSPENDU",
            scoreAnomalie : scoreAnomalie,
            typeAnomalie  : typeAnomalie
        }
    }
}