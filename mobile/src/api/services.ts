import { creerClient } from './client'
import type {
  AlerteFraude,
  Consentement,
  Corridor,
  Declaration,
  Devis,
  Esim,
  EtatDemo,
  InfoDemo,
  Jetons,
  LigneJIT,
  NumeroVirtuel,
  Page,
  Pays,
  Pool,
  ProfilMiroir,
  RegleRenvoi,
  ReponseConnexion,
  ReponseOtp,
  ReponseSuggestion,
  ResultatAppel,
  ResultatArrivee,
  SignauxBruts,
  SimulationSignaux,
  Transaction,
  Utilisateur
} from './types'

// ── Pont entre le client HTTP et la session (mis à jour par SessionProvider) ──
const pont = {
  base: '',
  jetons: { acces: null as string | null, renouvellement: null as string | null },
  enregistrerJetons: async (_jetons: Jetons): Promise<void> => {},
  surSessionExpiree: (): void => {}
}

// Les requêtes attendent la première adresse de serveur fournie par la session.
let signalerBasePrete: () => void = () => {}
const basePrete = new Promise<void>((resolve) => {
  signalerBasePrete = resolve
})

export const configurerPont = (valeurs: Partial<typeof pont>) => {
  Object.assign(pont, valeurs)
  if (valeurs.base) signalerBasePrete()
}

const client = creerClient({
  obtenirBase: () => pont.base,
  attendreBase: () => basePrete,
  obtenirJetons: () => pont.jetons,
  enregistrerJetons: (jetons) => pont.enregistrerJetons(jetons),
  surSessionExpiree: () => pont.surSessionExpiree()
})

const { executer } = client
const publique = { authentifie: false } as const
const idempotent = (cle: string) => ({ 'Idempotency-Key': cle })

export type DemandeConversion = { deviseSource: string; deviseCible: string; montant: number }

