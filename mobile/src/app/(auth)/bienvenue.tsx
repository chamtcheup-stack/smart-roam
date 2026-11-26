import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { messageErreur } from '../../api/client'
import type { CompteDemo } from '../../api/types'
import { EtatServeur } from '../../composants/EtatServeur'
import { useSession } from '../../session/SessionContext'
import { Avatar, Badge, Bouton, Carte, EnTeteCarte, Ecran, Message, Texte, Titre, type NomIcone } from '../../ui/composants'
import { espace, rayon, useTheme } from '../../ui/theme'
import { formaterTelephone } from '../../utils/format'

const ATOUTS: { icone: NomIcone; texte: string }[] = [
  { icone: 'airplane-outline', texte: 'Un numéro local dans chaque pays, activé dès l\'atterrissage' },
  { icone: 'call-outline', texte: 'Vos appels renvoyés selon vos propres règles' },
  { icone: 'wallet-outline', texte: 'Internet sur place et change de devises sécurisé par PIN' }
]

export default function Bienvenue () {
  const { couleurs } = useTheme()
  const { mode, infoDemo, connecter } = useSession()
  const [connexionEnCours, setConnexionEnCours] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const connecterCompteDemo = async (compte: CompteDemo) => {
    setErreur(null)
    setConnexionEnCours(compte.cle)
    try {
      await connecter(compte.telephone, compte.pin)
      router.replace('/')
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setConnexionEnCours(null)
    }
  }

  return (
    <Ecran>
      <View style={{ alignItems: 'center', gap: espace.m, paddingTop: espace.xl }}>
        <View style={{ width: 88, height: 88, borderRadius: rayon.l, backgroundColor: couleurs.primaire, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name='globe-outline' size={52} color={couleurs.surPrimaire} />
        </View>
        <Titre>Smart Roam</Titre>
        <Texte secondaire centre>Restez joignable partout, comme chez vous.</Texte>
      </View>

      <Carte>
        {ATOUTS.map((atout) => (
          <View key={atout.icone} style={{ flexDirection: 'row', gap: espace.m, alignItems: 'center' }}>
            <Ionicons name={atout.icone} size={22} color={couleurs.primaire} />
            <View style={{ flex: 1 }}><Texte>{atout.texte}</Texte></View>
          </View>
        ))}
      </Carte>

      <View style={{ gap: espace.m }}>
        <Bouton titre='Se connecter' icone='log-in-outline' surAppui={() => router.push('/connexion')} />
        <Bouton titre='Créer un compte' variante='secondaire' surAppui={() => router.push('/inscription')} />
      </View>

      {mode === 'demo' && infoDemo
        ? (
          <Carte accent>
            <EnTeteCarte icone='flask-outline' titre='Comptes de démonstration' />
            <Texte petit secondaire>Personnages fictifs : touchez un compte pour vous connecter avec son PIN.</Texte>
            <Message texte={erreur} ton='danger' />
            {infoDemo.comptes.map((compte) => (
              <Pressable
                key={compte.cle}
                accessibilityRole='button'
                accessibilityLabel={`Se connecter en tant que ${compte.nom}`}
                disabled={connexionEnCours !== null}
                onPress={() => { void connecterCompteDemo(compte) }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: espace.m,
                  alignItems: 'center',
                  backgroundColor: couleurs.surface,
                  borderRadius: rayon.m,
                  padding: espace.m,
                  opacity: pressed || connexionEnCours === compte.cle ? 0.6 : 1
                })}
              >
                <Avatar nom={compte.nom} couleur={compte.couleur} tailleCercle={48} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: espace.s, flexWrap: 'wrap' }}>
                    <Texte gras>{compte.nom}</Texte>
                    {compte.role === 'ADMIN' ? <Badge texte='Support' ton='info' /> : null}
                  </View>
                  <Texte petit secondaire>{compte.presentation}</Texte>
                  <Texte petit>{formaterTelephone(compte.telephone)} · PIN {compte.pin}</Texte>
                </View>
                <Ionicons name='chevron-forward' size={18} color={couleurs.texteSecondaire} />
              </Pressable>
            ))}
          </Carte>
          )
        : null}

      <EtatServeur />
    </Ecran>
  )
}
