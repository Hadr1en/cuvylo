import { createElement, useEffect, useRef, useState } from 'react'
import type { CvSettings } from '@/domain/cv'
import type { ProfileData } from '@/domain/profile'
import { findFitScale } from '@/fit'
import { Cancelled, enqueue, loadEngines, openPdf, type OpenPdf } from './engine'
import type { ExtractedPdf } from './extract'

export { loadEngines } from './engine'

/** Résultat de l'ajustement automatique au nombre de pages demandé. */
export interface FitInfo {
  scale: number
  pages: number
  reached: boolean
}

export type PdfState =
  | { status: 'idle' | 'rendering'; blob: Blob | null; extracted: ExtractedPdf | null; doc: OpenPdf | null; fit: FitInfo | null }
  | { status: 'ready'; blob: Blob; extracted: ExtractedPdf; doc: OpenPdf; fit: FitInfo | null }
  | { status: 'error'; blob: Blob | null; extracted: ExtractedPdf | null; doc: OpenPdf | null; fit: FitInfo | null; message: string }

/** Génère le PDF d'un CV (avec l'échelle donnée) : utilisé par l'aperçu, l'export et l'ajustement. */
export async function renderCvBlob(data: ProfileData, settings: CvSettings, opts: { title?: string | undefined; scale?: number } = {}): Promise<Blob> {
  const { pdf, CvDocument } = await loadEngines()
  return pdf(createElement(CvDocument, { data, settings, title: opts.title, scale: opts.scale ?? 1 })).toBlob()
}

async function countPages(blob: Blob): Promise<number> {
  const open = await openPdf(new Uint8Array(await blob.arrayBuffer()))
  try {
    return open.doc.numPages
  } finally {
    await open.close()
  }
}

/**
 * Génère le PDF du CV (source de vérité de l'aperçu, de l'export et de l'analyse ATS), l'ouvre
 * une seule fois avec pdf.js et en extrait le texte ; le même document sert à l'aperçu.
 * Régénère après `delay` ms sans modification ; une génération obsolète est abandonnée.
 * Si `settings.targetPages` vaut 1 ou 2, l'échelle typographique est réduite (jusqu'à un plancher
 * de lisibilité) pour tenir dans ce nombre de pages.
 */
export function useCvPdf(data: ProfileData | null, settings: CvSettings | null, title?: string, delay = 400): PdfState {
  const [state, setState] = useState<PdfState>({ status: 'idle', blob: null, extracted: null, doc: null, fit: null })
  const generation = useRef(0)
  const shown = useRef<OpenPdf | null>(null)

  useEffect(() => {
    if (!data || !settings) return
    const mine = ++generation.current
    const abort = new AbortController()
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, status: 'rendering' }))
      void (async () => {
        let opened: OpenPdf | null = null
        try {
          const { extractPdfText } = await loadEngines()
          const { blob, fit } = await enqueue(async () => {
            let b = await renderCvBlob(data, settings, { title })
            if (!settings.targetPages) return { blob: b, fit: null }
            const pages = await countPages(b)
            if (pages <= settings.targetPages) return { blob: b, fit: { scale: 1, pages, reached: true } }
            const r = await findFitScale(async (scale) => {
              if (generation.current !== mine) throw new Cancelled()
              return countPages(await renderCvBlob(data, settings, { title, scale }))
            }, settings.targetPages, { pagesAtMax: pages })
            b = await renderCvBlob(data, settings, { title, scale: r.scale })
            return { blob: b, fit: r }
          }, abort.signal)
          if (generation.current !== mine) return
          opened = await openPdf(new Uint8Array(await blob.arrayBuffer()))
          const extracted = await extractPdfText(opened.doc)
          if (generation.current !== mine) {
            await opened.close()
            return
          }
          const previous = shown.current
          shown.current = opened
          setState({ status: 'ready', blob, extracted, doc: opened, fit })
          // L'ancien document est fermé après le changement d'aperçu.
          setTimeout(() => void previous?.close(), 0)
        } catch (e) {
          if (opened && shown.current !== opened) await opened.close()
          if (e instanceof Cancelled || generation.current !== mine) return
          console.error('Échec de génération du PDF', e instanceof Error ? e.message : e)
          setState((s) => ({ ...s, status: 'error', message: 'La génération du PDF a échoué.' }))
        }
      })()
    }, delay)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [data, settings, title, delay])

  useEffect(
    () => () => {
      generation.current++
      void shown.current?.close()
    },
    [],
  )

  return state
}

export function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'cv'
  )
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
