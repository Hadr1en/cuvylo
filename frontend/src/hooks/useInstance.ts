import { useEffect, useState } from 'react'
import { api, type InstanceInfo } from '@/api/client'

// Une seule requête par chargement de l'application : ces informations ne changent pas en cours de route.
let pending: Promise<InstanceInfo> | null = null

export function loadInstance(): Promise<InstanceInfo> {
  pending ??= api.instance().catch((e: unknown) => {
    pending = null // nouvel essai au prochain appel
    throw e
  })
  return pending
}

/** Pour les tests : oublie la valeur mise en cache. */
export function resetInstanceCache(): void {
  pending = null
}

export type InstanceState = { status: 'loading' } | { status: 'ready'; info: InstanceInfo } | { status: 'error' }

export function useInstance(): InstanceState {
  const [state, setState] = useState<InstanceState>({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    loadInstance()
      .then((info) => !cancelled && setState({ status: 'ready', info }))
      .catch(() => !cancelled && setState({ status: 'error' }))
    return () => {
      cancelled = true
    }
  }, [])
  return state
}
