import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { ErreurApi } from '../api/client'
import { SessionProvider, useSession } from '../session/SessionContext'
import { useTheme } from '../ui/theme'

// Pas de nouvel essai sur une erreur 4xx (droits, validation, session).
const creerClientRequetes = () => new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (essais, erreur) => !(erreur instanceof ErreurApi && erreur.statut >= 400 && erreur.statut < 500) && essais < 2
    },
    mutations: { retry: false }
  }
})

// Données d'un autre compte jamais affichées après un changement de session.
function ViderCacheAuChangementDeCompte () {
  const { utilisateur } = useSession()
  const client = useQueryClient()
  const identifiant = utilisateur?.user_id ?? null
  useEffect(() => {
    client.clear()
  }, [identifiant, client])
  return null
}

function Navigation () {
  const { couleurs, sombre } = useTheme()
  return (
    <>
      <StatusBar style={sombre ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: couleurs.surface },
          headerTintColor: couleurs.texte,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          headerBackTitle: 'Retour',
          contentStyle: { backgroundColor: couleurs.fond }
        }}
      >
        <Stack.Screen name='(app)' options={{ headerShown: false }} />
        <Stack.Screen name='(auth)' options={{ headerShown: false }} />
        <Stack.Screen name='numero/[numberId]' options={{ title: 'Mon numéro' }} />
        <Stack.Screen name='voyage-nouveau' options={{ title: 'Déclarer un voyage', presentation: 'modal' }} />
        <Stack.Screen name='serveur' options={{ title: 'Adresse du serveur', presentation: 'modal' }} />
      </Stack>
    </>
  )
}

export default function RacineApplication () {
  const [clientRequetes] = useState(creerClientRequetes)
  return (
    <QueryClientProvider client={clientRequetes}>
      <SessionProvider>
        <ViderCacheAuChangementDeCompte />
        <Navigation />
      </SessionProvider>
    </QueryClientProvider>
  )
}
