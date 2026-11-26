import { View } from 'react-native'
import { Badge, Rangee, Texte } from '../ui/composants'
import { espace, rayon, useTheme } from '../ui/theme'
import { drapeau, formaterNombre, nomPays } from '../utils/format'

const LIBELLES_REAPPRO: Record<string, string> = {
  REORDER_REQUIRED: 'À commander',
  REORDER_PENDING: 'Commande en cours',
  REORDER_CONFIRMED: 'Livré'
}

// Occupation d'un pool de numéros (pourcentage 0–100), rouge à partir de 90 %.
export function JaugeStock ({ pays, pourcentage, reapprovisionnement, detail }: {
  pays: string
  pourcentage: number
  reapprovisionnement: string | null
  detail?: string
}) {
  const { couleurs } = useTheme()
  const valeur = Math.max(0, Math.min(100, pourcentage))
  return (
    <View style={{ gap: espace.xs }}>
      <Rangee>
        <Texte gras>{drapeau(pays)} {nomPays(pays)}</Texte>
        <Texte secondaire>{formaterNombre(valeur, 1)} %</Texte>
        {reapprovisionnement ? <Badge texte={LIBELLES_REAPPRO[reapprovisionnement] || reapprovisionnement} ton='info' /> : null}
      </Rangee>
      <View accessibilityLabel={`Occupation ${formaterNombre(valeur, 1)} %`} style={{ height: 8, borderRadius: rayon.plein, backgroundColor: couleurs.fondNeutre, overflow: 'hidden' }}>
        <View style={{ width: `${valeur}%`, height: '100%', backgroundColor: valeur >= 90 ? couleurs.danger : couleurs.primaire }} />
      </View>
      {detail ? <Texte petit secondaire>{detail}</Texte> : null}
    </View>
  )
}
