import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/** Largeur d'une page A4 à 96 dpi : on ne dépasse jamais la taille réelle. */
const A4_CSS_WIDTH = 794
const A4_RATIO = 842 / 595

/**
 * Affiche chaque page du PDF généré sur un canvas. L'aperçu est le PDF lui-même
 * (pas une maquette HTML) : ce qui est montré est exactement ce qui est exporté.
 * Le document est ouvert une seule fois par `useCvPdf` (qui en extrait aussi le texte).
 */
export function PdfPages({ doc, busy }: { doc: PDFDocumentProxy | null; busy: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.min(A4_CSS_WIDTH, Math.floor(entry.contentRect.width)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pages = doc?.numPages ?? 0
  return (
    <div ref={hostRef} className="relative w-full" aria-busy={busy}>
      <ol className="m-0 flex list-none flex-col items-center gap-5 p-0" aria-label="Pages du CV">
        {doc
          ? Array.from({ length: pages }, (_, i) => (
              <li key={i} className="sheet" style={{ width: width || undefined, aspectRatio: `1 / ${A4_RATIO}` }}>
                <PageCanvas doc={doc} pageNumber={i + 1} width={width} />
              </li>
            ))
          : null}
      </ol>
      {pages === 0 ? (
        <div className="sheet mx-auto grid place-items-center text-sm text-neutral-500" style={{ width: width || '100%', aspectRatio: `1 / ${A4_RATIO}` }}>
          Génération de l’aperçu…
        </div>
      ) : null}
    </div>
  )
}

function PageCanvas({ doc, pageNumber, width }: { doc: PDFDocumentProxy; pageNumber: number; width: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null

    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
        const viewport = page.getViewport({ scale: (width / base.width) * dpr })
        // Rendu hors écran puis copie : pas de page blanche visible pendant le redessin.
        const off = document.createElement('canvas')
        off.width = Math.floor(viewport.width)
        off.height = Math.floor(viewport.height)
        task = page.render({ canvas: off, viewport })
        await task.promise
        if (cancelled) return
        canvas.width = off.width
        canvas.height = off.height
        canvas.style.width = `${width}px`
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
        canvas.getContext('2d')?.drawImage(off, 0, 0)
      } catch {
        /* rendu annulé (document remplacé ou fermé) */
      }
    })()

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNumber, width])

  return <canvas ref={canvasRef} className="block" role="img" aria-label={`Page ${pageNumber} du CV`} />
}
