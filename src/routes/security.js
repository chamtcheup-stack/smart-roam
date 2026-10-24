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

const supabase = require ('../supabase')

const crypto = require('crypto');
const supabase = require('../supabase');

const tailleCle = 32
const tailleIv = 12
const modeChiffrement = "AES-GCM"
const dureeVieCle = 30

const genererIV = () =>{
    let iv
    iv = crypto.randomBytes (tailleIv)
    return iv;
}

const recupererCleActuelle = async () => {
    try {
        // En situation réelle, ceci interroge AWS KMS, Azure Key Vault ou Supabase
        const { data, error } = await supabase
            .from('kms_keys')
            .select('cle_hex, version')
            .eq('is_active', true)
            .maybeSingle();

        if (error || !data) return null;

        return {
            // Conversion de la clé hexadécimale en Buffer binaire
            cle: Buffer.from(data.cle_hex, 'hex'),
            version: data.version
        };
    } catch (error) {
        console.error("Erreur de récupération de la clé active :", error);
        return null;
    }
};

const chiffrerDonnees = (donneesBrutes, cleBuffer, ivBuffer) => {
    try {
        // 1. Initialiser le chiffreur
        const cipher = crypto.createCipheriv(MODE_CHIFFREMENT, cleBuffer, ivBuffer);

        // 2. Chiffrer le message
        let donneesChiffrees = cipher.update(donneesBrutes, 'utf8', 'hex');
        donneesChiffrees += cipher.final('hex');

        // 3. Récupérer le tag d'authentification GCM (16 octets par défaut)
        const tagGCM = cipher.getAuthTag().toString('hex');

        return {
            donnees_chiffrees: donneesChiffrees,
            tag_gcm: tagGCM
        };
    } catch (error) {
        console.error("Erreur lors du chiffrement :", error);
        return null;
    }
};


const verifierTagGCM = (donneesChriffrees, tagGCMRecu, cle, iv) =>{
    let integriteValide

    integriteValide = AESGCMChiffrerTag({
        donnees : donneesChiffrees,
        tag     : tagGCMRecu,
        cle     : cle,
        iv      : iv
    })
    return integriteValide;
}


const dechiffrerDonnees = (donneesChiffreesHex, tagGCMHex, cleBuffer, ivBuffer) => {
    try {
        // 1. Initialiser le déchiffreur
        const decipher = crypto.createDecipheriv(MODE_CHIFFREMENT, cleBuffer, ivBuffer);

        // 2. Attribuer le tag GCM reçu pour vérifier l'authenticité
        decipher.setAuthTag(Buffer.from(tagGCMHex, 'hex'));

        // 3. Déchiffrer le message
        let donneesBrutes = decipher.update(donneesChiffreesHex, 'hex', 'utf8');
        donneesBrutes += decipher.final('utf8');

        return donneesBrutes;
    } catch (error) {
        // Si le tag est invalide ou les données altérées, une erreur est levée ici
        console.error("Déchiffrement échoué : Intégrité non garantie ou clé incorrecte.");
        return null;
    }
};


const verifierRotationCle = async (versionCle) => {
    try {
        const { data, error } = await supabase
            .from('kms_keys')
            .select('created_at')
            .eq('version', versionCle)
            .maybeSingle();

        if (error || !data) return false;

        const dateCreation = new Date(data.created_at);
        const maintenant = new Date();
        
        // Calcul du nombre de jours écoulés
        const differenceMs = maintenant - dateCreation;
        const joursEcoules = differenceMs / (1000 * 60 * 60 * 24);

        return joursEcoules >= DUREE_VIE_CLE;
    } catch (error) {
        console.error("Erreur de vérification de la rotation :", error);
        return false;
    }
};


const recupererCleParVersion = async (version) => {
    try {
        const { data, error } = await supabase
            .from('kms_keys')
            .select('cle_hex')
            .eq('version', version)
            .maybeSingle();

        if (error || !data) return null;

        return Buffer.from(data.cle_hex, 'hex');
    } catch (error) {
        console.error("Erreur de récupération de la clé version " + version, error);
        return null;
    }
};

// procédures
const effectuerRotationCle = async () => {
    try {
        // Générer une nouvelle clé aléatoire de 32 octets (256 bits)
        const nouvelleCleBuffer = crypto.randomBytes(TAILLE_CLE);
        const nouvelleCleHex = nouvelleCleBuffer.toString('hex');

        // Désactiver l'ancienne clé et insérer la nouvelle
        await supabase.from('kms_keys').update({ is_active: false }).eq('is_active', true);
        await supabase.from('kms_keys').insert({
            cle_hex: nouvelleCleHex,
            is_active: true,
            created_at: new Date().toISOString()
        });

        console.log("Rotation de clé effectuée avec succès.");
    } catch (error) {
        console.error("Erreur lors de la rotation de clé :", error);
    }
};


const refuserMessageCorrompu = (raison) =>{

    console.log("Message rejeté — Intégrité compromise");
    console.log("Raison : " + raison);
    console.log("Les données ont peut-être été modifiées en transit");


}


const effacerCleMemoire = (cleBuffer) => {
    if (Buffer.isBuffer(cleBuffer)) {
        cleBuffer.fill(0); // Remplit le buffer de 0 pour détruire la clé en mémoire
        console.log("Clé effacée de la mémoire.");
    }
};


// traitement principal
const chiffrerMessage = (donneesBrutes) =>{

    let cleInfo = await recupererCleActuelle()
    if (cleInfo === null){
        console.log ("Erreur : impossible d'accéder au vault")
    }

    const cleActuelle  = cleInfo.cle
    const versionCle   = cleInfo.version

    if (verifierRotationCle(versionCle) === true){
        await effectuerRotationCle()
        cleInfo      = await recupererCleActuelle()
        cleActuelle  = cleInfo.cle
        versionCle   = cleInfo.version
    }

    const ivBuffer = genererIV()
    const resultatChiffrement = chiffrerDonnees(donneesBrutes, cleInfo.cle, ivBuffer)

    effacerCleMemoire(cleInfo.cle);

    if (resultatChiffrement === null){
        console.log("Erreur lors du chiffrement")
        return null;
    }

    const donneesChiffrees = resultatChiffrement.donnees_chiffrees
    const tagGCM           = resultatChiffrement.tag_gcm
    effacerCleMemoire(cleActuelle)

    return {
        donnees_chiffrees: resultatChiffrement.donnees_chiffrees,
        iv: ivBuffer.toString('hex'),
        tag_gcm: resultatChiffrement.tag_gcm,
        version_cle: cleInfo.version
    };
}


