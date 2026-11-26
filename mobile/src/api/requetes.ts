import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useSession } from '../session/SessionContext'
import { api } from './services'

// Requêtes partagées entre écrans (cache React Query par compte).
const useIdentifiant = () => useSession().utilisateur?.user_id ?? ''

export const usePays = () => useQuery({ queryKey: ['pays'], queryFn: api.pays, staleTime: 5 * 60_000 })

export const useNumeros = () => {
  const userId = useIdentifiant()
  return useQuery({ queryKey: ['numeros', userId], queryFn: async () => (await api.numeros(userId)).numeros, enabled: Boolean(userId) })
}

export const useDeclarations = () => {
  const userId = useIdentifiant()
  return useQuery({ queryKey: ['declarations', userId], queryFn: async () => (await api.declarations(userId)).declarations, enabled: Boolean(userId) })
}

export const useRegles = () => {
  const userId = useIdentifiant()
  return useQuery({ queryKey: ['regles', userId], queryFn: async () => (await api.regles(userId)).regles, enabled: Boolean(userId) })
}

export const useEsims = () => {
  const userId = useIdentifiant()
  return useQuery({ queryKey: ['esims', userId], queryFn: async () => (await api.esims(userId)).esims, enabled: Boolean(userId) })
}

export const useConsentements = () => {
  const userId = useIdentifiant()
  return useQuery({ queryKey: ['consentements', userId], queryFn: async () => (await api.consentements(userId)).consentements, enabled: Boolean(userId) })
}

export const useHistoriqueChange = () => {
  const userId = useIdentifiant()
  return useQuery({ queryKey: ['change', userId], queryFn: async () => (await api.historiqueChange(userId)).transactions, enabled: Boolean(userId) })
}

export const useSuggestion = (active: boolean) => useQuery({ queryKey: ['suggestion'], queryFn: api.suggestion, enabled: active, staleTime: 60_000 })

// Après une action, toutes les données affichées sont rechargées.
export const useActualiserTout = () => {
  const client = useQueryClient()
  return useCallback(() => client.invalidateQueries(), [client])
}
