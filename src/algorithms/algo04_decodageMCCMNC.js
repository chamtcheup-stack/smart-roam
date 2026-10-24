const supabase = require ('../supabase')

let mccMnc = [

    { cle: "62402", pays: "CM", operateur: "Orange CM"  },
    { cle: "62401", pays: "CM", operateur: "MTN CM"     },
    { cle: "20801", pays: "FR", operateur: "Orange FR"  },
    { cle: "20810", pays: "FR", operateur: "SFR"        },
    { cle: "20621", pays: "BE", operateur: "Orange BE"  },
    { cle: "60801", pays: "EG", operateur: "Orange EG"  },
   
]


const construireCleRecherche = (mcc, mnc) =>{

    let cle;

    cle = mcc + mnc;
    return cle;
};


const rechercherDansTable = async (cleRecherche) =>{
    let resultat;

    try{
        const{data, error} = await supabase
        .from('mccMncTable')
        .select('*')
        .eq('cle', cleRecherche)
        .single()

        if (error){
            resultat = null;
        } else {
            resultat = data;
        }
        console.log(resultat);


    } catch (error){
        console.error('Une erreur est survenue:', error)
        return null;
    }

    if (resultat != null){
        return resultat;
    } else {
        return null;
    }
};


const rechercherParMccSeul = async (mcc) =>{
    let resultat;

    try {
        const{data, error} = await supabase
        .from ('mccMncTable')
        .select('*')
        .like('cle', `${mcc}%`)
        .limit(1)
        .maybeSingle();


        if (error){
            resultat = null;
        } else {
            resultat = data;
        }
        console.log(resultat);
    } catch (error){
        console.error('Une erreur est survenue:', error)
        return null;
    }

    if (resultat != null){
        return resultat;
    } else {
        return null;
    }
};


const calculerConfiance = (mccConnu, mncConnu) =>{
    let confiance;

    if ((mccConnu === true) && (mncConnu === true)){
        confiance = 100;
    }

    if ((mccConnu === true) && (mncConnu === false)){
        confiance = 80;
    }

     if (mccConnu === false){
        confiance = 0;
    }

    return confiance;
}

// procédure
const retounerResultat = (paysISO, nomOperateur, confiance) =>{

    console.log("Pays détecté : " + paysISO);
    console.log("Oprétateur :" + nomOperateur);
    console.log("Confiance :" + "/100");
};


const signalerSignalInvalide = (mcc, mnc)=>{
     
    console.log("Signal invalide : MCC =" + mcc + "MNC =" + mnc + "inconnus")
};

// traitement principal
const decoderMCCMNC = async (mcc, mnc)=>{
    let cleRecherche
    let resultat
    let paysISO
    let nomOperateur
    let confiance

    cleRcherche = construireCleRecherche(mcc, mnc)
    resultat = await rechercherDansTable(cleRecherche)
    if (resultat != null){
        paysISO      = resultat.pays
        nomOperateur = resultat.operateur
        confiance    = calculerConfiance(true, true)

        return resultat(paysISO, nomOperateur, confiance)
        return {
        paysISO      : paysISO,
        nomOperateur : nomOperateur,
        confiance    : confiance
        }
   
    }

    resultat = await rechercherParMccSeul(mcc)
    if (resultat !=  null){
        paysISO      = resultat.pays
        nomOperateur = "Opérateur inconnu"
        confiance    = calculerConfiance(true, false )

        return resultat(paysISO, nomOperateur, confiance)
        return{
            paysISO      : paysISO,
            nomOperateur : nomOperateur,
            confiance    : confiance
        }

    }
   
    signalerSignalInvalide(mcc, mnc)
    return null;

}