const dechiffrerMessage = async (payloadRecu) => {
    const { donnees_chiffrees, iv, tag_gcm, version_cle } = payloadRecu;

    // Étape 1 : Récupérer la clé correspondant à la version du message
    const cleBuffer = await recupererCleParVersion(version_cle);
    if (!cleBuffer) {
        console.log(`Erreur : Clé version ${version_cle} introuvable.`);
        return null;
    }

    const ivBuffer = Buffer.from(iv, 'hex');

    // Étape 2 : Déchiffrer et vérifier l'intégrité via AES-GCM
    const donneesDechiffrees = dechiffrerDonnees(
        donnees_chiffrees,
        tag_gcm,
        cleBuffer,
        ivBuffer
    );

    // Étape 3 : Effacer la clé de la mémoire
    effacerCleMemoire(cleBuffer);

    if (!donneesDechiffrees) {
        refuserMessageCorrompu("Tag GCM invalide ou données altérées en transit.");
        return null;
    }

    return donneesDechiffrees;
};

const supabase = require ('../supabase')

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const supabase = require('../supabase');

const dureeAccesNormal = 15;
const dureeAccesSensible =5;
const dureeRefresh = 10080;
const algorithmeSignature = "HS256"

const determinerDureeExpiration = ( operationSensible) =>{
    let duree

    if (operationSensible === true){
        duree = dureeAccesSensible
    } else {
        duree = dureeAccesNormal
    }

    return duree;
}


const construirePayload = (userId, role, deviceId, duree) =>{
    let payload;

    payload = {
        userid : userId,
        role : role,
        deviceid : deviceId,
        issues_at : new Date(),
        expires_at : new Date() + duree

    }
    return payload;
}


const genererAccessToken = (payload, cleSignature, dureeMinutes) => {
    // jwt.sign prend le payload, la clé secrète et les options
    return jwt.sign(payload, cleSignature, {
        algorithm: ALGORITHME_SIGNATURE,
        expiresIn: `${dureeMinutes}m` // Expire dans X minutes
    });
};


const genererRefreshToken = () =>{
    let token

    token = cryptoRandomBytes(64).toString('hex');
    return token;
}


const hacherRefreshToken = (refreshToken) => {
    return crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');
};


const verifierSignature = (tokenRecu, cleSignature) => {
    try {
        jwt.verify(tokenRecu, cleSignature);
        return true;
    } catch (error) {
        return false;
    }
};


const verifierExpiration = (tokenRecu) => {
    try {
        const decoded = jwt.decode(tokenRecu);
        if (!decoded || !decoded.exp) return true;

        // jwt store 'exp' en secondes, Date.now() est en millisecondes
        const nowInSeconds = Math.floor(Date.now() / 1000);
        return decoded.exp < nowInSeconds;
    } catch (error) {
        return true;
    }
};


const extrairePayload = (tokenRecu) =>{
    let payload

    payload = jwt.decode(tokenRecu);
    if (payload != null){
        return payload
    } else {
        return null
    }
    return payload;
}


const verifierRefreshTkenEnBase = async (refreshTokenHash, userId) =>{
    let resultat

    try{
        const {data, error} = await supabase
        .from('session')
        .select('*')
        .eq('user_id', userId)
        .eq('refresh_token_hash', refreshTokenHash)
        .gt('expires_at', new Date().toISOString()) // .gt = 'greater than'
        .maybeSingle();

        if (error){
            resultat = null
        } else {
            resultat = data
        }
        console.log(resultat)
    } catch (error){
        console.error("Une ereeur est survenue :", error)
        return null;
    }
    if (resultat != null){
        return resultat
    } else {
        return null;
    }
}


const verifierTokenRevoque = async (userId) =>{
    let resultat

    try{
        const {data, error} = await supabase
        .from('cache_redis')
        .select('*')
        .eq('cle', "REVOQUE" + userId)
        .maybeSingle()

        if (error){
            resultat = null
        } else {
        resultat = data
        }
        console.log (resultat)
    } catch (error){
        console.error("Erreur de vérification de révocation :", error);
        return null
    }

    if (resultat != null){
        return true
    } else {
        return false
    }

}


// procedures
const sauvegarderSession = async (userId, deviceId, accessToken, refreshTokenHash) =>{

    try{
        const dateExpiration = new Date(Date.now() + DUREE_REFRESH * 60 * 1000)
        const {data, error} = await supabase

        .from ('session')
        .insert  ({
            user_id : userId,
            device_id : deviceId,
            access_token_hash : hacherRefreshToken(accessToken),
            refresh_token_hash : refreshTokenHash,
            expires_at : dateExpiration.toISOString()
        })

        if (error) throw error;

        console.log("Session créée pour : " + userId);

    } catch (error){
        console.error ("Une erreur réseau ou système est survenue :", error)
        return null;
    }
    console.log("Session créée pour :" + userId)
}


const invaliderRefreshToken = async (refreshTokenHash, userId) => {
    try {
        // Requête SQL sécurisée utilisant des paramètres pour éviter les injections SQL
        const { error } = await supabase
        .from('session')
        .delete()
        .eq('refresh_token_hash', refreshTokenHash)
        .eq('user_id', userId);
        
        // Exécution de la requête (on suppose que 'db' est votre instance de connexion)
        if (error) throw error;
        
        console.log("Refresh token invalidé pour " + userId);
    } catch (erreur) {
        console.error("Erreur lors de l'invalidation du token :", erreur);
    }
};


const revoquerTousToken = async (userId) =>{

    try{
        const { data, error } = await supabase
        .from('session')
        .delete()
        .eq('user_id', userId)
        .select();

        if (error) {
            throw(error)
        }
    

        const {dataInsert, errorInsert} = await supabase
        .from('cache_redid')
        .insert ({
            cle : "REVOQUE" + userId,
            valeur : true,
            ttl : dureeAccesNormal,
        })

        console.log("Tous les tokens révoqués pour :" + userId)
        console.log("Accès bloqué immédiatement")

    } catch (error){
        console.log("Une erreur est survenue :", error)
        return null;
    } 
}


