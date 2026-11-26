import { router } from 'expo-router'
import { useState } from 'react'
import { messageErreur } from '../../api/client'
import { useActualiserTout, useNumeros } from '../../api/requetes'
import { Badge, Bouton, Carte, Chargement, EnTeteCarte, Ecran, EtatVide, Ligne, Message, Texte, Titre } from '../../ui/composants'
import { drapeau, formaterDate, formaterTelephone, nomPays, statutNumero } from '../../utils/format'

export default function Numeros () {
  const numeros = useNumeros()
  const actualiserTout = useActualiserTout()
  const [actualisation, setActualisation] = useState(false)

  const actualiser = async () => {
    setActualisation(true)
    await actualiserTout()
    setActualisation(false)
  }

  return (
    <Ecran surActualiser={actualiser} actualisation={actualisation}>
      <Titre>Mes numéros</Titre>
      <Texte secondaire>Un numéro local par pays visité. Il vous reste acquis entre deux voyages (en parking).</Texte>
      {numeros.isPending ? <Chargement /> : null}
      <Message texte={numeros.error ? messageErreur(numeros.error) : null} ton='danger' />
      {numeros.isSuccess && numeros.data.length === 0
        ? (
          <>
            <EtatVide icone='call-outline' texte='Déclarez un voyage pour obtenir votre premier numéro local.' />
            <Bouton titre='Déclarer un voyage' icone='add' surAppui={() => router.push('/voyage-nouveau')} />
          </>
          )
        : null}
      {(numeros.data || []).map((numero) => (
        <Carte key={numero.number_id} accent={numero.status === 'ACTIVE'}>
          <EnTeteCarte titre={`${drapeau(numero.country_iso)} ${formaterTelephone(numero.did_number)}`} droite={<Badge {...statutNumero(numero.status)} />} />
          <Ligne libelle='Pays' valeur={nomPays(numero.country_iso)} />
          {numero.mirror_display_name ? <Ligne libelle='Nom affiché' valeur={numero.mirror_display_name} /> : null}
          {numero.activated_at ? <Ligne libelle='Dernière activation' valeur={formaterDate(numero.activated_at)} /> : null}
          <Bouton compact variante='secondaire' titre='Renvois, profil miroir, eSIM' icone='settings-outline' surAppui={() => router.push(`/numero/${numero.number_id}`)} />
        </Carte>
      ))}
    </Ecran>
  )
}
