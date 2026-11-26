import { useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native'
import { messageErreur } from '../api/client'
import { api } from '../api/services'
import { Bouton, ChampCode, Message, Texte, Titre } from '../ui/composants'
import { espace, rayon, useTheme } from '../ui/theme'

// Jeton d'opération sensible (5 min côté serveur) conservé 4 min en mémoire :
// plusieurs opérations rapprochées ne redemandent pas le PIN. Jamais stocké.
let jetonEnMemoire: { jeton: string; expireA: number } | null = null

export const jetonSensibleValide = (): string | null =>
  jetonEnMemoire && jetonEnMemoire.expireA > Date.now() ? jetonEnMemoire.jeton : null

export const oublierJetonSensible = () => {
  jetonEnMemoire = null
}

interface Proprietes {
  visible: boolean
  titre: string
  description: string
  surConfirmation: (jetonSensible: string) => void
  surAnnulation: () => void
}

// Demande le PIN et fournit le jeton sensible exigé par l'API (conversion de
// devises, suppression du compte). Le contenu est recréé à chaque ouverture :
// aucun PIN ni message d'erreur ne subsiste d'une fois sur l'autre.
export function ConfirmationPIN ({ visible, ...proprietes }: Proprietes) {
  return (
    <Modal visible={visible} transparent animationType='slide' onRequestClose={proprietes.surAnnulation}>
      {visible ? <ContenuConfirmation {...proprietes} /> : null}
    </Modal>
  )
}

function ContenuConfirmation ({ titre, description, surConfirmation, surAnnulation }: Omit<Proprietes, 'visible'>) {
  const { couleurs } = useTheme()
  const [pin, setPin] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)

  const valider = async () => {
    setEnvoi(true)
    setErreur(null)
    try {
      const reponse = await api.verifierPin(pin)
      if (reponse.valide && reponse.jetonSensible) {
        jetonEnMemoire = {
          jeton: reponse.jetonSensible.access_token,
          expireA: Date.now() + Math.max(0, reponse.jetonSensible.expires_in - 60) * 1000
        }
        surConfirmation(reponse.jetonSensible.access_token)
      } else {
        setPin('')
        setErreur(reponse.tentativesRestantes !== undefined
          ? `PIN incorrect : ${reponse.tentativesRestantes} essai(s) restant(s) avant verrouillage`
          : 'PIN incorrect')
      }
    } catch (e) {
      setPin('')
      setErreur(messageErreur(e)) // 429 : PIN verrouillé, délai indiqué
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Pressable accessibilityLabel='Fermer' onPress={surAnnulation} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} />
      <View style={{ backgroundColor: couleurs.surface, borderTopLeftRadius: rayon.l, borderTopRightRadius: rayon.l, padding: espace.xl, gap: espace.l }}>
        <Titre niveau={2}>{titre}</Titre>
        <Texte secondaire>{description}</Texte>
        <ChampCode libelle='Votre code PIN' valeur={pin} surChangement={setPin} autoFocus />
        <Message texte={erreur} ton='danger' />
        <Bouton titre='Confirmer' icone='lock-closed' surAppui={valider} chargement={envoi} desactive={pin.length !== 4} />
        <Bouton titre='Annuler' variante='discret' surAppui={surAnnulation} />
      </View>
    </KeyboardAvoidingView>
  )
}