const refuserAcces = (raison) =>{
    console.log ("Accès refusé - Raison :" + raison)
    console.log ("Code HTTP : 401 unauthorized")
}


// traitement principal
const genererTokens = (userId, role, deviceId, operationSensible, cleSignature) =>{
    const dureeExpiration = determinerDureeExpiration(operationSensible)

    const payload = construirePayload(userId, role, deviceId, dureeExpiration)

    const accessToken = genererAccessTokens(payload, cleSignature)

    const refreshToken = genererRefreshToken()

    const refreshTokenHash = hacherRefreshToken(refreshToken)

    await sauvegarderSession (userId, deviceId, accessToken, refreshTokenHash)

    return {
        access_token: accessToken,
        refresh_token: refreshToken,
        esxpires_in: dureeExpiration
    }
};

const verifierToken = async (tokenRecu, cleSignature) =>{
    const tokenValide = verifierSignature(tokenRecu, cleSignature)
    if (tokenValide === false){
        refuserAcces("Token falsifié ou invalide")
        return null;
    }

    const tokenExpire = verificationExpiration(tokenRecu)
    if (tokenExpire === true) {
        refuserAcces("Token expiré — utiliser le refresh token")
        return null;
    }

    const payload = extrairePayload(tokenRecu)
    if (payload === null){
        refuserAcces("Impossible de lire token")
        return null;
    }
    
    if (verifierTokenRevoque (payload.user_id) === true) {
        refuserAcces("Tokens révoqués — reconnexion requise")
        return null;
    }
    return payload;
}


const renouvelerToken = async (refreshToken, userId, cleSignature) =>{


    const refreshTokenHash = hacherRefreshToken(refreshToken)
    const session = await verifierRefreshTokenEnBase(refreshTokenHash, userId)
     if (session === null){
        refuserAcces ("Refresh token invalide ou expiré")
        return null;
    }
    await invaliderRefreshToken(refreshTokenHash, userId)

    const nouveauxTokens = await GenererTokens(
    userId,
    session.role,
    session.device_id,
    false,
    cleSignature,
  )
  return nouveauxTokens;
}

const supabase = require ('../supabase')

const crypto = require('crypto');
const argon2 = require('argon2');
const bcrypt = require('bcrypt');
const supabase = require('../supabase');

const argon2Memory = 65536;
const argon2Iteration = 3;
const argon2Parallellisme = 4;
const argon2Version = "ARGON2ID"

const bcryptRounds = 12;
const tailleSel = 16;

const genererSel = () =>{
    let sel;

    sel = crypto.randomBytes(tailleSel).toString('hex');
    return sel;
};


const detecterAlgorithme = () =>{
    let algorithme;

    if (argon2Disponible() === true){
        algorithme = "argon2";
    } else {
        algorithme = "bcrypt"
    }
    return algorithme;
};


const hacherAvecArgon2 = async (pinBrut, sel) => {
    try {
        const hash = await argon2.hash(pinBrut + sel, {
            type: argon2.argon2id,
            memoryCost: argon2Memory,
            timeCost: argon2Iteration,
            parallelism: argon2Parallellisme
        });
        return hash;
    } catch (error) {
        console.error("Erreur lors du hachage Argon2 :", error);
        return null;
    }
};


const hacherAvecBcrypt = async (pinBrut, sel) => {
    try {
        const hash = await bcrypt.hash(pinBrut + sel, BCRYPT_ROUNDS);
        return hash;
    } catch (error) {
        console.error("Erreur lors du hachage Bcrypt :", error);
        return null;
    }
};


const verifierParametreActuels = async (userId) =>{
    let resultat;
    let versionHash

    try{
        const {data, error} = await supabase
        .from('users')
        .select ('pin_hash')
        .eq('user_id', userId)

        if (error){
            resultat = null;
        } else {
            resultat = data;
        }

        const contientArgon2 = resultat.pin_hash.includes('argon2id');
        const contientMemoireAJour = resultat.pin_hash.includes(`m=${ARGON2_MEMORY}`);

    } catch (error){
        console.error("Une erreur est survenue :", error)
        return null;
    }

    if (resultat === null){
        return false
    }

    if ((versionHash === argon2Hash) && (argon2MemoryUtilisee(resultat.pin_hash) === argon2Memory)){
        return true;
    } else {
        return false;
    }
}


const comparerHash = (hashCalcule, hashStocke) => {
    if (!hashCalcule || !hashStocke) return false;
    
    // crypto.timingSafeEqual empêche un pirate de deviner la chaîne 
    // en mesurant le temps de réponse de la comparaison
    const bufA = Buffer.from(hashCalcule);
    const bufB = Buffer.from(hashStocke);

    if (bufA.length !== bufB.length) return false;

    return crypto.timingSafeEqual(bufA, bufB);
};


const recupererHashEtSel = async (userId) =>{
    let resultat;

    try {
        const {data, error} = await supabase
        .from('users')
        .select('pin_hash & pin_salt')
        .eq('user_id', userId)
        .maybeSingle()

        if (error){
            resultat = null;
        } else {
            resultat = data;
        }
        console.log(resultat);
    } catch (error){
        console.error("Une erreur est survenue :", error)
        return null;
    }

    if (resultat != null){
        return resultat;
    } else {
        return null;
    }
};

// procédures
const sauvegarderHash = async (userId, hash, sel , algo) =>{

    try{
        const {data, error} = await supabase
        .from('users')
        .update  ({
            pin_hash : hash,
            pin_salt : sel,
            updated_at : new Date().toISOString(),
        })
        .eq('user_id', userId)
        
        if (error) throw error;

        console.log(`PIN haché et sauvegardé pour : ${userId}`);
        console.log(`Algorithme utilisé : ${algo}`);

    } catch (error){
        console.error("Une erreur est survenue :", error)
        return null;
    }

    
};


const rehacherPin = async (userId, pinBrut) =>{
    

    console.log("Rehashing automatique pour" + userId)
    console.log("Paamètres mis à jour versargon2id")

    const nouveauSel =genererSel()
    const nouveauHash = hacherAvecArgon2(pinBrut, nouveauSel)

    await sauvegarderHash(userId, nouveauHash, nouveauSel, "ARGON2")
};


const signalerPINInvalide = (userId) =>{

    console.log("PIN incorrect pour l'utilisateur" + userId)
    console.log("Tentative de connexion échouéé")
};

