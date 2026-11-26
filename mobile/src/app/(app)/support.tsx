import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { View } from 'react-native'
import { messageErreur } from '../../api/client'
import { api } from '../../api/services'
import type { AlerteFraude, Pool } from '../../api/types'
import { JaugeStock } from '../../composants/JaugeStock'
import { useSession } from '../../session/SessionContext'
import { Badge, Bouton, Carte, Chargement, EnTeteCarte, Ecran, EtatVide, Message, Rangee, Separateur, Texte, Titre } from '../../ui/composants'
import { espace } from '../../ui/theme'
import { drapeau, formaterDateHeure, formaterMontant, formaterNombre, formaterTelephone, statutNumero } from '../../utils/format'

const TYPES_ALERTE: Record<string, string> = {
  AMOUNT: 'Montant inhabituel',
  FREQUENCY: 'Fréquence anormale',
  LOCATION: 'Pays inhabituel',
  DEVICE: 'Nouvel appareil',
  ML_DETECTION: 'Comportement atypique'
}
const ACTIONS_ALERTE: Record<string, string> = { SUSPEND_NUMBER: 'Numéro suspendu', ALERT_ONLY: 'Alerte silencieuse' }
const LIVRAISON_STANDARD = 10_000

export default function Support () {
  const { estAdmin } = useSession()
  const pools = useQuery({ queryKey: ['pools'], queryFn: async () => (await api.pools()).pools, enabled: estAdmin })
  const alertes = useQuery({ queryKey: ['alertes'], queryFn: api.alertesFraude, enabled: estAdmin })
  const analyse = useMutation({ mutationFn: api.lancerJIT, onSuccess: () => { void pools.refetch() } })

  if (!estAdmin) return <Ecran><Message texte='Espace réservé au support Orange.' ton='info' /></Ecran>

  return (
    <Ecran surActualiser={() => { void pools.refetch(); void alertes.refetch() }} actualisation={pools.isRefetching || alertes.isRefetching}>
      <Titre>Espace support</Titre>

      <Carte>
        <EnTeteCarte icone='layers-outline' titre='Stocks de numéros' />
        {pools.isPending ? <Chargement /> : null}
        <Message texte={pools.error ? messageErreur(pools.error) : null} ton='danger' />
        {(pools.data || []).map((pool) => <LignePool key={pool.pool_id} pool={pool} />)}
        <Separateur />
        <Texte petit secondaire>Le réapprovisionnement juste-à-temps commande auprès du meilleur partenaire dès 90 % d’occupation ou 7 jours de stock.</Texte>
        <Bouton titre="Lancer l'analyse des stocks" icone='analytics-outline' variante='secondaire' chargement={analyse.isPending} surAppui={() => analyse.mutate()} />
        {analyse.data
          ? analyse.data.rapport.map((ligne) => (
            <Texte key={ligne.poolId} petit>
              {drapeau(ligne.pays)} {ligne.pays} : {ligne.action === 'COMMANDE_PASSEE' ? `commande de ${formaterNombre(ligne.quantite || 0, 0)} numéros auprès de ${ligne.partenaire}` : ligne.action === 'OK' ? 'stock suffisant' : ligne.action.toLowerCase().replace(/_/g, ' ')}
            </Texte>
          ))
          : null}
        <Message texte={analyse.error ? messageErreur(analyse.error) : null} ton='danger' />
      </Carte>

      <Carte>
        <EnTeteCarte icone='warning-outline' titre='Alertes de fraude' />
        {alertes.isPending ? <Chargement /> : null}
        <Message texte={alertes.error ? messageErreur(alertes.error) : null} ton='danger' />
        {alertes.data && !alertes.data.disponible ? <Message texte="Table des alertes absente de la base : alertes journalisées uniquement." ton='info' /> : null}
        {alertes.isSuccess && alertes.data.alertes.length === 0 ? <EtatVide icone='shield-checkmark-outline' texte='Aucune alerte.' /> : null}
        {(alertes.data?.alertes || []).map((alerte, index) => <LigneAlerte key={alerte.alert_id || index} alerte={alerte} />)}
      </Carte>
    </Ecran>
  )
}

function LignePool ({ pool }: { pool: Pool }) {
  const livraison = useMutation({ mutationFn: () => api.confirmerLivraison(pool.pool_id, LIVRAISON_STANDARD) })
  const statut = livraison.data?.pool || pool
  return (
    <View style={{ gap: espace.xs }}>
      <JaugeStock
        pays={statut.country_iso}
        pourcentage={statut.tauxOccupationValeur * 100}
        reapprovisionnement={statut.reorder_status}
        detail={`${formaterNombre(statut.numerosDisponibles, 0)} numéros libres sur ${formaterNombre(statut.total_numbers, 0)}`}
      />
      {statut.reorder_status === 'REORDER_PENDING'
        ? <Bouton compact variante='secondaire' titre={`Confirmer la livraison (${formaterNombre(LIVRAISON_STANDARD, 0)} numéros)`} chargement={livraison.isPending} surAppui={() => livraison.mutate()} />
        : null}
      <Message texte={livraison.error ? messageErreur(livraison.error) : null} ton='danger' />
    </View>
  )
}

function LigneAlerte ({ alerte }: { alerte: AlerteFraude }) {
  const [ouverte, setOuverte] = useState(false)
  const numeros = useQuery({ queryKey: ['numeros-client', alerte.user_id], queryFn: async () => (await api.numerosDe(alerte.user_id)).numeros, enabled: ouverte })
  const reactivation = useMutation({ mutationFn: api.reactiverNumero, onSuccess: () => { void numeros.refetch() } })
  const declencheur = alerte.triggered_by

  return (
    <View style={{ gap: espace.xs, paddingVertical: espace.xs }}>
      <Rangee>
        <Texte gras>{TYPES_ALERTE[alerte.alert_type] || alerte.alert_type}</Texte>
        <Badge texte={`Score ${alerte.anomaly_score}/100`} ton={alerte.anomaly_score >= 80 ? 'danger' : 'alerte'} />
      </Rangee>
      <Texte petit secondaire>
        {ACTIONS_ALERTE[alerte.action_taken] || alerte.action_taken}
        {declencheur?.montant ? ` · ${formaterMontant(declencheur.montant, declencheur.devise || 'XAF')}` : ''}
        {declencheur?.pays ? ` · ${drapeau(declencheur.pays)} ${declencheur.pays}` : ''}
        {alerte.created_at ? ` · ${formaterDateHeure(alerte.created_at)}` : ''}
      </Texte>
      {!ouverte
        ? <Bouton compact variante='discret' titre='Voir les numéros du client' surAppui={() => setOuverte(true)} />
        : (
          <>
            {numeros.isPending ? <Chargement /> : null}
            {(numeros.data || []).map((numero) => (
              <Rangee key={numero.number_id}>
                <Texte>{drapeau(numero.country_iso)} {formaterTelephone(numero.did_number)}</Texte>
                <Badge {...statutNumero(numero.status)} />
                {numero.status === 'SUSPENDED'
                  ? <Bouton compact titre='Lever la suspension' chargement={reactivation.isPending} surAppui={() => reactivation.mutate(numero.number_id)} />
                  : null}
              </Rangee>
            ))}
            <Texte petit secondaire>Levez une suspension seulement après avoir vérifié l’identité du titulaire.</Texte>
          </>
          )}
      <Message texte={reactivation.data ? `${reactivation.data.message} : ${statutNumero(reactivation.data.numero.status).texte.toLowerCase()}` : null} ton='succes' />
      <Message texte={reactivation.error ? messageErreur(reactivation.error) : null} ton='danger' />
    </View>
  )
}
