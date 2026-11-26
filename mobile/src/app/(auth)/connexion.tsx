import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { messageErreur } from '../../api/client'
import { useSession } from '../../session/SessionContext'
import { Bouton, Champ, ChampCode, Ecran, Message, Texte } from '../../ui/composants'
import { normaliserTelephone, telephoneValide } from '../../utils/format'

export default function Connexion () {
  const { connecter } = useSession()
  const parametres = useLocalSearchParams<{ message?: string; telephone?: string }>()
  const [telephone, setTelephone] = useState(parametres.telephone || '')
  const [pin, setPin] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)

  const numero = normaliserTelephone(telephone)
  const saisieValide = telephoneValide(numero) && pin.length === 4

  const seConnecter = async () => {
    setErreur(null)
    setEnvoi(true)
    try {
      await connecter(numero, pin)
      router.replace('/')
    } catch (e) {
      setPin('')
      setErreur(messageErreur(e))
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <Ecran enTeteNavigation>
      <Message texte={parametres.message} ton='succes' />
      <Texte secondaire>Saisissez votre numéro Orange au format international et votre code PIN à 4 chiffres.</Texte>
      <Champ
        libelle='Numéro de téléphone'
        value={telephone}
        onChangeText={setTelephone}
        keyboardType='phone-pad'
        autoComplete='tel'
        textContentType='telephoneNumber'
        placeholder='+237 6 90 00 00 01'
        erreur={telephone && !telephoneValide(numero) ? 'Format attendu : +indicatif suivi du numéro' : null}
      />
      <ChampCode libelle='Code PIN' valeur={pin} surChangement={setPin} />
      <Message texte={erreur} ton='danger' />
      <Bouton titre='Se connecter' icone='log-in-outline' surAppui={seConnecter} chargement={envoi} desactive={!saisieValide} />
      <Bouton titre='PIN oublié ?' variante='discret' surAppui={() => router.push({ pathname: '/pin-oublie', params: { telephone } })} />
      <Bouton titre='Pas encore de compte ? Créer un compte' variante='discret' surAppui={() => router.replace('/inscription')} />
    </Ecran>
  )
}