// traitement principal avec PIN
const creerHashPIN = async (userId) =>{
    const sel = genererSel;
    const algorithme = detecterAlgorithme()
    let hashResultat;

    if (algorithme === "argon2"){
        hashResultat = awaithacherAvecArgon2(pinBrut, sel)
    } else {
        hashResultat = await hacherAvecBcrypt(pinBrut, sel)
    }

    await sauvegarderHash(userId, hashResultat, sel, algorithme)
    return hashResultat;
};


const verifierPIN = async (userId, pinSaisi) =>{

    const donne = await recupererHashEtSel(userId)
    if (donnee === null){
        console.log("Utilisateur introuvable :" + userId)
        return false;
    }

    const pinStocke = donnee.pin_hash
    const selStpcke = donne.pin_salt

    const algorithme = detecterAlgorithme()
    let hashVerification;

    if (algorithme === "argon2"){
        hashVerifiction = await hacherAvecArgon2(pinSaisi , selStocke)
    } else {
        hashVerification = await hacherAvecBcrypt(pinSaisi, selStocke)
    }

    const pinValide = comparerHash(hashVerification, pinStocke)
    if (pinValide === false){
        signalerPINInvalide(userId)
        return false;
    }

    const parametreOk = verifierParametreActuels(userId)
    if (parametreOk === false){
        await rehacherPin(userId, pinSaisi)
    }

    return true;
};

const supabase = require ('../supabase')

const pinPrincipal = "sha256/AAAA....1111"
const pinBackup1 = "sha256/BBBB....2222"
const pinBackup2 = "sha256/CCCC....3333"
const algorithmeHash = "SHA-256"
const typePinning = "SPKI"
const dureeViePins = 180

const TLSExtraireSPKI = (cert) => cert?.spki || null;
const SHA256 = (data) => "hash_SHA256_mock"; // Ex: crypto.createHash('sha256').update(data).digest('base64')
const comparaisonTempsConstant = (a, b) => a === b; // Ex: crypto.timingSafeEqual
const lireDateInstallationApp = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Ex: installée il y a 30 jours
const differenceJours = (d1, d2) => Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
const TLSExtraireExpiration = (cert) => cert?.expirationDate || new Date(Date.now() + 1000000);
const TLSExtraireDomaine = (cert) => cert?.domain || "";
const extraireDomaine = (url) => url ? new URL(url).hostname : "";
const TLSFermerConnexion = () => console.log("Fermeture TLS effectuée.");

const chargerPinsEpingles = () =>{
    let pins 

    pins = [
        pinPrincipal,
        pinBackup1,
        pinBackup2
    ]
    return pins
}

const extraireClePublique = (certificat) =>{
     

    const clePublique = TLSExtraireSPKI(certificat)
    if (clePublique != null ){
        return clePublique
    }else{
        return null
    }
}

const calculerHashSha256 = (clePublique) =>{
     

    const hash = SHA256(clePublique)
    if (hash != null){
        return "sha256/" + hash 
    } else {
        return null
    }
}

const comparerAvecPins = (hashPublique, pinsStockes) =>{
    let pinTrouve
    let indexPin
    

    pinTrouve = false
    indexPin = 0

    while (indexPin < pinsStockes.length && pinTrouve === false){
        const pinCourant = pinsStockes[indexPin]

        if (comparaisonTempsConstant(hashClePublique, pinCourant) === true){
            pinTrouve === true
        }
        indexPin = indexPin + 1
    }
    return pinTrouve
}

const verifierExpirationPins = () =>{
    
    let pinsExpires 

    const dateInstallation = lireDateInstallationApp()
    const joursEcoules = differenceJours(dateInstallation, new Date())

    if (joursEcoules >= dureeViePins){
        pinsExpires = true
    } else {
        pinsExpires = false
    }
    return pinsExpires
}

const verifierCerticatValide = (certificat) =>{
    
    let certValide 

    const dateExpiration = TLSExtraireExpiration(certificat)
    if (dateExpiration < new Date()){
        certValide = false
    } else {
        certValide = true
    }
    return certValide
}

const verifierDomaineServeur = (certificat, urlServeur) =>{
    
    let domaineValide

    const domaineCertificat = TLSExtraireDomaine(certificat)
    const domaineURL = extraireDomaine(urlServeur)
    if (domaineCertificat === domaineURL || domaineCertificat === "*" + domaineURL){
        domaineValide = true
    }else{
        domaineValide = false 
    }
    return (
        domaineCertificat === domaineURL || 
        domaineCertificat === "*." + domaineURL ||
        domaineCertificat === "*." + domaineURL.split('.').slice(1).join('.')
    );
}

// procédures
const autoriserConnexion = (urlServeur, hashClePublique) =>{

    console.log("Connexion autorisée")
    console.log("Serveur        : " + urlServeur)
    console.log("Hash vérifié   : " + hashClePublique)
    console.log("Pin correspondant trouvé dans l'application")
}

const refuserConnexion = (urlServeur, hashClePublique, raison) =>{

    TLSFermerConnexion ()
    console.log("══════════════════════════════════════")
    console.log("CONNEXION REFUSÉE — SÉCURITÉ")
    console.log("══════════════════════════════════════")
    console.log("Serveur   : " + urlServeur)
    console.log("Hash reçu : " + hashClePublique)
    console.log("Raison    : " + raison)
    console.log("Aucune donnée échangée")
    console.log("══════════════════════════════════════")
}

const enregistrerAlerteSecurite = async (urlServeur, hashClePublique, raison) =>{

    try{
        const {data, error} = await supabase
        .from('audit_log')
        .insert([
            {
                user_id: userId, 
                entity_type: "CERTIFICATE_PINNING",
                action: "CONNEXION_REFUSEE" + raison,
                actor_type: "SYSTEM",
                created_at: new Date().toISOString(),
            }
        ])
    } catch (error){
        console.error("Une erreur réseau ou système est survennue:", error)
        return null
    }
    console.log("Alerte sécurité enregistrée")
    console.log("Hash suspect  : " + hashClePublique)
    console.log("Serveur visé  : " + urlServeur)
}

const notifierMiseAJourRequise = () =>{

    console.log("══════════════════════════════════════")
    console.log("MISE À JOUR REQUISE")
    console.log("══════════════════════════════════════")
    console.log("Les certificats de sécurité de")
    console.log("votre application Smart Roam")
    console.log("doivent être renouvelés.")
    console.log("Veuillez mettre à jour l'application")
    console.log("dans votre store pour continuer.")
    console.log("══════════════════════════════════════")
}

