'use strict'

// ════════════════════════════════════════════════════════════
// Journal d'audit (table audit_log), tolérant au schéma réel :
// - colonne optionnelle absente (ip_address, data_region, details) → seule
//   cette colonne est ignorée, les autres informations sont conservées ;
// - table absente → audit désactivé (avertissement unique).
// Ne lève jamais d'exception : l'audit ne bloque pas le métier.
// ════════════════════════════════════════════════════════════

const supabase = require('../supabase')
const logger = require('./logger')
const { estTableAbsente, insererAvecColonnesOptionnelles } = require('./db')

const COLONNES_OPTIONNELLES = ['ip_address', 'data_region', 'details']
const LONGUEUR_MAX_ACTION = 255

let auditDesactive = false

const journaliserAudit = async ({ userId = null, entite, action, acteur = 'SYSTEM', extra = {} }) => {
  if (auditDesactive) return false

  const ligne = {
    user_id: userId,
    entity_type: entite,
    action: String(action).slice(0, LONGUEUR_MAX_ACTION),
    actor_type: acteur,
    ...extra
  }

  try {
    const { error } = await insererAvecColonnesOptionnelles(supabase, 'audit_log', ligne, COLONNES_OPTIONNELLES, { retourner: false })
    if (!error) return true

    if (estTableAbsente(error)) {
      auditDesactive = true
      logger.warn('Table audit_log absente : journal d\'audit désactivé')
      return false
    }
    logger.warn('Écriture du journal d\'audit impossible', { code: error.code, entite })
    return false
  } catch (erreur) {
    logger.warn('Écriture du journal d\'audit impossible', erreur)
    return false
  }
}

// Audit d'une action déclenchée par une requête HTTP : l'acteur est le rôle
// authentifié (USER / ADMIN / SERVICE), l'adresse IP est conservée.
const auditerRequete = (req, { userId = null, entite, action }) => journaliserAudit({
  userId,
  entite,
  action,
  acteur: (req.auth && req.auth.role) || 'ANONYME',
  extra: { ip_address: req.ip || null }
})

module.exports = { journaliserAudit, auditerRequete }
