import { router } from 'expo-router'
import { useState } from 'react'
import { adresseParDefaut, useSession } from '../session/SessionContext'
import { Bouton, Champ, Ecran, Message, Texte } from '../ui/composants'

export default function AdresseServeur () {
  const { serveur, definirServeur } = useSession()
  const [adresse, setAdresse] = useState(serveur)
  const [envoi, setEnvoi] = useState(false)
  const valide = /^https?:\/\/[^\s/]+(:\d+)?(\/.*)?$/.test(adresse.trim())

  const enregistrer = async () => {
    setEnvoi(true)
    await definirServeur(adresse)
    setEnvoi(false)
    if (router.canGoBack()) router.back()
  }

  return (
    <Ecran enTeteNavigation>
      <Texte secondaire>
        Pour une démonstration sur téléphone : lancez « npm run demo:serveur » sur l’ordinateur, puis saisissez l’adresse
        « Réseau local » qu’il affiche. Le téléphone doit être connecté au même Wi-Fi.
      </Texte>
      <Champ
        libelle='Adresse du serveur'
        value={adresse}
        onChangeText={setAdresse}
        autoCapitalize='none'
        autoCorrect={false}
        keyboardType='url'
        placeholder='http://192.168.1.20:3000'
        erreur={adresse && !valide ? 'Adresse attendue : http://hôte:port' : null}
      />
      <Message texte='Changer de serveur ferme la session en cours.' ton='info' />
      <Bouton titre='Enregistrer' surAppui={enregistrer} chargement={envoi} desactive={!valide} />
      <Bouton titre="Utiliser l'adresse détectée" variante='secondaire' surAppui={() => setAdresse(adresseParDefaut())} />
    </Ecran>
  )
}