const notifierEquipeSecurite = (hasSuspect, urlServeur) =>{

    console.log("ALERTE CRITIQUE SÉCURITÉ")
    console.log("Tentative MITM potentielle détectée")
    console.log("Hash suspect : " + hashSuspect)
    console.log("URL ciblée   : " + urlServeur)
    console.log("Équipe Orange Security notifiée")
}

// traitement principal 
// gemini 
// ── ÉTAPE 1 : Charger les pins épinglés dans le code de l'application
const pinsStockes = chargerPinsEpingles();

let connexionAutorisee = false;

// ── ÉTAPE 2 : Vérifier si les pins ne sont pas expirés (6 mois)
if (verifierExpirationPins() === true) {
    notifierMiseAJourRequise();
    
    return {
        autorisee: connexionAutorisee,
        raison: "PINS_EXPIRES"
    };
}

// ── ÉTAPE 3 : Vérifier que le certificat est techniquement valide
if (verifierCertificatValide(certificatPresente) === false) {
    refuserConnexion(urlServeur, "INCONNU", "CERTIFICAT_EXPIRE");
    await enregistrerAlerteSecurite(urlServeur, "INCONNU", "CERTIFICAT_EXPIRE");
    
    return {
        autorisee: connexionAutorisee,
        raison: "CERTIFICAT_EXPIRE"
    };
}

// ── ÉTAPE 4 : Vérifier que le domaine correspond bien à Smart Roam
if (verifierDomaineServeur(certificatPresente, urlServeur) === false) {
    refuserConnexion(urlServeur, "INCONNU", "DOMAINE_INCORRECT");
    await enregistrerAlerteSecurite(urlServeur, "INCONNU", "DOMAINE_INCORRECT");
    
    return {
        autorisee: connexionAutorisee,
        raison: "DOMAINE_INCORRECT"
    };
}

// ── ÉTAPE 5 : Extraire la clé publique du certificat présenté
const clePubliqueExtraite = extraireClePublique(certificatPresente);

if (clePubliqueExtraite === null) {
    refuserConnexion(urlServeur, "INCONNU", "CLE_PUBLIQUE_ILLISIBLE");
    await enregistrerAlerteSecurite(urlServeur, "INCONNU", "CLE_PUBLIQUE_ILLISIBLE");
    
    return {
        autorisee: connexionAutorisee,
        raison: "CLE_PUBLIQUE_ILLISIBLE"
    };
}

// ── ÉTAPE 6 : Calculer le hash SHA-256 de la clé publique extraite
const hashClePublique = calculerHashSHA256(clePubliqueExtraite);

if (hashClePublique === null) {
    refuserConnexion(urlServeur, "INCONNU", "HASH_IMPOSSIBLE");
    
    return {
        autorisee: connexionAutorisee,
        raison: "HASH_IMPOSSIBLE"
    };
}

// ── ÉTAPE 7 : Comparer le hash calculé avec les pins stockés
const pinTrouve = comparerAvecPins(hashClePublique, pinsStockes);

// ── ÉTAPE 8 : Prendre la décision finale
if (pinTrouve === true) {
    // Hash reconnu — connexion autorisée
    autoriserConnexion(urlServeur, hashClePublique);
    connexionAutorisee = true;
    return {
        autorisee: connexionAutorisee,
        hashVerifie: hashClePublique,
        raison: "PIN_RECONNU"
    };
} else {
    // Hash non reconnu — Possible attaque MITM — Refuser immédiatement
    refuserConnexion(urlServeur, hashClePublique, "PIN_NON_RECONNU");
    await enregistrerAlerteSecurite(urlServeur, hashClePublique, "PIN_NON_RECONNU");
    notifierEquipeSecurite(hashClePublique, urlServeur);
    connexionAutorisee = false;
    return {
        autorisee: connexionAutorisee,
        hashSuspect: hashClePublique,
        raison: "PIN_NON_RECONNU"
    };
}

module.exports = {
    verifierCertificatePinningSSL
};

// src/algorithms/detectionWAF.js

const supabase = require('../supabase')

// ════════════════════════════════════════════
// CONSTANTES
// ════════════════════════════════════════════

const MAX_REQUETES_PAR_SECONDE = 100
const DUREE_BLOCAGE_COURT      = 60
const DUREE_BLOCAGE_LONG       = 3600
const SEUIL_REPUTATION_BAS     = 0.30
const SEUIL_SPIKE              = 10.0
const TTL_COMPTEUR             = 60

const DECISION_AUTORISER = 'ALLOW'
const DECISION_BLOQUER   = 'BLOCK'
const DECISION_CAPTCHA   = 'CAPTCHA'

// ════════════════════════════════════════════
// FONCTION 1 — verifierIPBloquee
// ════════════════════════════════════════════
const verifierIPBloquee = async (adresseIP) => {
  try {
    const { data } = await supabase
      .from('cache_waf')
      .select('*')
      .eq('cle', 'BLOCKED_IP_' + adresseIP)
      .single()

    return data !== null
  } catch {
    return false
  }
}

// ════════════════════════════════════════════
// FONCTION 2 — lireCompteurRequetes
// ════════════════════════════════════════════
const lireCompteurRequetes = async (adresseIP) => {
  try {
    const { data } = await supabase
      .from('cache_waf')
      .select('valeur')
      .eq('cle', 'RATE_' + adresseIP)
      .single()

    return data ? parseInt(data.valeur, 10) : 0
  } catch {
    return 0
  }
}

// ════════════════════════════════════════════
// FONCTION 3 — detecterInjectionSQL
// ════════════════════════════════════════════
const detecterInjectionSQL = (payload) => {
  if (!payload) return false

  const patternsSQL = [
    'DROP TABLE', 'SELECT * FROM', 'UNION SELECT',
    'INSERT INTO', 'DELETE FROM', 'OR 1=1',
    "' OR '", '--', '/*', 'XP_CMDSHELL'
  ]

  const payloadMaj = payload.toUpperCase()
  let   injection  = false
  let   i          = 0

  while (i < patternsSQL.length && !injection) {
    if (payloadMaj.includes(patternsSQL[i])) {
      injection = true
    }
    i++
  }

  return injection
}

