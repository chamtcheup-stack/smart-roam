import { useMutation } from '@tanstack/react-query'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { messageErreur } from '../../api/client'
import { useActualiserTout, useConsentements, useEsims, useNumeros, useRegles } from '../../api/requetes'
import { api } from '../../api/services'
import type { ActionRenvoi, Condition, NumeroVirtuel, RegleRenvoi, ResultatAppel } from '../../api/types'
import { useSession } from '../../session/SessionContext'
import { Badge, Bouton, Carte, Champ, Chargement, EnTeteCarte, Ecran, Ligne, Message, Puces, Rangee, Separateur, Texte, Titre } from '../../ui/composants'
import { espace } from '../../ui/theme'
import {
  cleIdempotence,
  drapeau,
  formaterDate,
  formaterTelephone,
  libelleAction,
  libelleCondition,
  nomPays,
  normaliserTelephone,
  statutEsim,
  statutNumero,
  telephoneValide
} from '../../utils/format'

const EXPLICATIONS_STATUT: Record<string, string> = {
  AWAITING_ARRIVAL: 'Il s\'activera automatiquement dès votre arrivée dans le pays.',
  ACTIVE: 'Il reçoit vos appels selon vos règles de renvoi.',
  PARKED: 'En parking : conservé pour votre prochain voyage, il ne reçoit pas d\'appels.',
  SUSPENDED: 'Suspendu par sécurité après une activité inhabituelle : contactez le support Orange.'
}

export default function DetailNumero () {
  const { session } = useSession()
  const { numberId } = useLocalSearchParams<{ numberId: string }>()
  const numeros = useNumeros()
  if (!session) return <Redirect href='/bienvenue' />

  const numero = (numeros.data || []).find((n) => n.number_id === numberId)
  if (numeros.isPending) return <Ecran enTeteNavigation><Chargement /></Ecran>
  if (!numero) return <Ecran enTeteNavigation><Message texte='Numéro introuvable.' ton='danger' /></Ecran>

  return (
    <Ecran enTeteNavigation>
      <Carte accent={numero.status === 'ACTIVE'}>
        <Titre niveau={2}>{drapeau(numero.country_iso)} {formaterTelephone(numero.did_number)}</Titre>
        <Rangee><Badge {...statutNumero(numero.status)} /><Texte secondaire>{nomPays(numero.country_iso)}</Texte></Rangee>
        <Texte secondaire>{EXPLICATIONS_STATUT[numero.status] || ''}</Texte>
      </Carte>
      <SectionRenvois numero={numero} />
      <SectionAppelDemo numero={numero} />
      <SectionMiroir numero={numero} />
      <SectionEsim numero={numero} />
    </Ecran>
  )
}

// ── Renvoi d'appels ────────────────────────────────────────
function SectionRenvois ({ numero }: { numero: NumeroVirtuel }) {
  const regles = useRegles()
  const actualiserTout = useActualiserTout()
  const [condition, setCondition] = useState<Condition>('NO_ANSWER')
  const [action, setAction] = useState<ActionRenvoi>('VOICEMAIL')
  const [cible, setCible] = useState('')

  const reglesDuNumero = (regles.data || []).filter((r) => r.number_id === numero.number_id || r.number_id === null)
  const cibleE164 = normaliserTelephone(cible)
  const ajout = useMutation({
    mutationFn: () => api.creerRegle({
      numberId: numero.number_id,
      triggerCondition: condition,
      action,
      ...(action === 'FORWARD' ? { targetNumber: cibleE164 } : {}),
      priority: Math.max(0, ...reglesDuNumero.map((r) => r.priority)) + 1
    }),
    onSuccess: () => {
      setCible('')
      void actualiserTout()
    }
  })

  return (
    <Carte>
      <EnTeteCarte icone='git-branch-outline' titre="Renvoi d'appels" />
      <Texte petit secondaire>Les règles s’appliquent dans l’ordre ; sans règle applicable, votre téléphone sonne.</Texte>
      {regles.isPending ? <Chargement /> : null}
      {reglesDuNumero.length === 0 && regles.isSuccess ? <Texte secondaire>Aucune règle : tous les appels font sonner votre téléphone.</Texte> : null}
      {reglesDuNumero.map((regle) => <LigneRegle key={regle.rule_id} regle={regle} />)}
      <Separateur />
      <Texte gras>Nouvelle règle</Texte>
      <Puces<Condition>
        libelle='Quand'
        valeur={condition}
        surChoix={setCondition}
        options={(['NO_ANSWER', 'BUSY', 'ALWAYS'] as Condition[]).map((c) => ({ valeur: c, texte: libelleCondition[c] }))}
      />
      <Puces<ActionRenvoi>
        libelle='Alors'
        valeur={action}
        surChoix={setAction}
        options={(['VOICEMAIL', 'FORWARD', 'REJECT'] as ActionRenvoi[]).map((a) => ({ valeur: a, texte: libelleAction[a] }))}
      />
      {action === 'FORWARD'
        ? <Champ libelle='Numéro de renvoi' value={cible} onChangeText={setCible} keyboardType='phone-pad' placeholder='+33 6 39 98 00 42' erreur={cible && !telephoneValide(cibleE164) ? 'Format international attendu' : null} />
        : null}
      <Message texte={ajout.error ? messageErreur(ajout.error) : null} ton='danger' />
      <Bouton titre='Ajouter la règle' icone='add' chargement={ajout.isPending} desactive={action === 'FORWARD' && !telephoneValide(cibleE164)} surAppui={() => ajout.mutate()} />
    </Carte>
  )
}

