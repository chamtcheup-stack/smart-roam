import { Redirect, Stack } from 'expo-router'
import { useSession } from '../../session/SessionContext'
import { useTheme } from '../../ui/theme'

export default function MiseEnPageAuthentification () {
  const { pret, session } = useSession()
  const { couleurs } = useTheme()
  if (pret && session) return <Redirect href='/' />
  return (
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
      <Stack.Screen name='bienvenue' options={{ headerShown: false }} />
      <Stack.Screen name='connexion' options={{ title: 'Connexion' }} />
      <Stack.Screen name='inscription' options={{ title: 'Créer un compte' }} />
      <Stack.Screen name='pin-oublie' options={{ title: 'PIN oublié' }} />
    </Stack>
  )
}
