'use strict'

// ════════════════════════════════════════════════════════════
// Exclusion mutuelle par clé (dans un processus) : les opérations d'un
// même utilisateur s'exécutent l'une après l'autre. Évite que deux
// conversions simultanées passent ensemble le contrôle anti-fraude, ou
// que deux déclarations identiques soient créées en parallèle.
// En multi-instances, compléter par une contrainte ou un verrou en base.
// ════════════════════════════════════════════════════════════

const filesAttente = new Map() // clé → promesse de la dernière opération

const executerEnExclusion = async (cle, operation) => {
  const precedente = filesAttente.get(cle) || Promise.resolve()
  let liberer
  const courante = new Promise((resolve) => { liberer = resolve })
  const maillon = precedente.then(() => courante)
  filesAttente.set(cle, maillon)

  await precedente
  try {
    return await operation()
  } finally {
    liberer()
    if (filesAttente.get(cle) === maillon) filesAttente.delete(cle)
  }
}

module.exports = { executerEnExclusion, nombreClesActives: () => filesAttente.size }
