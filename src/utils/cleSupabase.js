'use strict'

// ════════════════════════════════════════════════════════════
// Type de la clé Supabase, déterminé sans jamais l'afficher.
// Les clés « publishable » / « anon » sont des clés PUBLIQUES :
//   - RLS activée   → les écritures du backend sont refusées ;
//   - RLS désactivée → toute personne détenant la clé lit et modifie
//     la base directement, sans passer par l'API.
// Le backend doit utiliser la clé secrète (sb_secret_… ou service_role).
// ════════════════════════════════════════════════════════════

const analyserCleSupabase = (cle) => {
  const texte = String(cle || '')
  if (texte.startsWith('sb_secret_')) return { type: 'secret', adapteeAuServeur: true }
  if (texte.startsWith('sb_publishable_')) return { type: 'publishable', adapteeAuServeur: false }
  const parties = texte.split('.')
  if (parties.length === 3) {
    try {
      const { role } = JSON.parse(Buffer.from(parties[1], 'base64url').toString('utf8'))
      if (role === 'service_role') return { type: 'service_role', adapteeAuServeur: true }
      if (role === 'anon') return { type: 'anon', adapteeAuServeur: false }
    } catch {
      // format non reconnu
    }
  }
  return { type: 'inconnu', adapteeAuServeur: null }
}

const MESSAGE_CLE_PUBLIQUE = 'SUPABASE_KEY est une clé publique : avec la RLS activée, le backend ne peut pas écrire ; ' +
  'sans RLS, quiconque détient cette clé accède à toute la base. Utilisez la clé secrète (sb_secret_…) côté serveur.'

module.exports = { analyserCleSupabase, MESSAGE_CLE_PUBLIQUE }
