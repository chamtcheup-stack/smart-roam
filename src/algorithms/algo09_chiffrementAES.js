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