import Constants from 'expo-constants'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'
import { api, configurerPont } from '../api/services'
import type { InfoDemo, Jetons, ReponseConnexion, Utilisateur } from '../api/types'
import { stockage } from './stockage'

const CLE_SESSION = 'smartroam.session'
const CLE_SERVEUR = 'smartroam.serveur'
const CLE_APPAREIL = 'smartroam.appareil'
const PORT_API = 3000

export type ModeServeur = 'demo' | 'reel' | 'injoignable' | 'verification'

interface Session {
  acces: string
  renouvellement: string
  utilisateur: Utilisateur
}

interface ValeurSession {
  pret: boolean
  session: Session | null
  utilisateur: Utilisateur | null
  estAdmin: boolean
  serveur: string
  mode: ModeServeur
  infoDemo: InfoDemo | null
  connecter: (telephone: string, pin: string) => Promise<void>
  ouvrirSession: (reponse: ReponseConnexion) => Promise<void>
  deconnecter: (options?: { partout?: boolean; silencieux?: boolean }) => Promise<void>
  definirServeur: (adresse: string) => Promise<void>
  verifierServeur: () => Promise<void>
  mettreAJourUtilisateur: (champs: Partial<Utilisateur>) => Promise<void>
}

const ContexteSession = createContext<ValeurSession | null>(null)

// Adresse de l'API par défaut : EXPO_PUBLIC_API_URL, sinon l'ordinateur qui sert
// l'application en développement (Expo Go sur le même Wi-Fi), sinon localhost.
export const adresseParDefaut = (): string => {
  const configuree = process.env.EXPO_PUBLIC_API_URL
  if (configuree) return configuree.replace(/\/+$/, '')
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname) {
    return `http://${window.location.hostname}:${PORT_API}`
  }
  const hote = Constants.expoConfig?.hostUri?.split(':')[0]
  return `http://${hote || 'localhost'}:${PORT_API}`
}

const nouvelIdentifiantAppareil = () => `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export function SessionProvider ({ children }: { children: ReactNode }) {
  const [pret, setPret] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [serveur, setServeur] = useState('')
  const [mode, setMode] = useState<ModeServeur>('verification')
  const [infoDemo, setInfoDemo] = useState<InfoDemo | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const appareilRef = useRef('')

  const appliquerSession = useCallback(async (nouvelle: Session | null) => {
    sessionRef.current = nouvelle
    configurerPont({ jetons: { acces: nouvelle?.acces ?? null, renouvellement: nouvelle?.renouvellement ?? null } })
    setSession(nouvelle)
    if (nouvelle) await stockage.ecrire(CLE_SESSION, JSON.stringify(nouvelle))
    else await stockage.supprimer(CLE_SESSION)
  }, [])

  const verifierServeur = useCallback(async () => {
    setMode('verification')
    try {
      const sante = await api.sante()
      if (sante.mode === 'demo') {
        setInfoDemo(await api.infoDemo())
        setMode('demo')
      } else {
        setInfoDemo(null)
        setMode('reel')
      }
    } catch {
      setInfoDemo(null)
      setMode('injoignable')
    }
  }, [])

  // Le client HTTP signale les jetons renouvelés et la fin de session.
  useEffect(() => {
    configurerPont({
      enregistrerJetons: async (jetons: Jetons) => {
        const courante = sessionRef.current
        if (courante) await appliquerSession({ ...courante, acces: jetons.access_token, renouvellement: jetons.refresh_token })
      },
      surSessionExpiree: () => {
        void appliquerSession(null)
      }
    })
  }, [appliquerSession])

  // Chargement initial : serveur, session et identifiant d'appareil enregistrés.
  useEffect(() => {
    void (async () => {
      const [serveurEnregistre, sessionEnregistree, appareilEnregistre] = await Promise.all([
        stockage.lire(CLE_SERVEUR),
        stockage.lire(CLE_SESSION),
        stockage.lire(CLE_APPAREIL)
      ])
      const base = serveurEnregistre || adresseParDefaut()
      configurerPont({ base })
      setServeur(base)
      appareilRef.current = appareilEnregistre || nouvelIdentifiantAppareil()
      if (!appareilEnregistre) await stockage.ecrire(CLE_APPAREIL, appareilRef.current)
      if (sessionEnregistree) {
        try {
          await appliquerSession(JSON.parse(sessionEnregistree) as Session)
        } catch {
          await appliquerSession(null)
        }
      }
      setPret(true)
      void verifierServeur()
    })()
  }, [appliquerSession, verifierServeur])

  const ouvrirSession = useCallback(async ({ user, tokens }: ReponseConnexion) => {
    await appliquerSession({ acces: tokens.access_token, renouvellement: tokens.refresh_token, utilisateur: user })
  }, [appliquerSession])

  const connecter = useCallback(async (telephone: string, pin: string) => {
    // En démo, un compte fictif se connecte depuis son appareil « habituel »
    // (reconnu par l'anti-fraude) ; sinon, identifiant propre à ce téléphone.
    const compteDemo = infoDemo?.comptes.find((compte) => compte.telephone === telephone)
    const reponse = await api.connexion(telephone, pin, compteDemo?.deviceId || appareilRef.current)
    await ouvrirSession(reponse)
  }, [infoDemo, ouvrirSession])

  const deconnecter = useCallback(async ({ partout = false, silencieux = false } = {}) => {
    const courante = sessionRef.current
    if (courante && !silencieux) {
      try {
        await (partout ? api.deconnexionGlobale() : api.deconnexion(courante.renouvellement))
      } catch {
        // Session déjà fermée côté serveur : la déconnexion locale suffit.
      }
    }
    await appliquerSession(null)
  }, [appliquerSession])

  const definirServeur = useCallback(async (adresse: string) => {
    const base = adresse.trim().replace(/\/+$/, '')
    configurerPont({ base })
    setServeur(base)
    await stockage.ecrire(CLE_SERVEUR, base)
    await appliquerSession(null) // autre serveur : nouvelle connexion nécessaire
    await verifierServeur()
  }, [appliquerSession, verifierServeur])

  const mettreAJourUtilisateur = useCallback(async (champs: Partial<Utilisateur>) => {
    const courante = sessionRef.current
    if (courante) await appliquerSession({ ...courante, utilisateur: { ...courante.utilisateur, ...champs } })
  }, [appliquerSession])

  const valeur = useMemo<ValeurSession>(() => ({
    pret,
    session,
    utilisateur: session?.utilisateur ?? null,
    estAdmin: session?.utilisateur.role === 'ADMIN',
    serveur,
    mode,
    infoDemo,
    connecter,
    ouvrirSession,
    deconnecter,
    definirServeur,
    verifierServeur,
    mettreAJourUtilisateur
  }), [pret, session, serveur, mode, infoDemo, connecter, ouvrirSession, deconnecter, definirServeur, verifierServeur, mettreAJourUtilisateur])

  return <ContexteSession.Provider value={valeur}>{children}</ContexteSession.Provider>
}

export const useSession = (): ValeurSession => {
  const valeur = useContext(ContexteSession)
  if (!valeur) throw new Error('useSession doit être utilisé dans SessionProvider')
  return valeur
}
