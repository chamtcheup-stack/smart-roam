import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { View } from 'react-native'
import { ErreurApi, messageErreur } from '../../api/client'
import { useActualiserTout, useHistoriqueChange } from '../../api/requetes'
import { api, type DemandeConversion } from '../../api/services'
import type { Devis } from '../../api/types'
import { ConfirmationPIN, jetonSensibleValide, oublierJetonSensible } from '../../composants/ConfirmationPIN'
import { Bouton, Carte, Champ, Chargement, EnTeteCarte, Ecran, EtatVide, Ligne, Message, Puces, Separateur, Texte, Titre } from '../../ui/composants'
import { espace } from '../../ui/theme'
import { cleIdempotence, formaterDateHeure, formaterMontant, formaterNombre } from '../../utils/format'

const lireMontant = (saisie: string): number => Number(saisie.replace(/\s/g, '').replace(',', '.'))

export default function Argent () {
  const corridors = useQuery({ queryKey: ['corridors'], queryFn: api.corridors, staleTime: 5 * 60_000 })
  const historique = useHistoriqueChange()
  const actualiserTout = useActualiserTout()
  const [corridor, setCorridor] = useState<string | null>('XAF-EUR')
  const [montant, setMontant] = useState('100000')
  const [devis, setDevis] = useState<Devis | null>(null)
  const [cle, setCle] = useState(cleIdempotence)
  const [pinVisible, setPinVisible] = useState(false)
  const [succes, setSucces] = useState<string | null>(null)

  const [deviseSource, deviseCible] = (corridor || '-').split('-')
  const demande: DemandeConversion = { deviseSource, deviseCible, montant: lireMontant(montant) }
  const montantValide = Number.isFinite(demande.montant) && demande.montant > 0

  const apercu = useMutation({
    mutationFn: () => api.devis(demande),
    onSuccess: (resultat) => {
      setDevis(resultat)
      setSucces(null)
      setCle(cleIdempotence()) // nouveau devis : nouvelle opération
    }
  })

  const confirmation = useMutation({
    mutationFn: (jeton: string) => api.confirmerConversion(demande, jeton, cle),
    onSuccess: (resultat) => {
      setSucces(`Conversion confirmée : vous recevez ${formaterMontant(resultat.transaction.net_amount, resultat.transaction.target_currency)}.`)
      setDevis(null)
      void actualiserTout()
    },
    onError: (erreur) => {
      // Autorisation expirée : nouvelle confirmation par PIN.
      if (erreur instanceof ErreurApi && erreur.code === 'CONFIRMATION_PIN_REQUISE') {
        oublierJetonSensible()
        setPinVisible(true)
      }
    }
  })

  const confirmer = () => {
    const jeton = jetonSensibleValide()
    if (jeton) confirmation.mutate(jeton)
    else setPinVisible(true)
  }

  const options = (corridors.data?.corridors || [])
    .filter((c) => c.disponible)
    .map((c) => ({ valeur: `${c.deviseSource}-${c.deviseCible}`, texte: `${c.deviseSource} → ${c.deviseCible}` }))

  return (
    <Ecran>
      <Titre>Change de devises</Titre>
      <Texte secondaire>Taux officiels (1 € = 655,957 FCFA), commission de 1,5 %. Chaque conversion est confirmée par votre PIN.</Texte>

      <Carte>
        {corridors.isPending ? <Chargement /> : <Puces libelle='Conversion' valeur={corridor} surChoix={(valeur) => { setCorridor(valeur); setDevis(null) }} options={options} />}
        <Champ
          libelle={`Montant à convertir (${deviseSource})`}
          value={montant}
          onChangeText={(texte) => { setMontant(texte); setDevis(null) }}
          keyboardType='decimal-pad'
          erreur={montant && !montantValide ? 'Montant invalide' : null}
        />
        <Message texte={apercu.error ? messageErreur(apercu.error) : null} ton='danger' />
        <Bouton titre='Voir le devis' variante='secondaire' icone='calculator-outline' chargement={apercu.isPending} desactive={!corridor || !montantValide} surAppui={() => apercu.mutate()} />
      </Carte>

      {devis
        ? (
          <Carte accent>
            <EnTeteCarte icone='swap-horizontal' titre='Votre devis' />
            <Ligne libelle='Vous envoyez' valeur={formaterMontant(devis.montantSource, devis.deviseSource)} />
            <Ligne libelle='Taux appliqué' valeur={formaterNombre(devis.tauxChange, 6)} />
            <Ligne libelle='Montant brut' valeur={formaterMontant(devis.montantBrut, devis.deviseCible)} />
            <Ligne libelle={'Commission (1,5 %)'} valeur={formaterMontant(devis.commission, devis.deviseCible)} />
            <Separateur />
            <Ligne libelle='Vous recevez' valeur={formaterMontant(devis.montantNet, devis.deviseCible)} />
            <Message texte={confirmation.error && !(confirmation.error instanceof ErreurApi && confirmation.error.code === 'CONFIRMATION_PIN_REQUISE') ? messageErreur(confirmation.error) : null} ton='danger' />
            <Bouton titre='Confirmer avec mon PIN' icone='lock-closed' chargement={confirmation.isPending} surAppui={confirmer} />
          </Carte>
          )
        : null}
      <Message texte={succes} ton='succes' />

      <Carte>
        <EnTeteCarte icone='time-outline' titre='Historique' />
        {historique.isPending ? <Chargement /> : null}
        {historique.isSuccess && historique.data.length === 0 ? <EtatVide icone='wallet-outline' texte='Aucune conversion pour le moment.' /> : null}
        {(historique.data || []).map((transaction) => (
          <View key={transaction.transaction_id} style={{ gap: 2, paddingVertical: espace.xs }}>
            <Texte gras>{formaterMontant(transaction.source_amount, transaction.source_currency)} → {formaterMontant(transaction.net_amount, transaction.target_currency)}</Texte>
            <Texte petit secondaire>{formaterDateHeure(transaction.created_at)}</Texte>
          </View>
        ))}
      </Carte>

      <ConfirmationPIN
        visible={pinVisible}
        titre='Confirmer la conversion'
        description={devis ? `Vous convertissez ${formaterMontant(devis.montantSource, devis.deviseSource)} et recevez ${formaterMontant(devis.montantNet, devis.deviseCible)}.` : 'Saisissez votre PIN.'}
        surAnnulation={() => setPinVisible(false)}
        surConfirmation={(jeton) => {
          setPinVisible(false)
          confirmation.mutate(jeton)
        }}
      />
    </Ecran>
  )
}
