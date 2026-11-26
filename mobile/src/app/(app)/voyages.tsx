import { useMutation } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { messageErreur } from '../../api/client'
import { useActualiserTout, useDeclarations, useNumeros } from '../../api/requetes'
import { api } from '../../api/services'
import type { Declaration } from '../../api/types'
import { Badge, Bouton, Carte, Chargement, EnTeteCarte, Ecran, EtatVide, Ligne, Message, Rangee, Texte, Titre } from '../../ui/composants'
import { drapeau, formaterDate, formaterTelephone, nomPays, statutVoyage } from '../../utils/format'

export default function Voyages () {
  const declarations = useDeclarations()
  const actualiserTout = useActualiserTout()
  const [actualisation, setActualisation] = useState(false)

  const actualiser = async () => {
    setActualisation(true)
    await actualiserTout()
    setActualisation(false)
  }

  return (
    <Ecran surActualiser={actualiser} actualisation={actualisation}>
      <Titre>Mes voyages</Titre>
      <Bouton titre='Déclarer un voyage' icone='add' surAppui={() => router.push('/voyage-nouveau')} />
      {declarations.isPending ? <Chargement /> : null}
      <Message texte={declarations.error ? messageErreur(declarations.error) : null} ton='danger' />
      {declarations.isSuccess && declarations.data.length === 0
        ? <EtatVide icone='airplane-outline' texte="Aucun voyage pour l'instant. Déclarez le prochain : votre numéro local sera prêt avant le départ." />
        : null}
      {(declarations.data || []).map((declaration) => <CarteVoyage key={declaration.declaration_id} declaration={declaration} />)}
    </Ecran>
  )
}

function CarteVoyage ({ declaration }: { declaration: Declaration }) {
  const numeros = useNumeros()
  const actualiserTout = useActualiserTout()
  const [confirmer, setConfirmer] = useState(false)
  const annulation = useMutation({
    mutationFn: () => api.annulerDeclaration(declaration.declaration_id),
    onSuccess: () => { void actualiserTout() }
  })
  const numero = (numeros.data || []).find((n) => n.number_id === declaration.number_id)
  const enCours = declaration.status === 'PENDING' || declaration.status === 'CONFIRMED'

  return (
    <Carte accent={enCours}>
      <EnTeteCarte
        titre={`${drapeau(declaration.destination_country)} ${nomPays(declaration.destination_country)}`}
        droite={<Badge {...statutVoyage(declaration.status)} />}
      />
      <Ligne libelle='Départ' valeur={formaterDate(declaration.departure_date)} />
      <Ligne libelle='Retour' valeur={formaterDate(declaration.return_date)} />
      {numero ? <Ligne libelle='Numéro' valeur={formaterTelephone(numero.did_number)} /> : null}
      {declaration.arrival_confirmed_at ? <Texte petit secondaire>Arrivée détectée le {formaterDate(declaration.arrival_confirmed_at)}</Texte> : null}
      <Message texte={annulation.error ? messageErreur(annulation.error) : null} ton='danger' />
      {enCours
        ? (
            confirmer
              ? (
                <>
                  <Texte petit>Annuler ce voyage ? Le numéro local reste à vous, en parking.</Texte>
                  <Rangee>
                    <Bouton compact variante='danger' titre="Confirmer l'annulation" chargement={annulation.isPending} surAppui={() => annulation.mutate()} />
                    <Bouton compact variante='discret' titre='Garder le voyage' surAppui={() => setConfirmer(false)} />
                  </Rangee>
                </>
                )
              : <Bouton compact variante='secondaire' titre='Annuler le voyage' surAppui={() => setConfirmer(true)} />
          )
        : null}
    </Carte>
  )
}
