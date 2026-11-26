'use strict'

// ════════════════════════════════════════════════════════════
// npm run verifier:schema
// Compare le schéma de la base Supabase configurée (.env) à celui
// qu'attend le backend. LECTURE SEULE : aucune donnée lue ni modifiée.
// Code de sortie : 0 conforme · 1 écart bloquant · 2 base injoignable.
// ════════════════════════════════════════════════════════════

const config = require('../src/config')
const supabase = require('../src/supabase')
const { estTableAbsente } = require('../src/utils/db')
const { verifierSchema, estBloquant, analyserCleSupabase } = require('../src/outils/verificationSchema')

const MIGRATION = 'database/migrations/001_alignement_supabase.sql'

const afficherTable = (resultat) => {
  const bloquant = estBloquant(resultat)
  const symbole = resultat.statut === 'OK' ? '✔' : (bloquant ? '✖' : '!')
  let ligne = `${symbole} ${resultat.table.padEnd(28)} ${resultat.statut}`
  if (resultat.statut === 'ABSENTE' && resultat.optionnelle) ligne += ` (optionnelle : ${resultat.repli})`
  if (resultat.erreur) ligne += ` (code ${resultat.erreur})`
  console.log(ligne)
  for (const colonne of resultat.colonnesManquantes) {
    const detail = colonne.obligatoire ? 'INDISPENSABLE' : `impact : ${colonne.impact || 'repli automatique'}`
    console.log(`    - ${colonne.nom} manquante (${detail})`)
  }
}

const afficherCle = (cle) => {
  if (cle.adapteeAuServeur === true) {
    console.log(`✔ Clé « ${cle.type} » adaptée à un usage serveur.\n`)
    return
  }
  if (cle.adapteeAuServeur === false) {
    console.log(`✖ Clé « ${cle.type} » détectée : c'est une clé PUBLIQUE.`)
    console.log('    - si la RLS est activée sur vos tables, les écritures du backend sont refusées ;')
    console.log('    - si elle est désactivée, quiconque détient cette clé lit et modifie toute la base.')
    console.log('  → Mettez la clé secrète (sb_secret_…) dans SUPABASE_KEY, redémarrez le backend,')
    console.log(`    puis activez la RLS (${MIGRATION}, section 4).\n`)
  }
}

const principal = async () => {
  console.log('Vérification du schéma Supabase (lecture seule)\n')
  const cle = analyserCleSupabase(config.supabase.cle)
  afficherCle(cle)

  // Sonde de connexion : évite de cumuler les nouvelles tentatives sur chaque table.
  const sonde = await supabase.from('country').select('*').limit(0).retry(false)
  if (sonde.error && !estTableAbsente(sonde.error)) {
    console.error(`✖ Base injoignable ou identifiants refusés (${sonde.error.code || 'réseau'}) : vérifiez SUPABASE_URL et SUPABASE_KEY.`)
    process.exitCode = 2
    return
  }

  const rapport = await verifierSchema(supabase)
  rapport.tables.forEach(afficherTable)
  console.log('')
  if (rapport.conforme) {
    console.log('✔ Schéma compatible avec le backend (les points « ! » dégradent seulement certaines fonctions).')
  } else {
    console.log(`✖ Écarts bloquants : ${rapport.bloquants.join(', ')}`)
    process.exitCode = 1
  }
  console.log(`  Migration non destructive et diagnostics : ${MIGRATION}`)
  if (cle.adapteeAuServeur === false) process.exitCode = 1

  console.log('\nÀ vérifier aussi (non détectable en lecture seule) : contraintes uniques sur')
  console.log(`users.phone_number, virtual_number.did_number et esim_profile.iccid (${MIGRATION}, section 0).`)
}

principal().catch((erreur) => {
  console.error('✖ Vérification impossible :', erreur.message)
  process.exitCode = 2
})
