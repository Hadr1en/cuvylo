import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, UNAUTHORIZED_EVENT, api, type User } from '@/api/client'

type Status = 'loading' | 'anonymous' | 'authenticated'

interface RegisterInput {
  email: string
  password: string
  displayName?: string | undefined
  inviteCode?: string | undefined
  inviteToken?: string | undefined
}

export type Notice = 'deleted' | 'reset' | 'signedOut' | null

/** Résultat d'une connexion : terminée, ou en attente du code de double authentification. */
export type LoginOutcome = { done: true } | { done: false; mfaToken: string }

interface AuthCtx {
  status: Status
  user: User | null
  login: (email: string, password: string) => Promise<LoginOutcome>
  /** Deuxième étape de connexion (code TOTP ou code de secours). */
  verifyMfa: (mfaToken: string, code: string) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  /** Installation : crée le premier compte (administrateur) et ouvre sa session. */
  install: (input: { setupCode: string; email: string; password: string; displayName?: string | undefined }) => Promise<void>
  logout: () => Promise<void>
  /** Relit l'utilisateur courant (après activation de la double authentification, par exemple). */
  refresh: () => Promise<void>
  /** Supprime définitivement le compte (mot de passe redemandé), puis repasse en anonyme. */
  deleteAccount: (password: string) => Promise<void>
  /** Dernier évènement de compte à annoncer sur l'écran de connexion (`signedOut` : déconnexion volontaire). */
  notice: Notice
  setNotice: (n: Notice) => void
  /** Session expirée pendant l'utilisation : la page reste affichée, une fenêtre propose de se reconnecter. */
  expired: boolean
}

const Ctx = createContext<AuthCtx | null>(null)

function clearLocalJobs() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('cuvylo-job-') || k.startsWith('cuvylo-draft-'))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    /* stockage indisponible : rien à effacer */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .me()
      .then(({ user }) => {
        if (cancelled) return
        setUser(user)
        setStatus('authenticated')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // 401 = pas de session ; toute autre erreur laisse aussi l'écran de connexion.
        if (!(e instanceof ApiError) || e.status !== 401) console.warn('Session indisponible')
        setStatus('anonymous')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Un 401 en cours d'utilisation ne fait pas perdre la page : on signale l'expiration.
  useEffect(() => {
    const on = () => setExpired((e) => e || status === 'authenticated')
    window.addEventListener(UNAUTHORIZED_EVENT, on)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, on)
  }, [status])

  const signedIn = useCallback((u: User) => {
    setUser(u)
    setStatus('authenticated')
    setNotice(null)
    setExpired(false)
  }, [])

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      const r = await api.login({ email, password })
      if ('mfaRequired' in r) return { done: false, mfaToken: r.mfaToken }
      // Reconnexion après expiration : si un autre compte se connecte, on repart d'un état propre.
      if (user && user.id !== r.user.id) window.location.assign('/')
      signedIn(r.user)
      return { done: true }
    },
    [signedIn, user],
  )

  const verifyMfa = useCallback(
    async (mfaToken: string, code: string) => {
      const { user: u } = await api.mfa(mfaToken, code)
      if (user && user.id !== u.id) window.location.assign('/')
      signedIn(u)
    },
    [signedIn, user],
  )

  const register = useCallback(
    async (input: RegisterInput) => {
      const { user } = await api.register(input)
      signedIn(user)
    },
    [signedIn],
  )

  const install = useCallback(
    async (input: { setupCode: string; email: string; password: string; displayName?: string | undefined }) => {
      const { user } = await api.setup(input)
      signedIn(user)
    },
    [signedIn],
  )

  const refresh = useCallback(async () => {
    const { user } = await api.me()
    setUser(user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      clearLocalJobs()
      setNotice('signedOut')
      setUser(null)
      setStatus('anonymous')
      setExpired(false)
    }
  }, [])

  const deleteAccount = useCallback(async (password: string) => {
    await api.deleteAccount(password)
    // Les fiches de poste et brouillons vivent dans ce navigateur : on les efface avec le compte.
    clearLocalJobs()
    setNotice('deleted')
    setUser(null)
    setStatus('anonymous')
  }, [])

  const value = useMemo(
    () => ({ status, user, login, verifyMfa, register, install, logout, refresh, deleteAccount, notice, setNotice, expired }),
    [status, user, login, verifyMfa, register, install, logout, refresh, deleteAccount, notice, expired],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth hors AuthProvider')
  return v
}
