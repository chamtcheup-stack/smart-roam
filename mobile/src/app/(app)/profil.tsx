import { useMutation } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { messageErreur } from '../../api/client'
import { useActualiserTout, useConsentements } from '../../api/requetes'
import { api } from '../../api/services'
import type { Consentement } from '../../api/types'
import { oublierJetonSensible } from '../../composants/ConfirmationPIN'
import { EtatServeur } from '../../composants/EtatServeur'
import { useSession } from '../../session/SessionContext'
import { Avatar, Badge, Bouton, Carte, Champ, ChampCode, Chargement, EnTeteCarte, Ecran, EtatVide, Message, Rangee, Texte, Titre } from '../../ui/composants'
import { espace } from '../../ui/theme'
import { drapeau, formaterDate, formaterTelephone, libelleTypeDonnee, nomPays } from '../../utils/format'
import { verifierNouveauPin } from '../../utils/pin'

export default function Profil () {
  const { utilisateur, deconnecter } = useSession()
  const [sortie, setSortie] = useState<'session' | 'partout' | null>(null)
  if (!utilisateur) return null

  const seDeconnecter = async (partout: boolean) => {
    setSortie(partout ? 'partout' : 'session')
    oublierJetonSensible()
    await deconnecter({ partout })
    router.replace('/bienvenue')
  }

  return (
    <Ecran>
      <View style={{ alignItems: 'center', gap: espace.s }}>
        <Avatar nom={utilisateur.display_name || 'Smart Roam'} tailleCercle={72} />
        <Titre niveau={2}>{utilisateur.display_name || 'Mon compte'}</Titre>
        <Texte secondaire>{formaterTelephone(utilisateur.phone_number)}</Texte>
        <Rangee>
          <Badge texte={`${drapeau(utilisateur.country_of_residence)} ${nomPays(utilisateur.country_of_residence)}`} />
          <Badge texte={utilisateur.kyc_status === 'VERIFIED' ? 'Identité vérifiée' : 'Identité en cours de vérification'} ton={utilisateur.kyc_status === 'VERIFIED' ? 'succes' : 'alerte'} />
          {utilisateur.role === 'ADMIN' ? <Badge texte='Support' ton='info' /> : null}
        </Rangee>
      </View>

      <NomAffiche />
      <Confidentialite />
      <ChangementPin />

      <Carte>
        <EnTeteCarte icone='log-out-outline' titre='Session' />
        <Bouton titre='Se déconnecter' variante='secondaire' chargement={sortie === 'session'} surAppui={() => { void seDeconnecter(false) }} />
        <Bouton titre='Déconnecter tous mes appareils' variante='danger' chargement={sortie === 'partout'} surAppui={() => { void seDeconnecter(true) }} />
      </Carte>

      <EtatServeur />
      <Texte petit secondaire centre>Smart Roam · version 1.0.0</Texte>
    </Ecran>
  )
}

function NomAffiche () {
  const { utilisateur, mettreAJourUtilisateur } = useSession()
  const actualiserTout = useActualiserTout()
  const [nom, setNom] = useState(utilisateur?.display_name || '')
  const modification = useMutation({
    mutationFn: () => api.modifierNom(utilisateur?.user_id || '', nom.trim()),
    onSuccess: async (resultat) => {
      await mettreAJourUtilisateur({ display_name: resultat.user.display_name })
      void actualiserTout()
    }
  })
  return (
    <Carte>
      <EnTeteCarte icone='id-card-outline' titre='Nom affiché' />
      <Texte petit secondaire>Présenté à vos correspondants à l’étranger (profil miroir), si vous l’acceptez.</Texte>
      <Champ libelle='Prénom et nom' value={nom} onChangeText={setNom} autoCapitalize='words' maxLength={60} />
      <Message texte={modification.error ? messageErreur(modification.error) : null} ton='danger' />
      {modification.data
        ? <Message texte={`Nom enregistré${modification.data.profilsMiroirSynchronises ? ` ; ${modification.data.profilsMiroirSynchronises} profil(s) miroir mis à jour` : ''}.`} ton='succes' />
        : null}
      <Bouton titre='Enregistrer' compact chargement={modification.isPending} desactive={nom.trim().length < 2 || nom.trim() === (utilisateur?.display_name || '')} surAppui={() => modification.mutate()} />
    </Carte>
  )
}

