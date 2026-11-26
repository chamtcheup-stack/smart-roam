import { useColorScheme } from 'react-native'

// Couleurs Smart Roam. Sur l'orange, le texte est NOIR (contraste 8,6:1) :
// le blanc sur orange (2,4:1) n'est pas lisible.
const ORANGE = '#FF7900'

const clair = {
  primaire: ORANGE,
  surPrimaire: '#000000',
  fond: '#F4F4F4',
  surface: '#FFFFFF',
  surfaceAccent: '#FFF1E6',
  texte: '#1A1A1A',
  texteSecondaire: '#595959',
  bordure: '#DDDDDD',
  succes: '#1E7B1E',
  fondSucces: '#E5F5E5',
  alerte: '#8A6100',
  fondAlerte: '#FFF4D6',
  danger: '#C2350F',
  fondDanger: '#FDE8E3',
  info: '#2F5FC4',
  fondInfo: '#E6EDFB',
  neutre: '#595959',
  fondNeutre: '#EDEDED',
  ombre: '#000000'
}

export type Couleurs = typeof clair

const sombre: Couleurs = {
  primaire: ORANGE,
  surPrimaire: '#000000',
  fond: '#111111',
  surface: '#1E1E1E',
  surfaceAccent: '#3A2614',
  texte: '#F2F2F2',
  texteSecondaire: '#B3B3B3',
  bordure: '#333333',
  succes: '#6FD36F',
  fondSucces: '#183318',
  alerte: '#F2C94C',
  fondAlerte: '#332A10',
  danger: '#FF8A70',
  fondDanger: '#3A1A12',
  info: '#8DB0FF',
  fondInfo: '#16233F',
  neutre: '#B3B3B3',
  fondNeutre: '#2A2A2A',
  ombre: '#000000'
}

export const espace = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const
export const rayon = { s: 8, m: 12, l: 16, plein: 999 } as const
export const taille = { petite: 13, normale: 15, moyenne: 17, grande: 22, titre: 28 } as const

export type Ton = 'succes' | 'alerte' | 'danger' | 'info' | 'neutre' | 'primaire'

export const useTheme = () => {
  const schema = useColorScheme()
  const couleurs = schema === 'dark' ? sombre : clair
  const tons: Record<Ton, { texte: string; fond: string }> = {
    succes: { texte: couleurs.succes, fond: couleurs.fondSucces },
    alerte: { texte: couleurs.alerte, fond: couleurs.fondAlerte },
    danger: { texte: couleurs.danger, fond: couleurs.fondDanger },
    info: { texte: couleurs.info, fond: couleurs.fondInfo },
    neutre: { texte: couleurs.neutre, fond: couleurs.fondNeutre },
    primaire: { texte: couleurs.surPrimaire, fond: couleurs.primaire }
  }
  return { couleurs, tons, sombre: schema === 'dark' }
}
