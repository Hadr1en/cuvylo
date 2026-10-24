import { useEffect, useState } from 'react'
import { ApiError, api } from '@/api/client'

/**
 * Instance à installer (serveur sans configuration, aucun compte, ou dossier cuvylo/ introuvable) :
 * les pages d'entrée (connexion, inscription, analyse publique) renvoient alors vers /installation.
 */
export function useSetupNeeded(): boolean {
  const [needed, setNeeded] = useState(false)
  useEffect(() => {
    let cancelled = false
    api
      .setupStatus()
      .then((r) => !cancelled && setNeeded(r.needed))
      // Dossier cuvylo/ introuvable : l'écran d'installation explique où le déposer.
      .catch((e: unknown) => !cancelled && e instanceof ApiError && e.code === 'code_missing' && setNeeded(true))
    return () => {
      cancelled = true
    }
  }, [])
  return needed
}
