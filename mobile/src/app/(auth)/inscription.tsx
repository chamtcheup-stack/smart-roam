import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { messageErreur } from '../../api/client'
import { api } from '../../api/services'
import type { ReponseConnexion } from '../../api/types'
import { useSession } from '../../session/SessionContext'
import { Bouton, Champ, ChampCode, Chargement, Ecran, Message, Puces, Texte, Titre } from '../../ui/composants'
import { drapeau, normaliserTelephone, telephoneValide } from '../../utils/format'
import { verifierNouveauPin } from '../../utils/pin'

type Etape = 'numero' | 'code' | 'pin'

export default function Inscription () {
  const { ouvrirSession } = useSession()
  const pays = useQuery({ queryKey: ['pays'], queryFn: api.pays, staleTime: 5 * 60_000 })
  const [etape, setEtape] = useState<Etape>('numero')
  const [paysResidence, setPaysResidence] = useState<string | null>(null)
  const [telephone, setTelephone] = useState('')
  const [code, setCode] = useState('')
  const [codeDemo, setCodeDemo] = useState<string | null>(null)
  const [inscription, setInscription] = useState<ReponseConnexion | null>(null)
  const [pin, setPin] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)

  const numero = normaliserTelephone(telephone)
  const erreurPin = pin.length === 4 ? verifierNouveauPin(pin, confirmation) : null

  const executer = async (action: () => Promise<void>) => {
    setErreur(null)
    setEnvoi(true)
    try {
      await action()
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setEnvoi(false)
    }
  }

  // 1. Code SMS : prouve que vous possédez ce numéro.
  const demanderCode = () => executer(async () => {
    const reponse = await api.demanderCode(numero, 'INSCRIPTION')
    setCodeDemo(reponse.codeDemo || null)
    setCode(reponse.codeDemo || '')
    setEtape('code')
  })

  // 2. Création du compte avec le code reçu.
  const creerCompte = () => executer(async () => {
    if (!paysResidence) return
    setInscription(await api.inscription(numero, paysResidence, code))
    setEtape('pin')
  })

  // 3. Premier PIN, puis ouverture de la session.
  const definirPin = () => executer(async () => {
    if (!inscription) return
    await api.creerPin(pin, inscription.tokens.access_token)
    await ouvrirSession(inscription)
    router.replace('/')
  })

  return (
    <Ecran enTeteNavigation>
      <Texte secondaire>Étape {etape === 'numero' ? 1 : etape === 'code' ? 2 : 3} sur 3</Texte>

      {etape === 'numero'
        ? (
          <>
            <Titre niveau={2}>Votre numéro</Titre>
            {pays.isPending
              ? <Chargement texte='Chargement des pays…' />
              : (
                <Puces
                  libelle='Pays de résidence'
                  valeur={paysResidence}
                  surChoix={setPaysResidence}
                  options={(pays.data?.pays || []).map((p) => ({ valeur: p.code, texte: `${drapeau(p.code)} ${p.nom}` }))}
                />
                )}
            <Message texte={pays.error ? messageErreur(pays.error) : null} ton='danger' />
            <Champ
              libelle='Numéro de téléphone'
              value={telephone}
              onChangeText={setTelephone}
              keyboardType='phone-pad'
              autoComplete='tel'
              placeholder='+225 07 00 00 00 03'
              erreur={telephone && !telephoneValide(numero) ? 'Format attendu : +indicatif suivi du numéro' : null}
            />
            <Message texte={erreur} ton='danger' />
            <Bouton titre='Recevoir le code par SMS' icone='chatbubble-ellipses-outline' surAppui={demanderCode} chargement={envoi} desactive={!paysResidence || !telephoneValide(numero)} />
          </>
          )
        : null}

      {etape === 'code'
        ? (
          <>
            <Titre niveau={2}>Code reçu par SMS</Titre>
            <Texte secondaire>Saisissez le code à 6 chiffres envoyé au {numero}. Il est valable 5 minutes.</Texte>
            {codeDemo ? <Message texte={`Mode démo : aucun SMS n'est envoyé, votre code est ${codeDemo}.`} ton='primaire' /> : null}
            <ChampCode libelle='Code de vérification' valeur={code} surChangement={setCode} longueur={6} masque={false} autoFocus />
            <Message texte={erreur} ton='danger' />
            <Bouton titre='Créer mon compte' surAppui={creerCompte} chargement={envoi} desactive={code.length !== 6} />
            <Bouton titre='Modifier le numéro' variante='discret' surAppui={() => setEtape('numero')} />
          </>
          )
        : null}

      {etape === 'pin'
        ? (
          <>
            <Titre niveau={2}>Votre code PIN</Titre>
            <Texte secondaire>Il protège vos connexions et confirme vos opérations sensibles. Ne le communiquez à personne.</Texte>
            <ChampCode libelle='Nouveau PIN' valeur={pin} surChangement={setPin} autoFocus />
            <ChampCode libelle='Confirmez le PIN' valeur={confirmation} surChangement={setConfirmation} erreur={erreurPin} />
            <Message texte={erreur} ton='danger' />
            <Bouton titre='Terminer' icone='checkmark' surAppui={definirPin} chargement={envoi} desactive={confirmation !== pin || pin.length !== 4 || Boolean(erreurPin)} />
          </>
          )
        : null}
    </Ecran>
  )
}
