'use strict'

const supabase = require('../supabase')
const { donnees } = require('../utils/db')

// ════════════════════════════════════════════
// GET /api/pays   (public)
// Pays référencés : choix du pays de résidence à l'inscription et
// destinations où un numéro local est disponible (numerosDisponibles).
// ════════════════════════════════════════════
const listerPays = async (req, res) => {
  const lignes = donnees(
    await supabase.from('country').select('*').order('name_fr', { ascending: true }),
    'lecture des pays'
  ) || []

  // Liste quasi statique : mise en cache côté client pendant 5 minutes.
  res.set('Cache-Control', 'public, max-age=300')
  return res.status(200).json({
    pays: lignes.map((pays) => ({
      code: pays.country_iso,
      nom: pays.name_fr || pays.country_iso,
      numerosDisponibles: pays.did_enabled === true,
      zoneRoaming: pays.roaming_zone || null
    })),
    total: lignes.length
  })
}

module.exports = { listerPays }