function LigneRegle ({ regle }: { regle: RegleRenvoi }) {
  const actualiserTout = useActualiserTout()
  const bascule = useMutation({
    mutationFn: () => api.modifierRegle(regle.rule_id, { isActive: !regle.is_active }),
    onSuccess: () => { void actualiserTout() }
  })
  return (
    <View style={{ gap: espace.xs, opacity: regle.is_active ? 1 : 0.55 }}>
      <Texte gras>{libelleCondition[regle.trigger_condition] || regle.trigger_condition} → {libelleAction[regle.action] || regle.action}</Texte>
      {regle.target_number ? <Texte petit secondaire>Vers {formaterTelephone(regle.target_number)}</Texte> : null}
      <Rangee>
        <Badge texte={regle.is_active ? 'Active' : 'Désactivée'} ton={regle.is_active ? 'succes' : 'neutre'} />
        <Bouton compact variante='discret' titre={regle.is_active ? 'Désactiver' : 'Réactiver'} chargement={bascule.isPending} surAppui={() => bascule.mutate()} />
      </Rangee>
      <Message texte={bascule.error ? messageErreur(bascule.error) : null} ton='danger' />
    </View>
  )
}

// ── Appel entrant simulé (mode démo) ───────────────────────
const messageAppel = (resultat: ResultatAppel): string => {
  switch (resultat.decision) {
    case 'RING': return `Votre téléphone sonne (${formaterTelephone(resultat.destination)})`
    case 'VOICEMAIL': return 'Appel renvoyé vers votre messagerie vocale'
    case 'FORWARD': return `Appel renvoyé vers ${formaterTelephone(resultat.destination)}`
    default: return resultat.message
  }
}

function SectionAppelDemo ({ numero }: { numero: NumeroVirtuel }) {
  const { mode } = useSession()
  const [statut, setStatut] = useState<'LIBRE' | 'OCCUPE' | 'SANS_REPONSE'>('LIBRE')
  const appel = useMutation({ mutationFn: () => api.appelEntrant(numero.number_id, statut) })
  if (mode !== 'demo') return null
  return (
    <Carte accent>
      <EnTeteCarte icone='flask-outline' titre='Simuler un appel entrant' />
      <Puces
        libelle={'Au moment de l\'appel, vous êtes…'}
        valeur={statut}
        surChoix={setStatut}
        options={[{ valeur: 'LIBRE', texte: 'Disponible' }, { valeur: 'OCCUPE', texte: 'En ligne' }, { valeur: 'SANS_REPONSE', texte: 'Sans réponse' }]}
      />
      <Bouton titre='Appeler ce numéro' icone='call' chargement={appel.isPending} surAppui={() => appel.mutate()} />
      {appel.data ? <Message texte={`${messageAppel(appel.data)} · code SIP ${appel.data.codeSIP.split(' ')[0]}`} ton={appel.data.decision === 'REJECT' ? 'alerte' : 'succes'} /> : null}
      <Message texte={appel.error ? messageErreur(appel.error) : null} ton='danger' />
    </Carte>
  )
}

