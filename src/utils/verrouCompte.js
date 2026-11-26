'use strict'

// ════════════════════════════════════════════════════════════
// Verrou anti-force brute partagé par la connexion, la vérification
// du PIN et le contrôle de l'ancien PIN : les échecs s'additionnent
// quel que soit le point d'entrée. Clé = compte s'il existe, sinon
// numéro de téléphone (même comportement : aucune énumération).
// Un administrateur peut lever le verrou (POST /api/security/pin/unlock).
// ════════════════════════════════════════════════════════════

const { VerrouProgressif } = require('./limiteur')

const verrouCompte = new VerrouProgressif()

const cleCompte = (userId) => `compte:${userId}`
const cleTelephone = (telephone) => `tel:${telephone}`

module.exports = { verrouCompte, cleCompte, cleTelephone }