export const api = {
  // ── Serveur ──
  sante: () => executer<{ statut: string; mode: 'demo' | 'reel' }>('/api/health', publique),
  pays: () => executer<{ pays: Pays[] }>('/api/pays', publique),
  infoDemo: () => executer<InfoDemo>('/api/demo', publique),

  // ── Compte ──
  demanderCode: (phoneNumber: string, motif: 'INSCRIPTION' | 'PIN_OUBLIE') =>
    executer<ReponseOtp>('/api/auth/otp', { ...publique, methode: 'POST', corps: { phoneNumber, motif } }),
  connexion: (phoneNumber: string, pin: string, deviceId: string) =>
    executer<ReponseConnexion>('/api/auth/login', { ...publique, methode: 'POST', corps: { phoneNumber, pin, deviceId } }),
  inscription: (phoneNumber: string, countryResidence: string, otpCode: string) =>
    executer<ReponseConnexion>('/api/users/register', { ...publique, methode: 'POST', corps: { phoneNumber, countryResidence, otpCode } }),
  pinOublie: (phoneNumber: string, otpCode: string, nouveauPin: string) =>
    executer<{ message: string }>('/api/auth/pin-oublie', { ...publique, methode: 'POST', corps: { phoneNumber, otpCode, nouveauPin } }),
  creerPin: (pin: string, jeton?: string) =>
    executer<{ message: string }>('/api/security/pin/create', { methode: 'POST', corps: { pin }, ...(jeton ? { jeton } : {}) }),
  changerPin: (ancienPin: string, pin: string) =>
    executer<{ message: string }>('/api/security/pin/create', { methode: 'POST', corps: { ancienPin, pin } }),
  verifierPin: (pin: string) =>
    executer<{ valide: boolean; message: string; tentativesRestantes?: number; jetonSensible?: { access_token: string; expires_in: number } }>(
      '/api/security/pin/verify', { methode: 'POST', corps: { pin } }
    ),
  deconnexion: (refreshToken: string | null) =>
    executer<{ message: string }>('/api/auth/logout', { methode: 'POST', corps: refreshToken ? { refreshToken } : {} }),
  deconnexionGlobale: () => executer<{ message: string }>('/api/auth/logout-all', { methode: 'POST' }),
  utilisateur: (userId: string) => executer<{ user: Utilisateur }>(`/api/users/${userId}`),
  modifierNom: (userId: string, displayName: string) =>
    executer<{ user: Utilisateur; profilsMiroirSynchronises: number }>(`/api/users/${userId}`, { methode: 'PUT', corps: { displayName } }),

  // ── Voyages et numéros ──
  numeros: (userId: string) => executer<Page & { numeros: NumeroVirtuel[] }>(`/api/users/${userId}/numbers?limit=100`),
  declarations: (userId: string) => executer<Page & { declarations: Declaration[] }>(`/api/declarations/${userId}?limit=50`),
  declarer: (paysISO: string, dateDepart: string, dateRetour: string | null, cle: string) =>
    executer<{ message: string; declaration: Declaration; numeroVirtuel?: NumeroVirtuel; pays?: string }>('/api/declarations/new', {
      methode: 'POST',
      corps: { paysISO, dateDepart, ...(dateRetour ? { dateRetour } : {}) },
      entetes: idempotent(cle)
    }),
  annulerDeclaration: (declarationId: string) =>
    executer<{ message: string }>(`/api/declarations/${declarationId}/cancel`, { methode: 'PUT' }),
  suggestion: () => executer<ReponseSuggestion>('/api/prediction/suggest', { methode: 'POST', corps: {} }),
  retourSuggestion: (paysISO: string, acceptee: boolean) =>
    executer<{ message: string }>('/api/prediction/feedback', { methode: 'POST', corps: { paysISO, acceptee } }),
  envoyerSignaux: (signaux: SignauxBruts) =>
    executer<ResultatArrivee>('/api/geolocalisation/arrivee', { methode: 'POST', corps: signaux }),

  // ── Renvoi d'appels ──
  regles: (userId: string) => executer<Page & { regles: RegleRenvoi[] }>(`/api/forwarding/rules/${userId}?limit=200`),
  creerRegle: (corps: { numberId: string; triggerCondition: string; action: string; targetNumber?: string; priority: number }) =>
    executer<{ regle: RegleRenvoi }>('/api/forwarding/rules/create', { methode: 'POST', corps }),
  modifierRegle: (ruleId: string, champs: Record<string, unknown>) =>
    executer<{ regle: RegleRenvoi }>(`/api/forwarding/rules/${ruleId}`, { methode: 'PUT', corps: champs }),
  supprimerRegle: (ruleId: string) => executer<{ message: string }>(`/api/forwarding/rules/${ruleId}`, { methode: 'DELETE' }),

  // ── eSIM et profil miroir ──
  esims: (userId: string) => executer<Page & { esims: Esim[] }>(`/api/esim/${userId}?limit=100`),
  provisionnerEsim: (numberId: string, paysISO: string, plan: string, cle: string) =>
    executer<{ message: string; esim: Esim | null; partenaire?: string }>('/api/esim/provision', {
      methode: 'POST', corps: { numberId, paysISO, plan }, entetes: idempotent(cle)
    }),
  synchroniserMiroir: (numberId: string) =>
    executer<{ message: string; profilMiroir: ProfilMiroir; avatarAutorise: boolean; nomAutorise: boolean; badgeKYC: string }>(
      '/api/mirror/sync', { methode: 'POST', corps: { numberId } }
    ),
  consentements: (userId: string) => executer<Page & { consentements: Consentement[] }>(`/api/mirror/consents/${userId}?limit=100`),
  changerConsentement: (paysDestination: string, dataType: string, isGranted: boolean) =>
    executer<{ message: string }>('/api/mirror/consent', { methode: 'POST', corps: { paysDestination, dataType, isGranted } }),

  // ── Argent ──
  corridors: () => executer<{ corridors: Corridor[] }>('/api/currency/corridors'),
  devis: (demande: DemandeConversion) => executer<Devis & { message: string }>('/api/currency/preview', { methode: 'POST', corps: demande }),
  confirmerConversion: (demande: DemandeConversion, jetonSensible: string, cle: string) =>
    executer<{ message: string; transaction: Transaction; controleFraude: { statut: string } }>('/api/currency/confirm', {
      methode: 'POST', corps: demande, jeton: jetonSensible, entetes: idempotent(cle)
    }),
  historiqueChange: (userId: string) => executer<Page & { transactions: Transaction[] }>(`/api/currency/history/${userId}?limit=50`),

  // ── Mode démo ──
  signauxDemo: (paysISO: string) => executer<SimulationSignaux>(`/api/demo/signaux/${paysISO}`, publique),
  appelEntrant: (numberId: string, statutLigne: string) =>
    executer<ResultatAppel>('/api/demo/appel-entrant', { methode: 'POST', corps: { numberId, statutLigne } }),
  maintenanceDemo: () =>
    executer<{ rapport: { voyages: { voyagesTermines: number; voyagesAnnules: number } | null; esimExpirees: number | null; sessionsPurgees: number | null } }>(
      '/api/demo/maintenance', { ...publique, methode: 'POST' }
    ),
  etatDemo: () => executer<EtatDemo>('/api/demo/etat', publique),
  reinitialiserDemo: () => executer<{ message: string }>('/api/demo/reinitialiser', { ...publique, methode: 'POST' }),

  // ── Exploitation (ADMIN) ──
  pools: () => executer<Page & { pools: Pool[] }>('/api/stock/pools?limit=100'),
  lancerJIT: () => executer<{ commandes: number; rapport: LigneJIT[] }>('/api/stock/jit/run', { methode: 'POST' }),
  confirmerLivraison: (poolId: string, quantite: number) =>
    executer<{ message: string; pool: Pool }>(`/api/stock/reorder/${poolId}`, { methode: 'PUT', corps: { quantite } }),
  alertesFraude: () => executer<Page & { alertes: AlerteFraude[]; disponible: boolean }>('/api/security/fraud-alerts?limit=50'),
  numerosDe: (userId: string) => executer<Page & { numeros: NumeroVirtuel[] }>(`/api/users/${userId}/numbers?limit=100`),
  reactiverNumero: (numberId: string) =>
    executer<{ message: string; numero: NumeroVirtuel }>(`/api/security/numbers/${numberId}/reactivate`, { methode: 'PUT' })
}

export const renouvelerSession = client.renouveler
