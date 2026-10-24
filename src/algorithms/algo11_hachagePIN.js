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