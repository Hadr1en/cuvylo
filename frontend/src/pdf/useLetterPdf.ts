import { createElement, useEffect, useRef, useState } from 'react'
import type { LetterData, LetterSettings } from '@/api/client'
import type { ProfileData } from '@/domain/profile'
import { Cancelled, enqueue, loadEngines, openPdf, type OpenPdf } from './engine'

interface State {
  status: 'idle' | 'rendering' | 'ready' | 'error'
  blob: Blob | null
  doc: OpenPdf | null
}

/** PDF d'une lettre (même principe que `useCvPdf` : l'aperçu est le fichier exporté). */
export function useLetterPdf(letter: LetterData | null, settings: LetterSettings | null, sender: ProfileData['identity'] | null, title?: string): State {
  const [state, setState] = useState<State>({ status: 'idle', blob: null, doc: null })
  const generation = useRef(0)
  const shown = useRef<OpenPdf | null>(null)

  useEffect(() => {
    if (!letter || !settings || !sender) return
    const mine = ++generation.current
    const abort = new AbortController()
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, status: 'rendering' }))
      void (async () => {
        try {
          const blob = await enqueue(async () => {
            const [{ pdf }, { LetterDocument }] = await Promise.all([loadEngines(), import('./LetterDocument')])
            return pdf(createElement(LetterDocument, { letter, settings, sender, title })).toBlob()
          }, abort.signal)
          if (generation.current !== mine) return
          const opened = await openPdf(new Uint8Array(await blob.arrayBuffer()))
          if (generation.current !== mine) {
            await opened.close()
            return
          }
          const previous = shown.current
          shown.current = opened
          setState({ status: 'ready', blob, doc: opened })
          setTimeout(() => void previous?.close(), 0)
        } catch (e) {
          if (e instanceof Cancelled || generation.current !== mine) return
          setState((s) => ({ ...s, status: 'error' }))
        }
      })()
    }, 400)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [letter, settings, sender, title])

  useEffect(
    () => () => {
      generation.current++
      void shown.current?.close()
    },
    [],
  )

  return state
}
