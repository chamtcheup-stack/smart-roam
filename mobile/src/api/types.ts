// Types des réponses de l'API Smart Roam (voir docs/openapi.yaml du backend).

export type Role = 'USER' | 'ADMIN'

export interface Utilisateur {
  user_id: string
  phone_number: string
  country_of_residence: string
  kyc_status: string
  display_name?: string | null
  role?: Role
  avatar_url?: string | null
  home_orange_affiliate?: string | null
}

export interface Jetons {
  token_type: 'Bearer'
  access_token: string
  expires_in: number
  refresh_token: string
  refresh_expires_in: number
}

export interface ReponseConnexion {
  message: string
  user: Utilisateur
  tokens: Jetons
}

export interface ReponseOtp {
  message: string
  expireDansSecondes: number
  renvoiPossibleDansSecondes: number
  codeDemo?: string
}

export interface Pays {
  code: string
  nom: string
  numerosDisponibles: boolean
  zoneRoaming: string | null
}

export type StatutNumero = 'AWAITING_ARRIVAL' | 'ACTIVE' | 'PARKED' | 'SUSPENDED'

export interface NumeroVirtuel {
  number_id: string
  user_id: string
  did_number: string
  country_iso: string
  status: StatutNumero
  activated_at: string | null
  suspended_at: string | null
  mirror_display_name: string | null
  mirror_avatar_url: string | null
  mirror_synced_at: string | null
  created_at?: string
}

export type StatutVoyage = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'

export interface Declaration {
  declaration_id: string
  destination_country: string
  departure_date: string
  return_date: string | null
  status: StatutVoyage
  number_id: string | null
  declaration_time: string
  arrival_confirmed_at: string | null
  return_confirmed_at: string | null
}

export type Condition = 'ALWAYS' | 'BUSY' | 'NO_ANSWER' | 'NEVER'
export type ActionRenvoi = 'FORWARD' | 'VOICEMAIL' | 'REJECT' | 'RING'

export interface RegleRenvoi {
  rule_id: string
  number_id: string | null
  trigger_condition: Condition
  action: ActionRenvoi
  target_number: string | null
  priority: number
  is_active: boolean
}

export interface Esim {
  esim_id?: string
  iccid: string | null
  number_id: string
  country_iso: string
  plan_type: string
  data_quota_mb: number | null
  data_used_mb: number | null
  status: string
  activated_at: string | null
  expire_le: string | null
}

export interface Corridor {
  deviseSource: string
  deviseCible: string
  disponible: boolean
}

export interface Devis {
  deviseSource: string
  deviseCible: string
  montantSource: number
  tauxChange: number
  sourceTaux: string
  montantBrut: number
  tauxCommission: number
  commission: number
  montantNet: number
  montantEquivalentXAF: number
}

export interface Transaction {
  transaction_id: string
  source_currency: string
  target_currency: string
  source_amount: number
  gross_amount: number
  commission_amount: number
  net_amount: number
  exchange_rate: number
  status: string
  created_at: string
}

export interface Consentement {
  consent_id?: string
  destination_country: string
  data_type: string
  is_granted: boolean
  granted_at: string
  expires_at: string | null
  legal_basis: string
  etat: 'ACCORDE' | 'REFUSE' | 'EXPIRE'
}

export interface Suggestion {
  paysISO: string
  nomPays: string
  probabilite: string
  probabiliteValeur: number
  nbVoyages: number
  scores: { frequence: number; saison: number; jourSemaine: number }
}

export interface ReponseSuggestion {
  message: string
  suggestion: Suggestion | null
  totalVoyages: number
}

export interface SignauxBruts {
  mcc?: string
  mnc?: string
  ssid?: string
  cellId?: string
  cellIdConfirmation?: string
  paysIP?: string
}

export interface ResultatArrivee {
  message: string
  decision: string
  scoreConfiance: number
  paysDetecte?: string | null
  paysDestination?: string
  paysOrigine?: string
  reessayerDansSecondes?: number
  numerosActives?: number
  numerosParkes?: number
}

export interface ProfilMiroir {
  display_name: string
  avatar_url: string | null
  kyc_badge: string
  home_affiliate: string | null
}

export interface Page {
  total: number
  limit: number
  offset: number
}

// ── Mode démo ──────────────────────────────────────────────
export interface CompteDemo {
  cle: string
  nom: string
  telephone: string
  pin: string
  role: Role
  pays: string
  presentation: string
  couleur: string
  deviceId: string
  avatar: string
}

export interface InfoDemo {
  mode: 'demo'
  message: string
  comptes: CompteDemo[]
  numeros: Record<string, string>
  paysSimules: string[]
  scenario: { id: string; titre: string; contexte: string }[]
}

export interface SimulationSignaux {
  message: string
  paysISO: string
  lieu: string
  operateur: string
  signaux: SignauxBruts
}

export interface ResultatAppel {
  message: string
  numeroAppele: string
  statutNumero: string
  numeroAppelant: string
  statutLigne: string
  decision: string
  destination: string | null
  codeSIP: string
}

export interface EtatDemo {
  mode: 'demo'
  reinitialiseeLe: string | null
  utilisateurs: number
  voyages: Record<string, number>
  numeros: Record<string, number>
  esimActives: number
  transactions: number
  alertesFraude: number
  stocks: { pays: string; occupation: string; disponibles: number; reapprovisionnement: string | null }[]
  evenementsAudit: number
  derniersEvenements: { entite: string; action: string; acteur: string; le: string | null }[]
}

// ── Exploitation (ADMIN) ───────────────────────────────────
export interface Pool {
  pool_id: string
  country_iso: string
  total_numbers: number
  allocated_count: number
  reorder_status: string | null
  tauxOccupation: string
  tauxOccupationValeur: number
  numerosDisponibles: number
}

export interface LigneJIT {
  poolId: string
  pays: string
  action: string
  tauxOccupation?: number
  quantite?: number
  partenaire?: string
}

export interface AlerteFraude {
  alert_id?: string
  user_id: string
  alert_type: string
  anomaly_score: number
  action_taken: string
  created_at?: string
  triggered_by?: { montant?: number; devise?: string; pays?: string } | null
}
