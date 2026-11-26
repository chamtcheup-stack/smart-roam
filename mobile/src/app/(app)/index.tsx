import { useMutation } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { messageErreur } from '../../api/client'
import { useActualiserTout, useDeclarations, useNumeros, useSuggestion } from '../../api/requetes'
import { api } from '../../api/services'
import type { ResultatArrivee } from '../../api/types'
import { useSession } from '../../session/SessionContext'
import { Avatar, Badge, Bouton, Carte, Chargement, ElementListe, EnTeteCarte, Ecran, Ligne, Message, Rangee, Texte, Titre } from '../../ui/composants'
import { espace } from '../../ui/theme'
import { drapeau, formaterDate, formaterNombre, formaterTelephone, nomPays, statutNumero, statutVoyage } from '../../utils/format'
import { collecterSignaux, signauxDisponibles } from '../../utils/signaux'

export default function Accueil () {
  const { utilisateur, mode, estAdmin } = useSession()
  const declarations = useDeclarations()
  const numeros = useNumeros()
  const actualiserTout = useActualiserTout()
  const [actualisation, setActualisation] = useState(false)

  const voyageActif = (declarations.data || []).find((d) => d.status === 'PENDING' || d.status === 'CONFIRMED') || null
  const suggestion = useSuggestion(!estAdmin && declarations.isSuccess && !voyageActif)
  const numeroDuVoyage = voyageActif ? (numeros.data || []).find((n) => n.number_id === voyageActif.number_id) : undefined
  const prenom = (utilisateur?.display_name || '').split(' ')[0]

  const refuserSuggestion = useMutation({
    mutationFn: (paysISO: string) => api.retourSuggestion(paysISO, false),
    onSuccess: () => { void suggestion.refetch() }
  })

  const actualiser = async () => {
    setActualisation(true)
    await actualiserTout()
    setActualisation(false)
  }

  return (
    <Ecran surActualiser={actualiser} actualisation={actualisation}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: espace.m }}>
        <Avatar nom={utilisateur?.display_name || 'Smart Roam'} />
        <View style={{ flex: 1, gap: 2 }}>
          <Titre niveau={2}>{prenom ? `Bonjour ${prenom}` : 'Bonjour'}</Titre>
          <Texte secondaire>{drapeau(utilisateur?.country_of_residence)} Résident {nomPays(utilisateur?.country_of_residence)}</Texte>
        </View>
        {mode === 'demo' ? <Badge texte='DÉMO' ton='primaire' /> : null}
      </View>

      {estAdmin
        ? (
          <Carte accent>
            <EnTeteCarte icone='shield-checkmark-outline' titre='Espace support Orange' />
            <Texte>Stocks de numéros, réapprovisionnement et alertes de fraude des clients.</Texte>
            <Bouton titre="Ouvrir l'espace support" icone='arrow-forward' surAppui={() => router.push('/support')} />
          </Carte>
          )
        : null}

      {!estAdmin && declarations.isPending ? <Chargement /> : null}
      <Message texte={declarations.error ? messageErreur(declarations.error) : null} ton='danger' />

      {voyageActif
        ? (
          <Carte accent>
            <EnTeteCarte icone='airplane' titre='Voyage en cours' droite={<Badge {...badgeVoyage(voyageActif.status)} />} />
            <Titre niveau={2}>{drapeau(voyageActif.destination_country)} {nomPays(voyageActif.destination_country)}</Titre>
            <Ligne libelle='Départ' valeur={formaterDate(voyageActif.departure_date)} />
            <Ligne libelle='Retour' valeur={formaterDate(voyageActif.return_date)} />
            {numeroDuVoyage
              ? <Ligne libelle='Numéro local' valeur={<Badge {...badgeNumero(numeroDuVoyage.status, formaterTelephone(numeroDuVoyage.did_number))} />} />
              : null}
            <Texte secondaire petit>
              {voyageActif.status === 'PENDING'
                ? 'Votre numéro local s\'activera automatiquement dès votre arrivée, grâce aux signaux du réseau.'
                : 'Vous êtes sur place : votre numéro local reçoit vos appels.'}
            </Texte>
            {numeroDuVoyage ? <Bouton titre='Gérer ce numéro' variante='secondaire' surAppui={() => router.push(`/numero/${numeroDuVoyage.number_id}`)} /> : null}
          </Carte>
          )
        : null}

      {!estAdmin && declarations.isSuccess && !voyageActif
        ? (
          <Carte accent={Boolean(suggestion.data?.suggestion)}>
            {suggestion.data?.suggestion
              ? (
                <>
                  <EnTeteCarte icone='sparkles' titre='Votre prochain voyage ?' />
                  <Titre niveau={2}>{drapeau(suggestion.data.suggestion.paysISO)} {suggestion.data.suggestion.nomPays}</Titre>
                  <Texte secondaire>
                    D’après vos {suggestion.data.totalVoyages} derniers voyages, vous partez souvent à cette période
                    (probabilité {formaterNombre(suggestion.data.suggestion.probabiliteValeur * 100, 1)}{' %'}).
                  </Texte>
                  <Rangee>
                    <Bouton compact titre='Déclarer ce voyage' icone='add' surAppui={() => router.push({ pathname: '/voyage-nouveau', params: { pays: suggestion.data?.suggestion?.paysISO } })} />
                    <Bouton compact variante='discret' titre='Pas cette fois' chargement={refuserSuggestion.isPending} surAppui={() => refuserSuggestion.mutate(suggestion.data?.suggestion?.paysISO || '')} />
                  </Rangee>
                </>
                )
              : (
                <>
                  <EnTeteCarte icone='airplane-outline' titre='Aucun voyage prévu' />
                  <Texte secondaire>Déclarez votre prochain voyage : votre numéro local sera prêt avant le départ.</Texte>
                  <Bouton titre='Déclarer un voyage' icone='add' surAppui={() => router.push('/voyage-nouveau')} />
                </>
                )}
          </Carte>
          )
        : null}

      {!estAdmin && (numeros.data || []).length > 0
        ? (
          <Carte>
            <EnTeteCarte icone='call-outline' titre='Mes numéros' />
            {(numeros.data || []).slice(0, 4).map((numero) => (
              <ElementListe
                key={numero.number_id}
                titre={`${drapeau(numero.country_iso)} ${formaterTelephone(numero.did_number)}`}
                sousTitre={statutNumero(numero.status).texte}
                surAppui={() => router.push(`/numero/${numero.number_id}`)}
              />
            ))}
          </Carte>
          )
        : null}

      {!estAdmin ? <DetectionArrivee demo={mode === 'demo'} surResultat={actualiserTout} /> : null}
    </Ecran>
  )
}

