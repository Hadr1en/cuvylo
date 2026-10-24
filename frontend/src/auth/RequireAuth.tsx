import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, notice } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <p role="status" className="p-10 text-center text-sm text-muted">
        Chargement…
      </p>
    )
  }
  // Visite sans session : l'accueil est l'analyse publique d'un CV. Après une déconnexion (ou une suppression
  // de compte), et pour toute autre page, direction la connexion.
  if (status === 'anonymous' && location.pathname === '/' && notice === null) return <Navigate to="/analyser" replace />
  if (status === 'anonymous') return <Navigate to="/connexion" replace state={{ from: location.pathname }} />
  return <>{children}</>
}
