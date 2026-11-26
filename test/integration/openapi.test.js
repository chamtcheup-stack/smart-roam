'use strict'

// Cohérence entre les routes Express réellement montées et docs/openapi.yaml :
// toute route doit être documentée, et toute route documentée doit exister.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { preparer, RACINE } = require('../helpers/contexte')

const { requerir } = preparer()
const { MONTAGES } = requerir('src/app')

const ROUTES_APPLICATION = ['GET /', 'GET /api/health', 'GET /api/ready', 'GET /api/docs/openapi.yaml']

// /api/users/:userId et /api/users/{id} → /api/users/{} (noms de paramètres ignorés)
const normaliser = (chemin) => chemin.replace(/:[A-Za-z_]\w*/g, '{}').replace(/\{[^}]+\}/g, '{}').replace(/\/$/, '') || '/'

const routesExpress = () => {
  const routes = new Set(ROUTES_APPLICATION.map((r) => {
    const [methode, chemin] = r.split(' ')
    return `${methode} ${normaliser(chemin)}`
  }))
  for (const [prefixe, module] of MONTAGES) {
    const routeur = requerir(path.join('src', module))
    for (const couche of routeur.stack) {
      if (!couche.route) continue // middlewares (authentifier…)
      for (const methode of Object.keys(couche.route.methods)) {
        routes.add(`${methode.toUpperCase()} ${normaliser(prefixe + couche.route.path)}`)
      }
    }
  }
  return routes
}

// Lecture minimale du YAML : chemins à 2 espaces d'indentation sous « paths: »,
// méthodes à 4 espaces.
const routesDocumentees = () => {
  const lignes = fs.readFileSync(path.join(RACINE, 'docs', 'openapi.yaml'), 'utf8').split(/\r?\n/)
  const routes = new Set()
  let dansPaths = false
  let cheminCourant = null
  for (const ligne of lignes) {
    if (ligne.startsWith('paths:')) { dansPaths = true; continue }
    if (dansPaths && /^\S/.test(ligne)) break // section suivante (components)
    const chemin = ligne.match(/^ {2}(\/[^:]*):\s*$/)
    if (chemin) { cheminCourant = chemin[1]; continue }
    const methode = ligne.match(/^ {4}(get|post|put|delete|patch):\s*$/)
    if (methode && cheminCourant) routes.add(`${methode[1].toUpperCase()} ${normaliser(cheminCourant)}`)
  }
  return routes
}

test('chaque route Express est documentée dans docs/openapi.yaml', () => {
  const documentees = routesDocumentees()
  const manquantes = [...routesExpress()].filter((route) => !documentees.has(route))
  assert.deepEqual(manquantes, [], `routes non documentées : ${manquantes.join(', ')}`)
})

test('chaque route documentée existe réellement', () => {
  const existantes = routesExpress()
  const fantomes = [...routesDocumentees()].filter((route) => !existantes.has(route))
  assert.deepEqual(fantomes, [], `routes documentées inexistantes : ${fantomes.join(', ')}`)
})

test('la spécification couvre toute l\'API (au moins 45 opérations)', () => {
  assert.ok(routesDocumentees().size >= 45, `${routesDocumentees().size} opérations`)
})