const badgeVoyage = (statut: string) => statutVoyage(statut)
const badgeNumero = (statut: string, numero: string) => ({ texte: `${numero} · ${statutNumero(statut).texte}`, ton: statutNumero(statut).ton })

// Détection d'arrivée : en démo, le panneau Démo simule les signaux d'un pays ;
// sinon, les signaux lisibles par le téléphone sont envoyés au serveur.
function DetectionArrivee ({ demo, surResultat }: { demo: boolean; surResultat: () => void }) {
  const [resultat, setResultat] = useState<ResultatArrivee | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)

  const analyser = async () => {
    setErreur(null)
    setResultat(null)
    setEnvoi(true)
    try {
      const signaux = await collecterSignaux()
      if (!signauxDisponibles(signaux)) {
        setErreur('Aucun signal réseau lisible sur cet appareil (iOS et navigateur ne les exposent pas). Utilisez un téléphone Android, ou le mode démo.')
        return
      }
      setResultat(await api.envoyerSignaux(signaux))
      surResultat()
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <Carte>
      <EnTeteCarte icone='locate-outline' titre="Détection d'arrivée" />
      <Texte secondaire petit>
        {demo
          ? 'En démonstration, ouvrez l\'onglet Démo pour simuler une arrivée dans un pays (réseau, Wi-Fi d\'aéroport, antenne).'
          : 'Smart Roam reconnaît votre arrivée grâce au réseau mobile capté par votre téléphone.'}
      </Texte>
      {demo
        ? <Bouton titre='Simuler une arrivée' variante='secondaire' icone='flask-outline' surAppui={() => router.push('/demo')} />
        : <Bouton titre='Analyser le réseau maintenant' variante='secondaire' icone='cellular' chargement={envoi} surAppui={analyser} />}
      {resultat ? <Message texte={`${resultat.message} (confiance ${resultat.scoreConfiance}/100)`} ton={resultat.decision === 'ARRIVEE_CONFIRMEE' || resultat.decision === 'RETOUR_DETECTE' ? 'succes' : 'info'} /> : null}
      <Message texte={erreur} ton='alerte' />
    </Carte>
  )
}
