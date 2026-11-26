'use strict'

// ════════════════════════════════════════════════════════════
// Journal d'audit (table audit_log), tolérant au schéma réel :
// - colonnes optionnelles absentes → repli sur les colonnes minimales ;
// - table absente → audit désactivé (avertissement unique).
// Ne lève jamais d'exception : l'audit ne bloque pas le métier.
// ════════════════════════════════════════════════════════════

const supabase = require('../supabase')
const logger = require('./logger')
const { estColonneAbsente, estTableAbsente } = require('./db')

const COLONNES_MINIMALES = ['user_id', 'entity_type', 'action', 'actor_type']
const LONGUEUR_MAX_ACTION = 255

let modeMinimal = false
let auditDesactive = false

const selectionner = (objet, cles) => Object.fromEntries(cles.filter((cle) => cle in objet).map((cle) => [cle, objet[cle]]))

const journaliserAudit = async ({ userId = null, entite, action, acteur = 'SYSTEM', extra = {} }) => {
  if (auditDesactive) return false

  const complet = {
    user_id: userId,
    entity_type: entite,
    action: String(action).slice(0, LONGUEUR_MAX_ACTION),
    actor_type: acteur,
    ...extra
  }
  const ligne = modeMinimal ? selectionner(complet, COLONNES_MINIMALES) : complet

  try {
    const { error } = await supabase.from('audit_log').insert([ligne])
    if (!error) return true

    if (estTableAbsente(error)) {
      auditDesactive = true
      logger.warn('Table audit_log absente : journal d\'audit désactivé')
      return false
    }
    if (estColonneAbsente(error) && !modeMinimal) {
      modeMinimal = true
      logger.warn('audit_log : colonnes optionnelles absentes, journalisation réduite aux colonnes minimales')
      return journaliserAudit({ userId, entite, action, acteur, extra })
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
