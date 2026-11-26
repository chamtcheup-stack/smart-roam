'use strict'

// ════════════════════════════════════════════════════════════
// Scénario commenté du mode démo, dans le terminal.
//
//   npm run demo                         API démarrée dans ce processus
//   npm run demo -- --pause              attend « Entrée » avant chaque étape
//   npm run demo -- --url http://localhost:3000
//        pilote un serveur déjà lancé (npm run demo:serveur), par exemple
//        pendant que l'application mobile est ouverte sur le compte d'Awa
//   --sans-reinitialisation              ne remet pas la démo à zéro au début
//
// Aucune base réelle n'est utilisée : le serveur doit être en mode démo.
// ════════════════════════════════════════════════════════════

const args = process.argv.slice(2)
const valeurOption = (nom) => {
  const index = args.indexOf(nom)
  return index >= 0 ? args[index + 1] : null
}
const urlServeur = valeurOption('--url')
const avecPause = args.includes('--pause')
const sansReinitialisation = args.includes('--sans-reinitialisation')

// Mode démo forcé avant tout chargement de la configuration (jamais en production).
if (!urlServeur) {
  process.env.DEMO_MODE = 'true'
  if (process.env.NODE_ENV !== 'test') process.env.NODE_ENV = 'development'
  if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'error' // la narration suffit
}

const avecCouleurs = process.stdout.isTTY && !process.env.NO_COLOR
const style = (code) => (texte) => (avecCouleurs ? `\x1b[${code}m${texte}\x1b[0m` : String(texte))
const orange = style('38;5;208')
const gras = style('1')
const vert = style('32')
const rouge = style('31')
const gris = style('90')

const creerClient = (base) => async (methode, chemin, { corps, jeton, entetes = {} } = {}) => {
  const reponse = await fetch(base + chemin, {
    method: methode,
    headers: {
      'content-type': 'application/json',
      ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
      ...entetes
    },
    ...(corps ? { body: JSON.stringify(corps) } : {})
  })
  let json = null
  try {
    json = await reponse.json()
  } catch {
    json = null
  }
  return { statut: reponse.status, json, entetes: reponse.headers }
}

const attendreEntree = () => new Promise((resolve) => {
  process.stdin.resume()
  process.stdin.once('data', () => {
    process.stdin.pause()
    resolve()
  })
})

const demarrerServeurLocal = async () => {
  const { initialiserDemo } = require('../src/demo/pilotageDemo')
  const { creerApp } = require('../src/app')
  await initialiserDemo()
  const serveur = creerApp().listen(0, '127.0.0.1')
  await new Promise((resolve) => serveur.once('listening', resolve))
  return {
    base: `http://127.0.0.1:${serveur.address().port}`,
    arreter: () => new Promise((resolve) => {
      serveur.closeAllConnections()
      serveur.close(resolve)
    })
  }
}

const verifierServeurDemo = async (base) => {
  let sante = null
  try {
    sante = await (await fetch(`${base}/api/health`)).json()
  } catch {
    throw new Error(`Serveur injoignable : ${base} (lancez « npm run demo:serveur »)`)
  }
  if (!sante || sante.mode !== 'demo') {
    throw new Error(`${base} n'est pas en mode démo : le scénario n'est jamais joué sur des données réelles`)
  }
}

const afficherEtat = (etat) => {
  console.log(`\n${gras('État final de la démonstration')}`)
  console.log(`  Voyages     ${Object.entries(etat.voyages).map(([statut, n]) => `${statut} ${n}`).join(' · ')}`)
  console.log(`  Numéros     ${Object.entries(etat.numeros).map(([statut, n]) => `${statut} ${n}`).join(' · ')}`)
  console.log(`  Stocks      ${etat.stocks.map((s) => `${s.pays} ${s.occupation}`).join(' · ')}`)
  console.log(`  Audit       ${etat.evenementsAudit} évènements tracés · ${etat.alertesFraude} alerte(s) de fraude`)
}

const principal = async () => {
  const { executerScenario } = require('../src/demo/scenario')
  const serveur = urlServeur ? { base: urlServeur.replace(/\/+$/, ''), arreter: async () => {} } : await demarrerServeurLocal()
  if (urlServeur) await verifierServeurDemo(serveur.base)

  console.log(orange(gras('\n  SMART ROAM — démonstration commentée')))
  console.log(gris(`  API : ${serveur.base} · données fictives, aucun opérateur ni base réelle\n`))

  const resultat = await executerScenario(creerClient(serveur.base), {
    sauter: sansReinitialisation ? ['reinitialisation'] : [],
    avantEtape: async ({ etape, index, total }) => {
      console.log(`${orange(`[${index + 1}/${total}]`)} ${gras(etape.titre)}`)
      console.log(gris(`       ${etape.contexte}`))
      if (avecPause) {
        process.stdout.write(gris('       (Entrée pour continuer) '))
        await attendreEntree()
      }
    },
    apresEtape: ({ ok, lignes, erreur }) => {
      if (ok) for (const ligne of lignes) console.log(`       ${vert('✓')} ${ligne}`)
      else console.log(`       ${rouge('✗')} ${erreur.message}`)
      console.log('')
    }
  })

  if (resultat.reussi) {
    afficherEtat(resultat.etat)
    console.log(vert(gras('\n  Démonstration terminée avec succès.\n')))
  } else {
    console.log(rouge(gras('  Démonstration interrompue : voir l\'étape en échec ci-dessus.\n')))
  }
  await serveur.arreter()
  return resultat.reussi
}

principal()
  .then((reussi) => process.exit(reussi ? 0 : 1))
  .catch((erreur) => {
    console.error(rouge(erreur.message))
    process.exit(1)
  })
