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