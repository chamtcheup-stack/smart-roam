import NetInfo, { NetInfoStateType } from '@react-native-community/netinfo'
import * as Cellular from 'expo-cellular'
import { Platform } from 'react-native'
import type { SignauxBruts } from '../api/types'

// Signaux réellement lisibles par une application Expo, envoyés tels quels à
// POST /api/geolocalisation/arrivee (le serveur les décode et décide) :
//  - MCC/MNC du réseau mobile : Android uniquement (null sur iOS et le web) ;
//  - SSID du Wi-Fi : fourni seulement si le système l'autorise (permission de
//    localisation, non demandée par cette version).
// Le Cell-ID et le pays de l'adresse IP ne sont pas disponibles : il faudra un
// module natif (Cell-ID) et un service GeoIP côté serveur.
export const collecterSignaux = async (): Promise<SignauxBruts> => {
  const signaux: SignauxBruts = {}

  if (Platform.OS === 'android') {
    const [mcc, mnc] = await Promise.all([
      Cellular.getMobileCountryCodeAsync().catch(() => null),
      Cellular.getMobileNetworkCodeAsync().catch(() => null)
    ])
    if (mcc && /^\d{3}$/.test(mcc)) {
      signaux.mcc = mcc
      if (mnc && /^\d{1,3}$/.test(mnc)) signaux.mnc = mnc
    }
  }

  try {
    const etat = await NetInfo.fetch()
    if (etat.type === NetInfoStateType.wifi) {
      const ssid = (etat.details as { ssid?: string | null } | null)?.ssid
      if (ssid && ssid !== '<unknown ssid>') signaux.ssid = ssid
    }
  } catch {
    // Réseau illisible : on n'envoie que ce qui est disponible.
  }

  return signaux
}

export const signauxDisponibles = (signaux: SignauxBruts): boolean => Object.keys(signaux).length > 0
