import { router } from 'expo-router'
import { useSession, type ModeServeur } from '../session/SessionContext'
import { Badge, Bouton, Carte, EnTeteCarte, Rangee, Texte } from '../ui/composants'
import type { Ton } from '../ui/theme'

const LIBELLES: Record<ModeServeur, { texte: string; ton: Ton }> = {
  demo: { texte: 'Mode démo : données fictives', ton: 'primaire' },
  reel: { texte: 'Connecté', ton: 'succes' },
  injoignable: { texte: 'Serveur injoignable', ton: 'danger' },
  verification: { texte: 'Vérification…', ton: 'neutre' }
}

export function EtatServeur () {
  const { serveur, mode, verifierServeur } = useSession()
  const { texte, ton } = LIBELLES[mode]
  return (
    <Carte>
      <EnTeteCarte icone='server-outline' titre='Serveur Smart Roam' droite={<Badge texte={texte} ton={ton} />} />
      <Texte petit secondaire>{serveur || '—'}</Texte>
      {mode === 'injoignable'
        ? <Texte petit secondaire>Vérifiez que le serveur est lancé et que le téléphone est sur le même réseau Wi-Fi que l’ordinateur.</Texte>
        : null}
      <Rangee>
        <Bouton compact variante='secondaire' icone='create-outline' titre="Changer d'adresse" surAppui={() => router.push('/serveur')} />
        <Bouton compact variante='discret' icone='refresh' titre='Réessayer' surAppui={() => { void verifierServeur() }} />
      </Rangee>
    </Carte>
  )
}