// ════════════════════════════════════════════
// FONCTION 4 — detecterInjectionXSS
// ════════════════════════════════════════════
const detecterInjectionXSS = (payload) => {
  if (!payload) return false

  const patternsXSS = [
    '<script>', '</script>', 'javascript:',
    'onerror=', 'onload=', 'alert(',
    'document.cookie', 'eval(', '<iframe', 'src=javascript'
  ]

  const payloadMin = payload.toLowerCase()
  let   injection  = false
  let   i          = 0

  while (i < patternsXSS.length && !injection) {
    if (payloadMin.includes(patternsXSS[i])) {
      injection = true
    }
    i++
  }

  return injection
}

// ════════════════════════════════════════════
// FONCTION 5 — evaluerRegleListeNoire
// ════════════════════════════════════════════
const evaluerRegleListeNoire = async (adresseIP) => {
  const bloquee = await verifierIPBloquee(adresseIP)

  if (bloquee) {
    return {
      declenchee : true,
      decision   : DECISION_BLOQUER,
      raison     : 'IP_EN_LISTE_NOIRE'
    }
  }
  return { declenchee: false, decision: null, raison: null }
}

// ════════════════════════════════════════════
// FONCTION 6 — evaluerRegleRateLimit
// ════════════════════════════════════════════
const evaluerRegleRateLimit = (adresseIP, compteurRequetes) => {
  if (compteurRequetes > MAX_REQUETES_PAR_SECONDE) {
    return {
      declenchee : true,
      decision   : DECISION_BLOQUER,
      raison     : 'RATE_LIMIT_DEPASSE_' + compteurRequetes
    }
  }
  return { declenchee: false, decision: null, raison: null }
}

// ════════════════════════════════════════════
// FONCTION 7 — evaluerRegleInjection
// ════════════════════════════════════════════
const evaluerRegleInjection = (payload) => {
  if (detecterInjectionSQL(payload)) {
    return {
      declenchee : true,
      decision   : DECISION_BLOQUER,
      raison     : 'INJECTION_SQL_DETECTEE'
    }
  }
  if (detecterInjectionXSS(payload)) {
    return {
      declenchee : true,
      decision   : DECISION_BLOQUER,
      raison     : 'INJECTION_XSS_DETECTEE'
    }
  }
  return { declenchee: false, decision: null, raison: null }
}

// ════════════════════════════════════════════
// FONCTION 8 — evaluerRegleSpike
// ════════════════════════════════════════════
const evaluerRegleSpike = (baselineTraffic, trafficActuel) => {
  if (baselineTraffic > 0) {
    const ratio = trafficActuel / baselineTraffic
    if (ratio >= SEUIL_SPIKE) {
      return {
        declenchee : true,
        decision   : DECISION_BLOQUER,
        raison     : 'SPIKE_TRAFIC_X' + Math.round(ratio)
      }
    }
  }
  return { declenchee: false, decision: null, raison: null }
}

// ════════════════════════════════════════════
// FONCTION 9 — evaluerRegleReputation
// ════════════════════════════════════════════
const evaluerRegleReputation = (scoreReputation) => {
  if (scoreReputation < SEUIL_REPUTATION_BAS) {
    return {
      declenchee : true,
      decision   : DECISION_CAPTCHA,
      raison     : 'REPUTATION_IP_FAIBLE_' + scoreReputation
    }
  }
  return { declenchee: false, decision: null, raison: null }
}

// ════════════════════════════════════════════
// PROCÉDURE 1 — incrementerCompteurIP
// ════════════════════════════════════════════
const incrementerCompteurIP = async (adresseIP) => {
  const compteurActuel = await lireCompteurRequetes(adresseIP)

  await supabase
    .from('cache_waf')
    .upsert({
      cle    : 'RATE_' + adresseIP,
      valeur : String(compteurActuel + 1)
    })
}

// ════════════════════════════════════════════
// PROCÉDURE 2 — bloquerIPTemporairement
// ════════════════════════════════════════════
const bloquerIPTemporairement = async (adresseIP,
                                        dureeBlocage,
                                        raison) => {
  await supabase
    .from('cache_waf')
    .upsert({
      cle    : 'BLOCKED_IP_' + adresseIP,
      valeur : raison
    })

  console.log('IP bloquée   : ' + adresseIP)
  console.log('Durée        : ' + dureeBlocage + ' secondes')
  console.log('Raison       : ' + raison)
}

// ════════════════════════════════════════════
// PROCÉDURE 3 — journaliserRequete
// ════════════════════════════════════════════
const journaliserRequete = async (adresseIP, urlCible,
                                   decision, raison) => {
  await supabase
    .from('audit_log')
    .insert([{
      entity_type : 'WAF',
      action      : decision + '_' + raison,
      actor_type  : 'SYSTEM',
      ip_address  : adresseIP,
      data_region : 'af-south-1'
    }])

  console.log('WAF Log : ' + decision +
    ' | IP : ' + adresseIP +
    ' | Raison : ' + raison)
}

// ════════════════════════════════════════════
// PROCÉDURE 4 — notifierEquipeOrange
// ════════════════════════════════════════════
const notifierEquipeOrange = (raison, adresseIP) => {
  console.log('══════════════════════════════')
  console.log('ALERTE WAF — ÉQUIPE ORANGE')
  console.log('Raison    : ' + raison)
  console.log('IP source : ' + adresseIP)
  console.log('══════════════════════════════')
}

