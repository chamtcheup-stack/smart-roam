const supabase = require('../supabase')

const chercherNumeroPersistant = async (userId, paysISO) => {

  let resultat;

  try {

    const { data, error } = await supabase
      .from('virtual_number')
      .select('*')
      .eq('user_id', userId)
      .eq('country_iso', paysISO)
      .single()

    if (error) {
      resultat = null;
    } else {
      resultat = data;
    }

    console.log(resultat);

  } catch (error) {
    console.error('Une erreur est survenue :', error);
    resultat = null;
  }

  if (resultat != null) {
    return resultat;
  } else {
    return null;
  }
};


const ChercherPoolDisponible = async (paysISO) => {
    let resultat;
    try {
        const {data, error} = await supabase
        .from ('did_pool')
        .select('*')
        .eq('country_iso' ,paysISO)
        .eq('status', "ACTIVE")
        .single()

        if (error) {
            resultat = null;
        } else {
            resultat = data;
        }
        console.log(resultat);
    } catch (error) {
        console.error('Une erreur est survenue :', error);
        resultat = null;
    }
    if (resultat === null) {
        return null;
    }
    if (resultat.allocated_count >= resultat.total_numbers) {
        return null;
    }
    return resultat;
};


const CalculerProchainNumero = (rangestart, allocatedCount) => {
    let prefixe;
    let baseNumerique;
    let suivant;
    let resultat;
    
    prefixe = rangestart.substring(0,4);
    baseNumerique = parseInt (rangestart.substring(4),10);
    suivant = baseNumerique + allocatedCount;
    resultat = prefixe + suivant;
     return resultat
};


const calculerTauxOccupation = (allocatedCount, totalNumbers) =>{
    let taux;

    taux = allocatedCount / totalNumbers;
    return taux;
};

// Procédure

const activerNumeroPersistant = async(numberId) =>{
    let active;
    try{
        const{error, data} = await supabase 
        .from('virtual_number')
        .update({
            status: 'AWAITING_ARRIVAL',
            activated_at: new Date()
        })
        .eq('number_id' , numberId)

        if (error){
        console.error("erreur supabase :", error);
        return false;
       }
       console.log("Numéro activé avec succès !");
       return true;
    } catch (error) {
        console.error('Une erreur réseau ou système est survenue :' ,error);
        return false;
    }
}; 

const creerNouveauNumero = async (userId,prochainNumero,paysISO,poolId) =>{
    let nouveauNumero;

    try{
        const{error,data} = await supabase
        .from('virtual_number')
        .insert([
            {
                user_id: userId,
                did_number: prochainNumero,
                country_iso: paysISO,
                did_pool_id: poolId,
                status: 'AWAITING_ARRIVAL',
                is_permanent_owner: true,
                activated_at: new Date()
            }
        ])
        .select()
        .single();

        if(error){
            console.error("Erreur lors de l'insertion :", error);
            return null;
        }

        const nouveauNumero = data;
        console.log("Numéro crée :", nouveauNumero);
        return nouveauNumero;
    } catch (error){
        console.error('Une erreur est survenue :', error);
        return null;
    }
    
};


const incrementerCompteurPool = async (poolId, compteurActuel) =>{
    try{
        const{error,data} = await supabase
        .from('did_pool')
        .update({
           allocated_count: compteurActuel + 1 
        })
        .eq('pool_id', poolId)

        if(error){
            console.error("erreur supabase :", error)
            return false;
        }
        return true;
    } catch(error){
        console.error('Une erreur réseau ou système est survenue :', error)
        return false;
    }
}; 


const alerterReapprovisionnement = async (poolId, paysISO) =>{
    try{
        const{data,error} = await supabase
        .from('did_pool')
        .update({
            reorder_status: "REORDER_PENDING"
        })
        .eq('pool_id', poolId)

        if(error){
            console.error("erreur supabase :", error)
            return false
        }
        console.log("Alerte : stock critique pour" + paysISO + "réapprovisionnement déclenché ! ")
        return true;
    } catch(error){
        console.error('Une erreur réseau ou système est survenue :', error)
        return false;
    }
};
// traitement final

const attribuerNumeroDID = async (userId,paysISO) =>{

    numeroExistant = await chercherNumeroPersistant(userId, paysISO)
    if (numeroExistant !== null){
        activerNumeroPersistant(numeroExixtant.number_id)
        return numeroExistant;
    }

    pool = await chercherPoolDisponible(paysISO)
    if(pool === null){
        console.log("Erreur: aucun numéro disponible pour " + paysISO)
        return null;
    }

    prochainNumero = calculerProchainNumero(pool.range_start, pool.allocated_Count)

    nouveauNumero = await creerNouveauNumero(userId,prochainNumero,paysISO,pool.poolId)

    await incrementerCompteurPool(pool.pool_id,pool.allocated_count)

    taux = calculerTauxOccupation(pool.allocated_count + 1,pool.total_numbers)
    if (taux >= 0.90){
        alerterReapprovisionnement(pool.pool_Id,paysISO)
    }
    return nouveauNumero;
};