// ── Profil miroir ──────────────────────────────────────────
function SectionMiroir ({ numero }: { numero: NumeroVirtuel }) {
  const consentements = useConsentements()
  const actualiserTout = useActualiserTout()
  const photoAutorisee = (consentements.data || []).some((c) => c.destination_country === numero.country_iso && c.data_type === 'AVATAR' && c.etat === 'ACCORDE')
  const synchronisation = useMutation({ mutationFn: () => api.synchroniserMiroir(numero.number_id), onSuccess: () => { void actualiserTout() } })
  const photo = useMutation({
    mutationFn: async () => {
      await api.changerConsentement(numero.country_iso, 'AVATAR', !photoAutorisee)
      return api.synchroniserMiroir(numero.number_id)
    },
    onSuccess: () => { void actualiserTout() }
  })
  const profil = synchronisation.data?.profilMiroir || photo.data?.profilMiroir

  return (
    <Carte>
      <EnTeteCarte icone='person-outline' titre='Profil miroir' />
      <Texte petit secondaire>Ce que voient vos correspondants en {nomPays(numero.country_iso)} quand vous les appelez depuis ce numéro.</Texte>
      <Ligne libelle='Nom affiché' valeur={profil?.display_name || numero.mirror_display_name || 'Non synchronisé'} />
      <Ligne libelle='Photo' valeur={photoAutorisee ? 'Autorisée' : 'Non partagée'} />
      {profil ? <Ligne libelle='Badge' valeur={profil.kyc_badge === 'KYC_VERIFIE' ? 'Identité vérifiée' : 'Aucun'} /> : null}
      {numero.mirror_synced_at ? <Texte petit secondaire>Dernière synchronisation : {formaterDate(numero.mirror_synced_at)}</Texte> : null}
      <Message texte={(synchronisation.error || photo.error) ? messageErreur(synchronisation.error || photo.error) : null} ton='danger' />
      <Rangee>
        <Bouton compact titre='Synchroniser' icone='sync' chargement={synchronisation.isPending} surAppui={() => synchronisation.mutate()} />
        <Bouton compact variante='secondaire' titre={photoAutorisee ? 'Retirer ma photo' : 'Partager ma photo'} chargement={photo.isPending} surAppui={() => photo.mutate()} />
      </Rangee>
    </Carte>
  )
}

// ── eSIM ───────────────────────────────────────────────────
const FORFAITS = [
  { valeur: 'DAY', texte: '1 jour · 200 Mo' },
  { valeur: 'WEEK', texte: '7 jours · 1 Go' },
  { valeur: 'MONTH', texte: '30 jours · 5 Go' }
] as const

function SectionEsim ({ numero }: { numero: NumeroVirtuel }) {
  const esims = useEsims()
  const actualiserTout = useActualiserTout()
  const [forfait, setForfait] = useState<'DAY' | 'WEEK' | 'MONTH'>('WEEK')
  const [cle] = useState(cleIdempotence)
  const installation = useMutation({
    mutationFn: () => api.provisionnerEsim(numero.number_id, numero.country_iso, forfait, cle),
    onSuccess: () => { void actualiserTout() }
  })
  const esimsDuNumero = (esims.data || []).filter((e) => e.number_id === numero.number_id)
  const active = esimsDuNumero.find((e) => e.status === 'ACTIVE')

  return (
    <Carte>
      <EnTeteCarte icone='cellular-outline' titre='Internet sur place (eSIM)' />
      {esims.isPending ? <Chargement /> : null}
      {esimsDuNumero.map((esim) => (
        <View key={esim.iccid || esim.esim_id || esim.activated_at || 'esim'} style={{ gap: espace.xs }}>
          <Rangee><Badge {...statutEsim(esim.status)} /><Texte gras>{esim.plan_type === 'BYOE' ? 'Votre propre eSIM' : `Forfait ${esim.plan_type}`}</Texte></Rangee>
          {esim.data_quota_mb ? <Ligne libelle='Données' valeur={`${esim.data_used_mb ?? 0} / ${esim.data_quota_mb} Mo`} /> : null}
          {esim.expire_le ? <Ligne libelle='Expire le' valeur={formaterDate(esim.expire_le)} /> : null}
          {esim.iccid ? <Texte petit secondaire>ICCID {esim.iccid}</Texte> : null}
        </View>
      ))}
      {!active && esims.isSuccess
        ? (
          <>
            <Texte secondaire>Installez une eSIM locale pour naviguer sans frais d’itinérance.</Texte>
            <Puces libelle='Forfait' valeur={forfait} surChoix={setForfait} options={FORFAITS.map((f) => ({ valeur: f.valeur, texte: f.texte }))} />
            <Bouton titre="Installer l'eSIM" icone='download-outline' chargement={installation.isPending} surAppui={() => installation.mutate()} />
          </>
          )
        : null}
      {installation.data ? <Message texte={installation.data.partenaire ? `${installation.data.message} : réseau ${installation.data.partenaire}` : installation.data.message} ton='succes' /> : null}
      <Message texte={installation.error ? messageErreur(installation.error) : null} ton='danger' />
    </Carte>
  )
}
