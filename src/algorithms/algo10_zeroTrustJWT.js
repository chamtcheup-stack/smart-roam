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