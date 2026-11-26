import { Ionicons } from '@expo/vector-icons'
import { Redirect } from 'expo-router'
import { Tabs } from 'expo-router/js-tabs'
import { ActivityIndicator, View, type ColorValue } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useSession } from '../../session/SessionContext'
import type { NomIcone } from '../../ui/composants'
import { useTheme } from '../../ui/theme'

const icone = (nom: NomIcone) => function IconeOnglet ({ color, size }: { color: ColorValue; size: number }) {
  return <Ionicons name={nom} color={typeof color === 'string' ? color : undefined} size={size} />
}

export default function MiseEnPageApplication () {
  const { pret, session, mode, estAdmin } = useSession()
  const { couleurs } = useTheme()
  const marges = useSafeAreaInsets()

  if (!pret) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: couleurs.fond }}>
        <ActivityIndicator color={couleurs.primaire} size='large' />
      </View>
    )
  }
  if (!session) return <Redirect href='/bienvenue' />

  // Voyageur : voyages, numéros, argent. Support (ADMIN) : exploitation.
  const voyageur = !estAdmin
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: couleurs.primaire,
        tabBarInactiveTintColor: couleurs.texteSecondaire,
        // Hauteur explicite : icône + libellé lisibles, au-dessus de la barre d'accueil (iPhone).
        tabBarStyle: {
          backgroundColor: couleurs.surface,
          borderTopColor: couleurs.bordure,
          height: 70 + marges.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(marges.bottom, 8)
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: couleurs.fond }
      }}
    >
      <Tabs.Screen name='index' options={{ title: 'Accueil', tabBarIcon: icone('home-outline') }} />
      <Tabs.Screen name='voyages' options={{ title: 'Voyages', href: voyageur ? undefined : null, tabBarIcon: icone('airplane-outline') }} />
      <Tabs.Screen name='numeros' options={{ title: 'Numéros', href: voyageur ? undefined : null, tabBarIcon: icone('call-outline') }} />
      <Tabs.Screen name='argent' options={{ title: 'Argent', href: voyageur ? undefined : null, tabBarIcon: icone('wallet-outline') }} />
      <Tabs.Screen name='support' options={{ title: 'Support', href: estAdmin ? undefined : null, tabBarIcon: icone('shield-checkmark-outline') }} />
      {/* Route toujours définie (lien direct /demo valable pendant la vérification
          du serveur) ; seul le bouton d'onglet est masqué hors mode démo. */}
      <Tabs.Screen name='demo' options={{ title: 'Démo', tabBarItemStyle: mode === 'demo' ? undefined : { display: 'none' }, tabBarIcon: icone('flask-outline') }} />
      <Tabs.Screen name='profil' options={{ title: 'Profil', tabBarIcon: icone('person-circle-outline') }} />
    </Tabs>
  )
}