function Confidentialite () {
  const consentements = useConsentements()
  return (
    <Carte>
      <EnTeteCarte icone='shield-outline' titre='Confidentialité' />
      <Texte petit secondaire>Données partagées avec vos correspondants, par pays. Vous pouvez retirer un accord à tout moment.</Texte>
      {consentements.isPending ? <Chargement /> : null}
      <Message texte={consentements.error ? messageErreur(consentements.error) : null} ton='danger' />
      {consentements.isSuccess && consentements.data.length === 0 ? <EtatVide icone='shield-checkmark-outline' texte='Aucune donnée partagée pour le moment.' /> : null}
      {(consentements.data || []).map((consentement) => (
        <LigneConsentement key={`${consentement.destination_country}-${consentement.data_type}`} consentement={consentement} />
      ))}
    </Carte>
  )
}

function LigneConsentement ({ consentement }: { consentement: Consentement }) {
  const actualiserTout = useActualiserTout()
  const retrait = useMutation({
    mutationFn: () => api.changerConsentement(consentement.destination_country, consentement.data_type, consentement.etat !== 'ACCORDE'),
    onSuccess: () => { void actualiserTout() }
  })
  const libelles = { ACCORDE: { texte: 'Accordé', ton: 'succes' as const }, REFUSE: { texte: 'Retiré', ton: 'neutre' as const }, EXPIRE: { texte: 'Expiré', ton: 'alerte' as const } }
  return (
    <View style={{ gap: espace.xs }}>
      <Rangee>
        <Texte gras>{drapeau(consentement.destination_country)} {libelleTypeDonnee[consentement.data_type] || consentement.data_type}</Texte>
        <Badge {...libelles[consentement.etat]} />
      </Rangee>
      <Texte petit secondaire>
        {consentement.legal_basis === 'CONTRACTUAL' ? 'Nécessaire au service (30 jours)' : 'Votre accord'}
        {consentement.expires_at ? ` · jusqu'au ${formaterDate(consentement.expires_at)}` : ''}
      </Texte>
      <Bouton compact variante={consentement.etat === 'ACCORDE' ? 'danger' : 'secondaire'} titre={consentement.etat === 'ACCORDE' ? 'Retirer mon accord' : 'Accorder'} chargement={retrait.isPending} surAppui={() => retrait.mutate()} />
      <Message texte={retrait.error ? messageErreur(retrait.error) : null} ton='danger' />
    </View>
  )
}

function ChangementPin () {
  const { deconnecter } = useSession()
  const [ouvert, setOuvert] = useState(false)
  const [ancien, setAncien] = useState('')
  const [nouveau, setNouveau] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const erreurPin = nouveau.length === 4 ? verifierNouveauPin(nouveau, confirmation) : null
  const changement = useMutation({
    mutationFn: () => api.changerPin(ancien, nouveau),
    onSuccess: async () => {
      // Le serveur ferme toutes les sessions après un changement de PIN.
      oublierJetonSensible()
      await deconnecter({ silencieux: true })
      router.replace({ pathname: '/connexion', params: { message: 'PIN modifié : reconnectez-vous avec votre nouveau PIN.' } })
    },
    onError: () => setAncien('')
  })

  return (
    <Carte>
      <EnTeteCarte icone='key-outline' titre='Code PIN' />
      {!ouvert
        ? <Bouton compact variante='secondaire' titre='Changer mon PIN' surAppui={() => setOuvert(true)} />
        : (
          <>
            <ChampCode libelle='PIN actuel' valeur={ancien} surChangement={setAncien} />
            <ChampCode libelle='Nouveau PIN' valeur={nouveau} surChangement={setNouveau} />
            <ChampCode libelle='Confirmez le nouveau PIN' valeur={confirmation} surChangement={setConfirmation} erreur={erreurPin} />
            <Message texte={changement.error ? messageErreur(changement.error) : null} ton='danger' />
            <Texte petit secondaire>Vous serez déconnecté de tous vos appareils.</Texte>
            <Bouton titre='Changer le PIN' chargement={changement.isPending} desactive={ancien.length !== 4 || confirmation !== nouveau || Boolean(erreurPin)} surAppui={() => changement.mutate()} />
            <Bouton titre='Annuler' variante='discret' surAppui={() => setOuvert(false)} />
          </>
          )}
    </Carte>
  )
}
