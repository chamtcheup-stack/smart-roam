import { useMutation, useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { messageErreur } from '../../api/client'
import { useActualiserTout } from '../../api/requetes'
import { api } from '../../api/services'
import type { ResultatArrivee, SimulationSignaux } from '../../api/types'
import { oublierJetonSensible } from '../../composants/ConfirmationPIN'
import { JaugeStock } from '../../composants/JaugeStock'
import { useSession } from '../../session/SessionContext'
import { Bouton, Carte, Chargement, EnTeteCarte, Ecran, Ligne, Message, Rangee, Texte, Titre } from '../../ui/composants'
import { espace } from '../../ui/theme'
import { drapeau, nomPays } from '../../utils/format'

const DECISIONS_REUSSIES = ['ARRIVEE_CONFIRMEE', 'RETOUR_DETECTE']

export default function Demo () {
  const { mode, infoDemo, estAdmin, deconnecter } = useSession()
  const actualiserTout = useActualiserTout()
  const [paysEnCours, setPaysEnCours] = useState<string | null>(null)
  const [arrivee, setArrivee] = useState<{ simulation: SimulationSignaux; resultat: ResultatArrivee } | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [confirmerReinitialisation, setConfirmerReinitialisation] = useState(false)

  const etat = useQuery({ queryKey: ['etat-demo'], queryFn: api.etatDemo, enabled: mode === 'demo' })
  const maintenance = useMutation({ mutationFn: api.maintenanceDemo, onSuccess: () => { void actualiserTout() } })
  const reinitialisation = useMutation({
    mutationFn: api.reinitialiserDemo,
    onSuccess: async () => {
      oublierJetonSensible()
      await deconnecter({ silencieux: true })
      router.replace('/bienvenue')
    }
  })

  if (mode !== 'demo') {
    return <Ecran><Message texte="Le serveur n'est pas en mode démo." ton='info' /></Ecran>
  }

  // Le téléphone « capte » les signaux du pays, puis la vraie chaîne de détection décide.
  const teleporter = async (paysISO: string) => {
    setErreur(null)
    setArrivee(null)
    setPaysEnCours(paysISO)
    try {
      const simulation = await api.signauxDemo(paysISO)
      const resultat = await api.envoyerSignaux(simulation.signaux)
      setArrivee({ simulation, resultat })
      void actualiserTout()
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setPaysEnCours(null)
    }
  }

  const rapport = maintenance.data?.rapport

  return (
    <Ecran>
      <Titre>Démonstration</Titre>
      <Texte secondaire>Données fictives : aucun opérateur, aucune base réelle. Ces outils simulent ce qui, en vrai, vient du réseau ou de la plateforme téléphonique.</Texte>

      {!estAdmin
        ? (
          <Carte accent>
            <EnTeteCarte icone='airplane' titre='Simuler une arrivée' />
            <Texte petit secondaire>Le téléphone capte le réseau Orange local, le Wi-Fi de l’aéroport, l’adresse IP du pays et une nouvelle antenne relais.</Texte>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espace.s }}>
              {(infoDemo?.paysSimules || []).map((pays) => (
                <Bouton key={pays} compact variante='secondaire' titre={`${drapeau(pays)} ${nomPays(pays)}`} chargement={paysEnCours === pays} desactive={paysEnCours !== null} surAppui={() => { void teleporter(pays) }} />
              ))}
            </View>
            <Message texte={erreur} ton='danger' />
            {arrivee
              ? (
                <View style={{ gap: espace.s }}>
                  <Texte gras>{arrivee.simulation.lieu}</Texte>
                  <Texte petit secondaire>Réseau {arrivee.simulation.operateur} ({arrivee.simulation.signaux.mcc}-{arrivee.simulation.signaux.mnc}){arrivee.simulation.signaux.ssid ? ` · Wi-Fi ${arrivee.simulation.signaux.ssid}` : ''}</Texte>
                  <Message texte={`${arrivee.resultat.message} (confiance ${arrivee.resultat.scoreConfiance}/100)`} ton={DECISIONS_REUSSIES.includes(arrivee.resultat.decision) ? 'succes' : 'info'} />
                </View>
                )
              : null}
          </Carte>
          )
        : <Message texte="Les simulations d'arrivée et d'appel se font avec un compte voyageur (Awa ou Moussa)." ton='info' />}

      <Carte>
        <EnTeteCarte icone='timer-outline' titre='Tâches automatiques' />
        <Texte petit secondaire>Exécutées chaque heure en production : clôture des voyages échus, forfaits eSIM expirés, sessions périmées.</Texte>
        <Bouton compact variante='secondaire' titre='Exécuter maintenant' icone='play' chargement={maintenance.isPending} surAppui={() => maintenance.mutate()} />
        {rapport
          ? <Message texte={`Voyages clôturés : ${rapport.voyages?.voyagesTermines ?? 0} · annulés : ${rapport.voyages?.voyagesAnnules ?? 0} · eSIM expirées : ${rapport.esimExpirees ?? 0} · sessions purgées : ${rapport.sessionsPurgees ?? 0}`} ton='succes' />
          : null}
        <Message texte={maintenance.error ? messageErreur(maintenance.error) : null} ton='danger' />
      </Carte>

      <Carte>
        <EnTeteCarte icone='stats-chart-outline' titre='État de la démonstration' droite={<Bouton compact variante='discret' titre='Actualiser' surAppui={() => { void etat.refetch() }} />} />
        {etat.isPending ? <Chargement /> : null}
        {etat.data
          ? (
            <>
              {etat.data.stocks.map((stock) => (
                <JaugeStock key={stock.pays} pays={stock.pays} pourcentage={Number.parseFloat(stock.occupation) || 0} reapprovisionnement={stock.reapprovisionnement} />
              ))}
              <Ligne libelle='Voyages' valeur={Object.entries(etat.data.voyages).map(([s, n]) => `${s} ${n}`).join(' · ') || '—'} />
              <Ligne libelle='Numéros' valeur={Object.entries(etat.data.numeros).map(([s, n]) => `${s} ${n}`).join(' · ') || '—'} />
              <Ligne libelle='Alertes de fraude' valeur={String(etat.data.alertesFraude)} />
              <Texte gras>Derniers évènements tracés</Texte>
              {etat.data.derniersEvenements.slice(0, 6).map((evenement, index) => (
                <Texte key={`${evenement.action}-${index}`} petit secondaire>{evenement.entite} · {evenement.action}</Texte>
              ))}
            </>
            )
          : null}
      </Carte>

      <Carte>
        <EnTeteCarte icone='list-outline' titre='Scénario commenté' />
        <Texte petit secondaire>Sur l’ordinateur : « npm run demo -- --url {'<adresse du serveur>'} » joue ces étapes pendant que l’application est ouverte.</Texte>
        {(infoDemo?.scenario || []).slice(1).map((etape, index) => (
          <Texte key={etape.id} petit>{index + 1}. {etape.titre}</Texte>
        ))}
      </Carte>

      <Carte>
        <EnTeteCarte icone='refresh' titre='Remettre à zéro' />
        <Texte petit secondaire>Recharge les données fictives initiales. Tous les appareils sont déconnectés.</Texte>
        {confirmerReinitialisation
          ? (
            <Rangee>
              <Bouton compact variante='danger' titre='Confirmer' chargement={reinitialisation.isPending} surAppui={() => reinitialisation.mutate()} />
              <Bouton compact variante='discret' titre='Annuler' surAppui={() => setConfirmerReinitialisation(false)} />
            </Rangee>
            )
          : <Bouton compact variante='danger' titre='Réinitialiser la démo' surAppui={() => setConfirmerReinitialisation(true)} />}
        <Message texte={reinitialisation.error ? messageErreur(reinitialisation.error) : null} ton='danger' />
      </Carte>
    </Ecran>
  )
}
