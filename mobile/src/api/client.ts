import type { Jetons } from './types'

// Erreur renvoyée par l'API ({ erreur, code?, …détails }) ou réseau (statut 0).
export class ErreurApi extends Error {
  constructor (
    public readonly statut: number,
    message: string,
    public readonly code?: string,
    public readonly details: Record<string, unknown> = {},
    public readonly reessayerDansSecondes?: number
  ) {
    super(message)
    this.name = 'ErreurApi'
  }
}

export type Methode = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface OptionsRequete {
  methode?: Methode
  corps?: unknown
  // Jeton explicite (ex. jeton sensible après confirmation du PIN) : pas de renouvellement.
  jeton?: string | null
  authentifie?: boolean
  entetes?: Record<string, string>
  dejaRenouvele?: boolean
}

export interface ConfigurationClient {
  obtenirBase: () => string
  // Résolue quand l'adresse du serveur est connue (lue dans le stockage au démarrage).
  attendreBase?: () => Promise<void>
  obtenirJetons: () => { acces: string | null; renouvellement: string | null }
  enregistrerJetons: (jetons: Jetons) => Promise<void>
  surSessionExpiree: () => void
  delaiMs?: number
}

export const MESSAGE_RESEAU = 'Serveur injoignable : vérifiez votre connexion et l\'adresse du serveur'
export const MESSAGE_REPONSE_INVALIDE = 'Réponse inattendue : cette adresse ne semble pas être celle du serveur Smart Roam (port 3000 en démo)'

export const creerClient = (configuration: ConfigurationClient) => {
  let renouvellementEnCours: Promise<boolean> | null = null
  const delaiMs = configuration.delaiMs ?? 15000

  const executer = async <T>(chemin: string, options: OptionsRequete = {}): Promise<T> => {
    const { methode = 'GET', corps, authentifie = true, entetes = {} } = options
    // Jamais de requête avant que l'adresse du serveur soit connue (sinon, sur le
    // web, elle partirait vers le serveur de l'application elle-même).
    if (configuration.attendreBase) await configuration.attendreBase()
    const jeton = options.jeton !== undefined ? options.jeton : (authentifie ? configuration.obtenirJetons().acces : null)

    const controleur = new AbortController()
    const minuterie = setTimeout(() => controleur.abort(), delaiMs)
    let reponse: Response
    try {
      reponse = await fetch(configuration.obtenirBase() + chemin, {
        method: methode,
        headers: {
          Accept: 'application/json',
          ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
          ...entetes
        },
        ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}),
        signal: controleur.signal
      })
    } catch {
      throw new ErreurApi(0, MESSAGE_RESEAU, 'RESEAU')
    } finally {
      clearTimeout(minuterie)
    }

    const texte = await reponse.text()
    let json: Record<string, unknown> | null = null
    let illisible = false
    try {
      json = texte ? JSON.parse(texte) : null
    } catch {
      illisible = true
    }
    // Page HTML ou autre contenu : mauvaise adresse de serveur (ex. port d'Expo).
    if (illisible || (texte && !(reponse.headers.get('content-type') || '').includes('json'))) {
      throw new ErreurApi(reponse.status, MESSAGE_REPONSE_INVALIDE, 'REPONSE_INVALIDE')
    }
    if (reponse.ok) return json as T

    const code = typeof json?.code === 'string' ? json.code : undefined
    // Jeton d'accès expiré ou révoqué : un renouvellement, puis un seul nouvel essai.
    const renouvelable = reponse.status === 401 && authentifie && options.jeton === undefined &&
      !options.dejaRenouvele && code !== 'CONFIRMATION_PIN_REQUISE'
    if (renouvelable) {
      if (await renouveler()) return executer<T>(chemin, { ...options, dejaRenouvele: true })
      configuration.surSessionExpiree()
    }

    const message = (typeof json?.erreur === 'string' && json.erreur) || (typeof json?.message === 'string' && json.message) || `Erreur ${reponse.status}`
    const reessayer = Number(reponse.headers.get('Retry-After')) || undefined
    throw new ErreurApi(reponse.status, message, code, json || {}, reessayer)
  }

  // Un seul renouvellement à la fois, même si plusieurs requêtes échouent ensemble.
  const renouveler = (): Promise<boolean> => {
    if (!renouvellementEnCours) {
      renouvellementEnCours = (async () => {
        const { renouvellement } = configuration.obtenirJetons()
        if (!renouvellement) return false
        try {
          const reponse = await executer<{ tokens: Jetons }>('/api/auth/refresh', {
            methode: 'POST',
            corps: { refreshToken: renouvellement },
            authentifie: false
          })
          await configuration.enregistrerJetons(reponse.tokens)
          return true
        } catch {
          return false
        }
      })().finally(() => {
        renouvellementEnCours = null
      })
    }
    return renouvellementEnCours
  }

  return { executer, renouveler }
}

// Message lisible pour l'utilisateur, quelle que soit l'erreur.
export const messageErreur = (erreur: unknown): string => {
  if (erreur instanceof ErreurApi) {
    if (erreur.statut === 429 && erreur.reessayerDansSecondes) {
      const minutes = Math.ceil(erreur.reessayerDansSecondes / 60)
      return `${erreur.message} (réessayez dans ${minutes > 1 ? `${minutes} minutes` : 'une minute'})`
    }
    return erreur.message
  }
  return erreur instanceof Error ? erreur.message : 'Une erreur inattendue est survenue'
}
