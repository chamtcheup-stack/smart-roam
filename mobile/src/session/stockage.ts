import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

// Stockage clé-valeur : trousseau sécurisé du téléphone (Keychain iOS,
// Keystore Android) ; localStorage sur le web (démonstration navigateur).
// Clés : lettres, chiffres, « . », « - » et « _ » uniquement (contrainte SecureStore).
const surWeb = Platform.OS === 'web'

const stockageWeb = (): Storage | null => {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

export const stockage = {
  lire: async (cle: string): Promise<string | null> => {
    try {
      return surWeb ? stockageWeb()?.getItem(cle) ?? null : await SecureStore.getItemAsync(cle)
    } catch {
      return null
    }
  },
  ecrire: async (cle: string, valeur: string): Promise<void> => {
    try {
      if (surWeb) stockageWeb()?.setItem(cle, valeur)
      else await SecureStore.setItemAsync(cle, valeur)
    } catch {
      // Stockage indisponible (navigation privée…) : la session reste en mémoire.
    }
  },
  supprimer: async (cle: string): Promise<void> => {
    try {
      if (surWeb) stockageWeb()?.removeItem(cle)
      else await SecureStore.deleteItemAsync(cle)
    } catch {
      // rien à supprimer
    }
  }
}
