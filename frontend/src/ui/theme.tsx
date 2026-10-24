import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'

interface ThemeCtx {
  choice: ThemeChoice
  /** Thème effectivement affiché. */
  resolved: 'light' | 'dark'
  cycle: () => void
}

const Ctx = createContext<ThemeCtx | null>(null)
const KEY = 'cuvylo-theme'

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function systemDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice)
  const [sysDark, setSysDark] = useState(systemDark)

  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSysDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const resolved: 'light' | 'dark' = choice === 'system' ? (sysDark ? 'dark' : 'light') : choice

  useEffect(() => {
    const el = document.documentElement
    if (choice === 'system') delete el.dataset.theme
    else el.dataset.theme = choice
    try {
      if (choice === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, choice)
    } catch {
      /* stockage indisponible : le thème reste valable pour la session */
    }
  }, [choice])

  const cycle = useCallback(() => {
    setChoice((c) => (c === 'system' ? (sysDark ? 'light' : 'dark') : c === 'light' ? 'dark' : 'light'))
  }, [sysDark])

  const value = useMemo(() => ({ choice, resolved, cycle }), [choice, resolved, cycle])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTheme hors ThemeProvider')
  return v
}
