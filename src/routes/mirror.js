const supabase = require ('../supabase')

const typeProfil = "PROFILE"
const typeAvatar = "AVATAR"
const badgeVerifie = "KYC_VERIFIE"
const badgeAucun = "AUCUN"
const dateExpiration = 30

const recupererProfilOrigine = async (userId) =>{
    let resultat

    try{
        const {data, error} = await supabase
        .from('users')
        .select('phone_number, kyc_status, home_orange_affiliate, country_of_residence, display_name, avatar_url')
        .eq('user_id', userId)
        .maybeSingle();

        if (error){
            resultat = null
        } else {
            resultat = data
        }
        console.log(resultat)
    } catch (error){
        console.error("Une erreur est survenue:", error)
    }

    if (resultat != null){
        return resultat
    } else {
        return null;
    }
}


const verifierConsentementNom = async (userId, paysDestination) =>{
    let resultat

    try {
        const {data, error} = await supabase
        .from('data_sovereignty_consent')
        .select('*')
        .eq('user_id', userId)
        .eq('destination_country', paysDestination)
        .eq('data_type', typeProfil)
        .eq('is_granted', true)
        .gt('expires_at' > new Date().toISOString())
        .maybeSingle();

        if (error){
            resultat = false
        } else {
            resultat = true
        }

    } catch (error){
        console.error("Une erreur est survenue lors de la vérification du nom:", error)
        return null;
    }

    if (resultat != null){
        return true
    } else {
        return false
    }
}

const verifierConsentementAvatar = async(userId, paysDestination) =>{
    let resultat

    try{
        const {data, error} = await supabase
        .from('data_sovereignty_consent')
        .select('*')
        .eq('user_id', userId)
        .eq('destination_country', paysDestination)
        .eq('data_type', typeAvatar)
        .eq('is_granted', true)
        .gt('expires_at' > new Date().toISOString)
        .maybeSingle()

        if (error){
            resultat = false
        } else {
            resultat = true
        }
    }  catch (error){
        console.error("Une erreur est survenue lors de la vérification de l'avatar:", error)
        return null;
    }

    if (resultat != null){
        return true
    } else {
        return false
    }
}

const verifierPaysInterditPhoto = (paysDestination) =>{
    
    let interdit
    let i 

    const paysInterditsPhoto = [
        "SA", "IR", "KP"
    ]
    interdit = false
    i = 0

    while (i < paysInterditsPhoto.length){
        if (paysInterditsPhoto[i] === paysDestination){
            interdit = true
        }
        i++
    }
    return interdit
}

const determinerBadgeKYC = (profilOrigine) =>{
    let badge

    if (profilOrigine.kyc.status === "VERIFIED"){
        badge = badgeVerifie
    } else {
        badge = badgeAucun
    }

    return badge
}

const construireProfilMiroir = (ProfilOrigine, nomAutorise, avatarAutorise, badge) =>{
    let resultat

    let profil = ({
        display_name = null,
        avatar_url = null,
        kyc_badge = badge,
        home_affiliate = profilOrigine.home_orange_affiliate,
    })

    if (nomAutorise = true){
        profil.display_name = profilOrigine.display_name
    } else {
        profil.display_name = "Utilisateur Orange"
    }

    if (avatarAutorise = true){
        profil.avatar_url = profilOrigine.avatar_url
    } else {
        profil.avatar_url = null
    }

    return profil
}

const verifierNumeroPersistant = async (numberId) =>{
    let resultat

    try{
        const {data, error} =await supabase
        .from('virtual_number')
        .select('*')
        .eq('number_id', numberId)
        .maybeSingle()

        if (error){
            resultat = null
        } else {
            resultat = data
        }
        console.log(resultat)
    } catch (error){
        console.error("Une erreur est survenue:", error)
    }

    if (resultat != null){
        return resultat
    } else {
        return null
    }
}

// procédures
const enregistrerProfilMiroir = async (numberId, profilMiroir) =>{

    try{
        const {data, error} = await supabase
        .from('virtual_number')
        .update ({
            mirror_display_name: profilMiroir.display_name,
            mirro_avatar_url: profilMiroir.avatar_url,
            mirror_synced_at: new Date().toISOString(),
        })
        .eq('number_id', numberId)
    } catch (error){
        console.error("Une erreur est survenue:", error)
        return
    }
    console.log("Profil miroir enregistré pour numéro" + numberId)
}

const enregistrerConsentmentDefaut = (userId, paysDestination) =>{

    try{
        const {data, error} = await supabase
        .from('data_sovereignty_consent')
        .insert([
            {
                user_id: userId,
                destination_country: paysDestination,
                data_type: typeProfil,
                is_granted: true,
                granted_at: new Date().toISOString(),
                expires_at: new Date().toISOString(),
                legal_basis: "CONTRACTUAL", 
            }
        ])
    } catch (error){
        console.error("Une erreur est survenue:", error)
        return null
    }

    console.log("Consentement nom par défaut créé")
    console.log("Pays :" + paysDestination)
    console.log("Expiration :" + DelaiExpiration + "jours")
}

const notifierSynchronisation = (userId, numberId, profilMiroir) =>{

    console.log("══════════════════════════════════════")
    console.log("PROFIL MIROIR SYNCHRONISÉ")
    console.log("══════════════════════════════════════")
    console.log("Utilisateur : " + userId)
    console.log("Numéro      : " + numberId)
    console.log("Nom affiché : " + profilMiroir.display_name)
    console.log("Avatar      : " + profilMiroir.avatar_url)
    console.log("Badge KYC   : " + profilMiroir.kyc_badge)
    console.log("Filiale     : " + profilMiroir.home_affiliate)
    console.log("══════════════════════════════════════")
}

const signalerSynchronisationPartielle = (userId, raison) =>{

    console.log("Synchronisation partielle pour " + userId)
    console.log("Raison : " + raison)
    console.log("Nom synchronisé uniquement — avatar ignoré")
}

const signalerErreurProfil = (userId) =>{

    console.log("Erreur : profil Orange introuvable")
    console.log("Utilisateur : " + userId)
    console.log("Synchronisation annulée")
}

const signalerErreurNumero = (numberId) =>{

    console.log("Erreur : numéro virtuel introuvable")
    console.log("Numéro ID : " + numberId)
    console.log("Synchronisation annulée")
}

// traitement principal
const synchroniserProfilMiroir = () =>{

    const numeroVirtuel = await verifierNumeroPersistant(numberId)
    if (numeroVirtuel === null){
        signalerErreurNumero(numberId)
        return null
    }

    const aysDestination = numeroVirtuel.country_iso

    const profilOrigine = recupererProfilOrigine(userId)

    if (profilOrigine === null){
        signalerErreurProfil(userId)
        return null
    }

    let nomAutorise = await verifierConsentementNom(userId, paysDestination)

    if (nomAutorise === false){
        await enregistrerConsentementDefaut (userId, paysDestination)
        nomAutorise = true
    }

    let avatarAutorise = await verifierConsentement(userId, paysDestination)

    if (verifierPaysInterditPhoto(paysDestination) === true){
        avatarAutorise = false
        signalerSynchronisationPartielle(userId, "pays" + paysDestination + "interdit le partage photo")
    }

    const badge = determinerBadgeKYC(origine)
    const profilMiroir = construireProfilMiroir(profilOrigine, nomAutorise, avatarAutorise, badge)

    await enregistrerProfilMiroir(numberId, profilMiroir)

    notifierSynchronisation(userId, numberId, profilMiroir)
    const synchronisationOk = true
    return synchronisationOk
}