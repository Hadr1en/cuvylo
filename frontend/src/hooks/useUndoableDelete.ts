import { useCallback, useEffect, useRef } from 'react'
import { useToast } from '@/ui/Toast'

/**
 * Suppression annulable : l'élément disparaît tout de suite de la liste, la requête ne part
 * qu'après le délai d'annulation (ou en quittant la page). Annuler le remet en place.
 */
export function useUndoableDelete<T extends { id: string }>(opts: {
  remove: (id: string) => Promise<void>
  hide: (item: T) => void
  restore: (item: T) => void
  label: (item: T) => string
  onError: (e: unknown, item: T) => void
  delayMs?: number
}) {
  const { show } = useToast()
  const pending = useRef(new Map<string, { item: T; timer: ReturnType<typeof setTimeout> }>())
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const commit = useCallback((id: string) => {
    const p = pending.current.get(id)
    if (!p) return
    clearTimeout(p.timer)
    pending.current.delete(id)
    optsRef.current.remove(id).catch((e: unknown) => {
      optsRef.current.restore(p.item)
      optsRef.current.onError(e, p.item)
    })
  }, [])

  // En quittant la page, les suppressions en attente sont envoyées.
  useEffect(() => {
    const map = pending.current
    return () => {
      for (const id of [...map.keys()]) commit(id)
    }
  }, [commit])

  return useCallback(
    (item: T) => {
      const delay = optsRef.current.delayMs ?? 6000
      optsRef.current.hide(item)
      const timer = setTimeout(() => commit(item.id), delay)
      pending.current.set(item.id, { item, timer })
      show(`${optsRef.current.label(item)} supprimé`, {
        duration: delay,
        action: {
          label: 'Annuler',
          run: () => {
            const p = pending.current.get(item.id)
            if (!p) return
            clearTimeout(p.timer)
            pending.current.delete(item.id)
            optsRef.current.restore(item)
          },
        },
      })
    },
    [commit, show],
  )
}
