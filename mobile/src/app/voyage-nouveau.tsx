import { useMutation } from '@tanstack/react-query'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { messageErreur } from '../api/client'
import { useActualiserTout, usePays } from '../api/requetes'
import { api } from '../api/services'
import { useSession } from '../session/SessionContext'
import { Badge, Bouton, Carte, Champ, Chargement, EnTeteCarte, Ecran, Ligne, Message, Puces, Texte } from '../ui/composants'
import { cleIdempotence, dateLocale, drapeau, formaterTelephone, statutNumero } from '../utils/format'

const REGEX_DATE = /^\d{4}-\d{2}-\d{2}$/
const decaler = (date: string, jours: number) => {
  const resultat = new Date(`${date}T12:00:00`)
  resultat.setDate(resultat.getDate() + jours)
  return `${resultat.getFullYear()}-${String(resultat.getMonth() + 1).padStart(2, '0')}-${String(resultat.getDate()).padStart(2, '0')}`
}

export default function NouveauVoyage () {
  const { session } = useSession()
  const parametres = useLocalSearchParams<{ pays?: string }>()
  const pays = usePays()
  const actualiserTout = useActualiserTout()
  const [destination, setDestination] = useState<string | null>(parametres.pays || null)
  const [depart, setDepart] = useState(dateLocale(0))
  const [dureeRetour, setDureeRetour] = useState<'aucune' | '7' | '14' | '30'>('14')
  // Même clé pour les nouvelles tentatives : jamais deux déclarations pour un double appui.
  const [cle] = useState(cleIdempotence)

  const declaration = useMutation({
    mutationFn: () => api.declarer(destination || '', depart, dureeRetour === 'aucune' ? null : decaler(depart, Number(dureeRetour)), cle),
    onSuccess: () => { void actualiserTout() }
  })

  if (!session) return <Redirect href='/bienvenue' />

  const destinations = (pays.data?.pays || []).filter((p) => p.numerosDisponibles)
  const resultat = declaration.data

  if (resultat) {
    const numero = resultat.numeroVirtuel
    return (
      <Ecran enTeteNavigation>
        <Carte accent>
          <EnTeteCarte icone='checkmark-circle' titre={resultat.message} />
          {numero
            ? (
              <>
                <Ligne libelle='Votre numéro local' valeur={formaterTelephone(numero.did_number)} />
                <Ligne libelle='Statut' valeur={<Badge {...statutNumero(numero.status)} />} />
                <Texte secondaire>Il s’activera automatiquement dès votre arrivée. Pensez à configurer le renvoi de vos appels.</Texte>
              </>
              )
            : <Texte secondaire>Ce voyage était déjà déclaré : rien n’a été modifié.</Texte>}
        </Carte>
        {numero ? <Bouton titre='Configurer mes renvois' icone='call-outline' surAppui={() => router.replace(`/numero/${numero.number_id}`)} /> : null}
        <Bouton titre='Terminer' variante='secondaire' surAppui={() => router.back()} />
      </Ecran>
    )
  }

  return (
    <Ecran enTeteNavigation>
      <Texte secondaire>Votre numéro local est préparé dès maintenant et s’active à l’atterrissage.</Texte>
      {pays.isPending
        ? <Chargement texte='Chargement des destinations…' />
        : <Puces libelle='Destination' valeur={destination} surChoix={setDestination} options={destinations.map((p) => ({ valeur: p.code, texte: `${drapeau(p.code)} ${p.nom}` }))} />}
      <Puces
        libelle='Date de départ'
        valeur={depart === dateLocale(0) ? 'j0' : depart === dateLocale(1) ? 'j1' : depart === dateLocale(7) ? 'j7' : null}
        surChoix={(choix) => setDepart(dateLocale(Number(choix.slice(1))))}
        options={[{ valeur: 'j0', texte: "Aujourd'hui" }, { valeur: 'j1', texte: 'Demain' }, { valeur: 'j7', texte: 'Dans 7 jours' }]}
      />
      <Champ libelle='Ou une autre date (AAAA-MM-JJ)' value={depart} onChangeText={setDepart} autoCapitalize='none' erreur={REGEX_DATE.test(depart) ? null : 'Format attendu : 2026-12-24'} />
      <Puces
        libelle='Durée du séjour'
        valeur={dureeRetour}
        surChoix={setDureeRetour}
        options={[{ valeur: '7', texte: '1 semaine' }, { valeur: '14', texte: '2 semaines' }, { valeur: '30', texte: '1 mois' }, { valeur: 'aucune', texte: 'Retour non fixé' }]}
      />
      <Message texte={declaration.error ? messageErreur(declaration.error) : null} ton='danger' />
      <Bouton titre='Déclarer le voyage' icone='airplane' chargement={declaration.isPending} desactive={!destination || !REGEX_DATE.test(depart)} surAppui={() => declaration.mutate()} />
    </Ecran>
  )
}
