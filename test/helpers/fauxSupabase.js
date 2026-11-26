'use strict'

// ════════════════════════════════════════════════════════════
// Faux client Supabase des tests : la base en mémoire du mode démo
// (src/demo/baseMemoire.js), injectée à la place de src/supabase.js.
// ════════════════════════════════════════════════════════════

const Module = require('module')
const path = require('path')
const { creerBaseMemoire } = require('../../src/demo/baseMemoire')

const creerFauxSupabase = (tablesInitiales = {}, options = {}) => creerBaseMemoire(tablesInitiales, options)

// Injecte le faux client dans le cache de require à la place de src/supabase.js.
const installerFauxSupabase = (racine, faux) => {
  const chemin = require.resolve(path.join(racine || path.resolve(__dirname, '..', '..'), 'src', 'supabase.js'))
  const module = new Module(chemin)
  module.filename = chemin
  module.loaded = true
  module.exports = faux
  require.cache[chemin] = module
  return faux
}

module.exports = { creerFauxSupabase, installerFauxSupabase }