// ════════════════════════════════════════════
// ALGORITHME PRINCIPAL
// ════════════════════════════════════════════
const evaluerRequeteWAF = async (requete) => {
  try {
    const adresseIP    = requete.ip      || '0.0.0.0'
    const payload      = JSON.stringify(requete.body || {})
    const urlCible     = requete.url     || '/'
    const baselineTraffic = 100
    const trafficActuel   = 100

    // ÉTAPE 1 : Incrémenter le compteur
    await incrementerCompteurIP(adresseIP)
    const compteurRequetes = await lireCompteurRequetes(adresseIP)
    const scoreReputation  = 0.80

    // ÉTAPE 2 : Définir l'ordre des règles
    const reglesWAF = [
      'LISTE_NOIRE',
      'RATE_LIMIT',
      'INJECTION',
      'SPIKE',
      'REPUTATION'
    ]

    // ÉTAPE 3 : Évaluer chaque règle
    let regleDeclenchee = null
    let i               = 0

    while (i < reglesWAF.length && regleDeclenchee === null) {
      let resultat = { declenchee: false }

      if (reglesWAF[i] === 'LISTE_NOIRE') {
        resultat = await evaluerRegleListeNoire(adresseIP)
      }
      if (reglesWAF[i] === 'RATE_LIMIT') {
        resultat = evaluerRegleRateLimit(
          adresseIP,
          compteurRequetes
        )
      }
      if (reglesWAF[i] === 'INJECTION') {
        resultat = evaluerRegleInjection(payload)
      }
      if (reglesWAF[i] === 'SPIKE') {
        resultat = evaluerRegleSpike(
          baselineTraffic,
          trafficActuel
        )
      }
      if (reglesWAF[i] === 'REPUTATION') {
        resultat = evaluerRegleReputation(scoreReputation)
      }

      if (resultat.declenchee) {
        regleDeclenchee = resultat
      }

      i++
    }

    // ÉTAPE 4 : Aucune règle déclenchée
    if (regleDeclenchee === null) {
      await journaliserRequete(
        adresseIP,
        urlCible,
        DECISION_AUTORISER,
        'REQUETE_NORMALE'
      )
      return { decision: DECISION_AUTORISER }
    }

    // ÉTAPE 5 : Règle déclenchée
    await journaliserRequete(
      adresseIP,
      urlCible,
      regleDeclenchee.decision,
      regleDeclenchee.raison
    )

    if (regleDeclenchee.decision === DECISION_BLOQUER) {
      const dureeBlocage = regleDeclenchee.raison
        .includes('INJECTION')
        ? DUREE_BLOCAGE_LONG
        : DUREE_BLOCAGE_COURT

      await bloquerIPTemporairement(
        adresseIP,
        dureeBlocage,
        regleDeclenchee.raison
      )

      if (regleDeclenchee.raison.includes('INJECTION')) {
        notifierEquipeOrange(
          regleDeclenchee.raison,
          adresseIP
        )
      }
    }

    return {
      decision : regleDeclenchee.decision,
      raison   : regleDeclenchee.raison
    }

  } catch (error) {
    console.error('Erreur WAF :', error)
    return { decision: DECISION_AUTORISER }
  }
}

module.exports = {
  evaluerRequeteWAF,
  detecterInjectionSQL,
  detecterInjectionXSS,
  evaluerRegleRateLimit,
  evaluerRegleInjection,
  evaluerRegleListeNoire,
  evaluerRegleSpike,
  evaluerRegleReputation
}

// src/algorithms/cloisonnementSouverainete.js

const supabase = require('../supabase')

// ════════════════════════════════════════════
// CONSTANTES
// ════════════════════════════════════════════

const REGION_EU_WEST    = 'eu-west-1'
const REGION_EU_CENTRAL = 'eu-central-1'
const REGION_AF_SOUTH   = 'af-south-1'
const REGION_ME_SOUTH   = 'me-south-1'
const REGION_US_EAST    = 'us-east-1'

const OPERATION_READ  = 'READ'
const OPERATION_WRITE = 'WRITE'

// ════════════════════════════════════════════
// FONCTION 1 — chargerTableRoutage
// ════════════════════════════════════════════
const chargerTableRoutage = () => {
  return [
    // PAYS UE
    { pays: 'FR', region: REGION_EU_WEST,    loi: 'RGPD'   },
    { pays: 'BE', region: REGION_EU_WEST,    loi: 'RGPD'   },
    { pays: 'ES', region: REGION_EU_WEST,    loi: 'RGPD'   },
    { pays: 'LU', region: REGION_EU_WEST,    loi: 'RGPD'   },
    { pays: 'PL', region: REGION_EU_CENTRAL, loi: 'RGPD'   },
    { pays: 'RO', region: REGION_EU_CENTRAL, loi: 'RGPD'   },
    { pays: 'SK', region: REGION_EU_CENTRAL, loi: 'RGPD'   },
    { pays: 'MD', region: REGION_EU_CENTRAL, loi: 'RGPD'   },
    // PAYS AFRIQUE
    { pays: 'CM', region: REGION_AF_SOUTH,   loi: 'ARTAC'  },
    { pays: 'CI', region: REGION_AF_SOUTH,   loi: 'ART-CI' },
    { pays: 'SN', region: REGION_AF_SOUTH,   loi: 'ARTP'   },
    { pays: 'ML', region: REGION_AF_SOUTH,   loi: 'AMRTP'  },
    { pays: 'BF', region: REGION_AF_SOUTH,   loi: 'ARCEP'  },
    { pays: 'GN', region: REGION_AF_SOUTH,   loi: 'ARPT'   },
    { pays: 'CD', region: REGION_AF_SOUTH,   loi: 'ARPTC'  },
    { pays: 'MG', region: REGION_AF_SOUTH,   loi: 'ARTEC'  },
    // PAYS MOYEN-ORIENT
    { pays: 'JO', region: REGION_ME_SOUTH,   loi: 'TRC'    },
    { pays: 'EG', region: REGION_ME_SOUTH,   loi: 'NTRA'   },
    // PAYS STANDARD
    { pays: 'US', region: REGION_US_EAST,    loi: 'CCPA'   },
    { pays: 'CA', region: REGION_US_EAST,    loi: 'PIPEDA' }
  ]
}

// ════════════════════════════════════════════
// FONCTION 2 — recupererPaysResidence
// ════════════════════════════════════════════
const recupererPaysResidence = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('country_of_residence')
      .eq('user_id', userId)
      .single()

    if (error || !data) return null
    return data.country_of_residence
  } catch {
    return null
  }
}

// ════════════════════════════════════════════
// FONCTION 3 — resoudreRegionCloud
// ════════════════════════════════════════════
const resoudreRegionCloud = (paysResidence, tableRoutage) => {
  let   i      = 0
  let   trouve = false
  let   entree = null

  while (i < tableRoutage.length && !trouve) {
    if (tableRoutage[i].pays === paysResidence) {
      entree = tableRoutage[i]
      trouve = true
    }
    i++
  }

  if (trouve) return entree

  // Région par défaut si pays non trouvé
  return {
    pays   : paysResidence,
    region : REGION_EU_WEST,
    loi    : 'STANDARD'
  }
}

