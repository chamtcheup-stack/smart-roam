'use strict'

// ════════════════════════════════════════════════════════════
// fetch avec délai maximal par requête.
//
// Sans délai, une base Supabase lente ou figée bloque les requêtes de
// l'API indéfiniment. Le dépassement est signalé comme une AbortError :
// postgrest-js ne relance alors PAS la requête (il relance les erreurs
// réseau des GET jusqu'à 3 fois, ce qui cumulerait les délais : ~39 s).
// ════════════════════════════════════════════════════════════

const creerFetchAvecDelai = (delaiMs, fetchBase = globalThis.fetch) => async (ressource, options = {}) => {
  const signalDelai = AbortSignal.timeout(delaiMs)
  const signal = options.signal ? AbortSignal.any([options.signal, signalDelai]) : signalDelai
  try {
    return await fetchBase(ressource, { ...options, signal })
  } catch (erreur) {
    if (signalDelai.aborted) throw new DOMException(`Délai de ${delaiMs} ms dépassé`, 'AbortError')
    throw erreur
  }
}

module.exports = { creerFetchAvecDelai }
