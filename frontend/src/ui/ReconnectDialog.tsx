import { useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { errorMessage } from '@/lib/format'
import { Dialog } from './Dialog'
import { TextField } from './fields'

/**
 * Session expirée en cours d'édition : on se reconnecte sans quitter la page.
 * Les modifications non envoyées restent en mémoire (et en brouillon local) puis repartent
 * à la sauvegarde suivante.
 */
export function ReconnectDialog() {
  const { expired, user, login, verifyMfa, logout } = useAuth()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!user) return null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !user) return
    setBusy(true)
    setError(null)
    try {
      if (mfaToken) {
        await verifyMfa(mfaToken, code.trim())
      } else {
        const r = await login(user.email, password)
        if (!r.done) {
          setMfaToken(r.mfaToken)
          setBusy(false)
          return
        }
      }
      setPassword('')
      setCode('')
      setMfaToken(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={expired}
      dismissable={false}
      title="Votre session a expiré"
      description={
        <>
          Reconnectez-vous pour continuer : la page reste ouverte et vos dernières modifications seront enregistrées ensuite.
        </>
      }
      onClose={() => undefined}
    >
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm">
          Compte : <strong className="font-semibold">{user.email}</strong>
        </p>
        {mfaToken ? (
          <TextField label="Code de double authentification" value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" required />
        ) : (
          <TextField label="Mot de passe" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
        )}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-between gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
            Se déconnecter
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Connexion…' : 'Se reconnecter'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