// ════════════════════════════════════════════
// FONCTION 4 — verifierConformiteRegion
// ════════════════════════════════════════════
const verifierConformiteRegion = (regionCible, paysResidence) => {
  const paysUE      = ['FR','BE','ES','LU','PL','RO','SK','MD']
  const paysAfrique = ['CM','CI','SN','ML','BF','GN','CD','MG']
  const paysOrient  = ['JO','EG']

  // Vérifier UE
  if (paysUE.includes(paysResidence)) {
    return regionCible === REGION_EU_WEST ||
           regionCible === REGION_EU_CENTRAL
  }

  // Vérifier Afrique
  if (paysAfrique.includes(paysResidence)) {
    return regionCible === REGION_AF_SOUTH
  }

  // Vérifier Moyen-Orient
  if (paysOrient.includes(paysResidence)) {
    return regionCible === REGION_ME_SOUTH
  }

  // Autres pays — conformité standard
  return true
}

// ════════════════════════════════════════════
// FONCTION 5 — construireEtiquetteSouverainete
// ════════════════════════════════════════════
const construireEtiquetteSouverainete = (paysResidence,
                                          regionCible,
                                          loi,
                                          typeDonnee) => {
  return paysResidence + '|' +
         regionCible   + '|' +
         loi           + '|' +
         typeDonnee    + '|' +
         new Date().toISOString()
}

// ════════════════════════════════════════════
// PROCÉDURE 1 — journaliserOperationSouverainete
// ════════════════════════════════════════════
const journaliserOperationSouverainete = async (userId,
                                                  typeOperation,
                                                  typeDonnee,
                                                  regionCible,
                                                  autorisee) => {
  await supabase
    .from('audit_log')
    .insert([{
      user_id     : userId,
      entity_type : 'DATA_SOVEREIGNTY',
      action      : typeOperation + '_' + typeDonnee +
                    '_' + regionCible +
                    '_AUTORISEE_' + autorisee,
      actor_type  : 'SYSTEM',
      data_region : regionCible
    }])

  console.log('Audit souveraineté : ' + typeOperation +
    ' | Type : ' + typeDonnee +
    ' | Région : ' + regionCible +
    ' | Autorisée : ' + autorisee)
}

// ════════════════════════════════════════════
// PROCÉDURE 2 — bloquerOperationNonConforme
// ════════════════════════════════════════════
const bloquerOperationNonConforme = (userId, regionCible,
                                      paysResidence, raison) => {
  console.log('══════════════════════════════════')
  console.log('VIOLATION SOUVERAINETÉ BLOQUÉE')
  console.log('Utilisateur    : ' + userId)
  console.log('Pays résidence : ' + paysResidence)
  console.log('Région tentée  : ' + regionCible)
  console.log('Raison         : ' + raison)
  console.log('Action         : Écriture refusée')
  console.log('══════════════════════════════════')
}

// ════════════════════════════════════════════
// PROCÉDURE 3 — mettreAJourRegionUtilisateur
// ════════════════════════════════════════════
const mettreAJourRegionUtilisateur = async (userId,
                                             regionCible) => {
  await supabase
    .from('users')
    .update({ data_region: regionCible })
    .eq('user_id', userId)

  console.log('Région utilisateur mise à jour : ' + regionCible)
}

// ════════════════════════════════════════════
// ALGORITHME PRINCIPAL — ÉCRITURE
// ════════════════════════════════════════════
const routerEcriture = async (userId, typeDonnee,
                               donneeAEcrire) => {
  try {

    // ÉTAPE 1 : Charger la table de routage
    const tableRoutage = chargerTableRoutage()

    // ÉTAPE 2 : Récupérer le pays de résidence
    let paysResidence = await recupererPaysResidence(userId)

    if (!paysResidence) {
      console.log('Pays inconnu — région par défaut appliquée')
      paysResidence = 'FR'
    }

    // ÉTAPE 3 : Résoudre la région cloud
    const entreeRoutage = resoudreRegionCloud(
      paysResidence,
      tableRoutage
    )
    const regionCible = entreeRoutage.region

    // ÉTAPE 4 : Vérifier la conformité
    if (!verifierConformiteRegion(regionCible, paysResidence)) {
      bloquerOperationNonConforme(
        userId,
        regionCible,
        paysResidence,
        'REGION_NON_CONFORME'
      )

      await journaliserOperationSouverainete(
        userId,
        OPERATION_WRITE,
        typeDonnee,
        regionCible,
        false
      )

      return {
        autorisee : false,
        raison    : 'VIOLATION_SOUVERAINETE'
      }
    }

    // ÉTAPE 5 : Construire l'étiquette
    const etiquette = construireEtiquetteSouverainete(
      paysResidence,
      regionCible,
      entreeRoutage.loi,
      typeDonnee
    )

    // ÉTAPE 6 : Mettre à jour la région user
    await mettreAJourRegionUtilisateur(userId, regionCible)

    // ÉTAPE 7 : Journaliser
    await journaliserOperationSouverainete(
      userId,
      OPERATION_WRITE,
      typeDonnee,
      regionCible,
      true
    )

    console.log('Donnée routée vers : ' + regionCible)
    console.log('Étiquette          : ' + etiquette)

    return {
      autorisee   : true,
      regionCible : regionCible,
      etiquette   : etiquette
    }

  } catch (error) {
    console.error('Erreur cloisonnement :', error)
    return { autorisee: false, raison: 'ERREUR_INTERNE' }
  }
}

// ════════════════════════════════════════════
// ALGORITHME PRINCIPAL — LECTURE
// ════════════════════════════════════════════
const routerLecture = async (userId, typeDonnee) => {
  try {

    // ÉTAPE 1 : Récupérer la région d'origine
    const { data } = await supabase
      .from('users')
      .select('data_region')
      .eq('user_id', userId)
      .single()

    const regionOrigine = data ? data.data_region : REGION_EU_WEST

    // ÉTAPE 2 : Journaliser la lecture
    await journaliserOperationSouverainete(
      userId,
      OPERATION_READ,
      typeDonnee,
      regionOrigine,
      true
    )

    console.log('Lecture routée depuis : ' + regionOrigine)

    return {
      autorisee     : true,
      regionLecture : regionOrigine
    }

  } catch (error) {
    console.error('Erreur lecture souveraineté :', error)
    return { autorisee: false }
  }
}

module.exports = {
  routerEcriture,
  routerLecture,
  resoudreRegionCloud,
  verifierConformiteRegion,
  chargerTableRoutage
}