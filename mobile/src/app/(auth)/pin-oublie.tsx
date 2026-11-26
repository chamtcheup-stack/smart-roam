import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { messageErreur } from '../../api/client'
import { api } from '../../api/services'
import { Bouton, Champ, ChampCode, Ecran, Message, Texte, Titre } from '../../ui/composants'
import { normaliserTelephone, telephoneValide } from '../../utils/format'
import { verifierNouveauPin } from '../../utils/pin'

export default function PinOublie () {
  const parametres = useLocalSearchParams<{ telephone?: string }>()
  const [etape, setEtape] = useState<'numero' | 'nouveau'>('numero')
  const [telephone, setTelephone] = useState(parametres.telephone || '')
  const [code, setCode] = useState('')
  const [codeDemo, setCodeDemo] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)

  const numero = normaliserTelephone(telephone)
  const erreurPin = pin.length === 4 ? verifierNouveauPin(pin, confirmation) : null

  const demanderCode = async () => {
    setErreur(null)
    setEnvoi(true)
    try {
      const reponse = await api.demanderCode(numero, 'PIN_OUBLIE')
      setCodeDemo(reponse.codeDemo || null)
      setCode(reponse.codeDemo || '')
      setEtape('nouveau')
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setEnvoi(false)
    }
  }

  const reinitialiser = async () => {
    setErreur(null)
    setEnvoi(true)
    try {
      await api.pinOublie(numero, code, pin)
      router.replace({ pathname: '/connexion', params: { message: 'PIN modifié : connectez-vous avec votre nouveau PIN.', telephone: numero } })
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <Ecran enTeteNavigation>
      {etape === 'numero'
        ? (
          <>
            <Texte secondaire>Nous envoyons un code par SMS au numéro de votre compte pour vérifier qu’il s’agit bien de vous.</Texte>
            <Champ libelle='Numéro de téléphone' value={telephone} onChangeText={setTelephone} keyboardType='phone-pad' autoComplete='tel' placeholder='+237 6 90 00 00 01' />
            <Message texte={erreur} ton='danger' />
            <Bouton titre='Recevoir le code par SMS' icone='chatbubble-ellipses-outline' surAppui={demanderCode} chargement={envoi} desactive={!telephoneValide(numero)} />
          </>
          )
        : (
          <>
            <Titre niveau={2}>Nouveau PIN</Titre>
            <Texte secondaire>Si ce numéro correspond à un compte, un code vient de lui être envoyé.</Texte>
            {codeDemo ? <Message texte={`Mode démo : votre code est ${codeDemo}.`} ton='primaire' /> : null}
            <ChampCode libelle='Code reçu par SMS' valeur={code} surChangement={setCode} longueur={6} masque={false} />
            <ChampCode libelle='Nouveau PIN' valeur={pin} surChangement={setPin} />
            <ChampCode libelle='Confirmez le PIN' valeur={confirmation} surChangement={setConfirmation} erreur={erreurPin} />
            <Message texte={erreur} ton='danger' />
            <Texte petit secondaire>Par sécurité, vos autres appareils seront déconnectés.</Texte>
            <Bouton titre='Enregistrer le nouveau PIN' surAppui={reinitialiser} chargement={envoi} desactive={code.length !== 6 || confirmation !== pin || Boolean(erreurPin)} />
          </>
          )}
    </Ecran>
  )
}
