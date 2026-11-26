import type { Ton } from '../ui/theme'

// ── Pays ───────────────────────────────────────────────────
const NOMS_PAYS: Record<string, string> = {
  CM: 'Cameroun', FR: 'France', BE: 'Belgique', SN: 'Sénégal', CI: 'Côte d\'Ivoire', MA: 'Maroc',
  ES: 'Espagne', DE: 'Allemagne', IT: 'Italie', GB: 'Royaume-Uni', US: 'États-Unis', CA: 'Canada',
  ML: 'Mali', BF: 'Burkina Faso', GN: 'Guinée', CD: 'RD Congo', MG: 'Madagascar', TN: 'Tunisie', JO: 'Jordanie'
}

export const nomPays = (code: string | null | undefined): string => (code ? NOMS_PAYS[code.toUpperCase()] || code.toUpperCase() : '—')

// Drapeau emoji à partir du code ISO (indicateurs régionaux Unicode).
export const drapeau = (code: string | null | undefined): string => {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '🌐'
  return String.fromCodePoint(...code.toUpperCase().split('').map((lettre) => 0x1f1e6 + lettre.charCodeAt(0) - 65))
}

// ── Téléphones ─────────────────────────────────────────────
// Groupes lisibles pour les indicatifs utilisés ; sinon numéro brut.
const FORMATS: { indicatif: string; groupes: number[] }[] = [
  { indicatif: '33', groupes: [1, 2, 2, 2, 2] },
  { indicatif: '32', groupes: [3, 2, 2, 2] },
  { indicatif: '237', groupes: [1, 2, 2, 2, 2] },
  { indicatif: '221', groupes: [2, 3, 2, 2] },
  { indicatif: '225', groupes: [2, 2, 2, 2, 2] },
  { indicatif: '212', groupes: [1, 2, 2, 2, 2] }
]

export const formaterTelephone = (numero: string | null | undefined): string => {
  if (!numero) return '—'
  const chiffres = numero.replace(/[^\d]/g, '')
  for (const { indicatif, groupes } of FORMATS) {
    const reste = chiffres.slice(indicatif.length)
    if (chiffres.startsWith(indicatif) && reste.length === groupes.reduce((a, b) => a + b, 0)) {
      const parties: string[] = []
      let position = 0
      for (const longueur of groupes) {
        parties.push(reste.slice(position, position + longueur))
        position += longueur
      }
      return `+${indicatif} ${parties.join(' ')}`
    }
  }
  return numero
}

// Saisie libre (espaces, points, « 00 » international) → E.164.
export const normaliserTelephone = (saisie: string): string => {
  const nettoye = saisie.trim().replace(/[\s.\-()]/g, '')
  if (nettoye.startsWith('00')) return `+${nettoye.slice(2)}`
  return nettoye.startsWith('+') ? nettoye : `+${nettoye}`
}

export const telephoneValide = (e164: string): boolean => /^\+[1-9]\d{6,14}$/.test(e164)

// ── Dates ──────────────────────────────────────────────────
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

export const formaterDate = (valeur: string | null | undefined): string => {
  if (!valeur) return '—'
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(valeur) ? `${valeur}T12:00:00` : valeur)
  if (Number.isNaN(date.getTime())) return valeur
  return `${date.getDate()} ${MOIS[date.getMonth()]} ${date.getFullYear()}`
}

export const formaterDateHeure = (valeur: string | null | undefined): string => {
  if (!valeur) return '—'
  const date = new Date(valeur)
  if (Number.isNaN(date.getTime())) return valeur
  return `${formaterDate(valeur)} à ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// Date locale AAAA-MM-JJ décalée de n jours (et non UTC : pas de décalage la nuit).
export const dateLocale = (decalageJours = 0): string => {
  const date = new Date()
  date.setDate(date.getDate() + decalageJours)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// ── Montants ───────────────────────────────────────────────
const SYMBOLES: Record<string, string> = { XAF: 'FCFA', XOF: 'F CFA', EUR: '€' }
const DECIMALES: Record<string, number> = { XAF: 0, XOF: 0 }

export const formaterNombre = (valeur: number, decimales = 2): string => {
  const [entiere, fraction] = Math.abs(valeur).toFixed(decimales).split('.')
  const groupee = entiere.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const texte = fraction && Number(fraction) !== 0 ? `${groupee},${fraction}` : groupee
  return valeur < 0 ? `−${texte}` : texte
}

export const formaterMontant = (valeur: number | string | null | undefined, devise: string): string => {
  const nombre = Number(valeur)
  if (!Number.isFinite(nombre)) return '—'
  return `${formaterNombre(nombre, DECIMALES[devise] ?? 2)} ${SYMBOLES[devise] || devise}`
}

// ── Libellés de statut ─────────────────────────────────────
type Libelle = { texte: string; ton: Ton }

export const statutNumero = (statut: string): Libelle => ({
  AWAITING_ARRIVAL: { texte: 'En attente d\'arrivée', ton: 'info' },
  ACTIVE: { texte: 'Actif', ton: 'succes' },
  PARKED: { texte: 'En parking', ton: 'neutre' },
  SUSPENDED: { texte: 'Suspendu', ton: 'danger' }
} as Record<string, Libelle>)[statut] || { texte: statut, ton: 'neutre' }

export const statutVoyage = (statut: string): Libelle => ({
  PENDING: { texte: 'Déclaré', ton: 'info' },
  CONFIRMED: { texte: 'Sur place', ton: 'succes' },
  COMPLETED: { texte: 'Terminé', ton: 'neutre' },
  CANCELLED: { texte: 'Annulé', ton: 'neutre' }
} as Record<string, Libelle>)[statut] || { texte: statut, ton: 'neutre' }

export const statutEsim = (statut: string): Libelle => ({
  ACTIVE: { texte: 'Active', ton: 'succes' },
  EXPIRED: { texte: 'Expirée', ton: 'neutre' }
} as Record<string, Libelle>)[statut] || { texte: statut, ton: 'neutre' }

export const libelleCondition: Record<string, string> = {
  ALWAYS: 'Toujours',
  BUSY: 'Si je suis en ligne',
  NO_ANSWER: 'Si je ne réponds pas',
  NEVER: 'Jamais'
}

export const libelleAction: Record<string, string> = {
  FORWARD: 'Renvoyer vers un numéro',
  VOICEMAIL: 'Messagerie vocale',
  REJECT: 'Refuser l\'appel',
  RING: 'Faire sonner'
}

export const libelleTypeDonnee: Record<string, string> = {
  PROFILE: 'Nom affiché',
  AVATAR: 'Photo de profil',
  LOCATION: 'Localisation',
  TRANSACTION: 'Transactions'
}

// Clé d'idempotence : identique pour les nouvelles tentatives d'une même action.
export const cleIdempotence = (): string => `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
