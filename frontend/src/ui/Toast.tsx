import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconX } from './Icons'

interface ToastItem {
  id: number
  message: string
  tone: 'info' | 'danger'
  action?: { label: string; run: () => void }
  duration: number
}

interface ToastCtx {
  show: (message: string, opts?: { tone?: 'info' | 'danger'; action?: { label: string; run: () => void }; duration?: number }) => void
}

const Ctx = createContext<ToastCtx | null>(null)

/** Notifications discrètes en bas d'écran, annoncées aux lecteurs d'écran (aria-live). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(1)

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), [])

  const show = useCallback<ToastCtx['show']>((message, opts = {}) => {
    const id = next.current++
    setItems((l) => [...l.slice(-2), { id, message, tone: opts.tone ?? 'info', ...(opts.action ? { action: opts.action } : {}), duration: opts.duration ?? 5000 }])
  }, [])

  const value = useMemo(() => ({ show }), [show])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 flex-col gap-2">
        {items.map((t) => (
          <Toast key={t.id} item={t} onDone={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  )
}

function Toast({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, item.duration)
    return () => clearTimeout(t)
  }, [item.duration, onDone])
  return (
    <div
      role={item.tone === 'danger' ? 'alert' : 'status'}
      className="pointer-events-auto fade-in flex items-center gap-3 rounded-lg bg-[#13213d] px-4 py-2.5 text-sm text-white shadow-float"
    >
      <span className="flex-1">{item.message}</span>
      {item.action ? (
        <button
          type="button"
          className="rounded px-1.5 py-0.5 font-semibold text-[#a9c4f7] underline-offset-2 hover:underline"
          onClick={() => {
            item.action?.run()
            onDone()
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button type="button" aria-label="Fermer la notification" className="rounded p-0.5 text-white/70 hover:text-white" onClick={onDone}>
        <IconX width={14} height={14} />
      </button>
    </div>
  )
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx)
  // Hors fournisseur (tests unitaires isolés) : notifications ignorées.
  return v ?? { show: () => undefined }
}
