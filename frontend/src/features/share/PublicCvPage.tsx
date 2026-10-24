import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, type PublicCv } from '@/api/client'
import { normalizeSettings } from '@/domain/cv'
import { migrateProfile, type ProfileData } from '@/domain/profile'
import { errorMessage, formatDate } from '@/lib/format'
import { PdfPages } from '@/pdf/PdfPages'
import { downloadBlob, slugify, useCvPdf } from '@/pdf/usePdf'
import { IconDownload } from '@/ui/Icons'
import { LegalFooter } from '@/ui/LegalFooter'
import { Wordmark } from '@/ui/Shell'
import { useDocumentTitle } from '@/ui/useDocumentTitle'

/**
 * /p/:slug — CV partagé par lien : instantané figé, lecture seule, sans compte.
 * Le PDF est régénéré dans le navigateur à partir des données partagées (même moteur que l'export).
 */
export default function PublicCvPage() {
  const { slug = '' } = useParams()
  const [cv, setCv] = useState<PublicCv | null>(null)
  const [error, setError] = useState<string | null>(null)
  useDocumentTitle(cv?.title ?? 'CV partagé')

  // Une page partagée n'a pas vocation à être indexée par les moteurs de recherche.
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .publicCv(slug)
      .then((r) => !cancelled && setCv({ ...r, data: migrateProfile(r.data) as ProfileData, settings: normalizeSettings(r.settings) }))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [slug])

  const pdf = useCvPdf(cv?.data ?? null, cv?.settings ?? null, cv?.title, 0)

  return (
    <div className="flex min-h-dvh flex-col bg-sunken">
      <header className="bg-nav text-nav-strong">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-5">
          <Wordmark inverse />
          {cv ? (
            <button type="button" className="btn btn-sm btn-primary" disabled={!pdf.blob} onClick={() => pdf.blob && downloadBlob(pdf.blob, `${slugify(cv.title)}.pdf`)}>
              <IconDownload /> Télécharger le PDF
            </button>
          ) : null}
        </div>
      </header>
      <main id="contenu" className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-8">
        {error ? (
          <div className="card mx-auto max-w-md p-6 text-center">
            <h1 className="text-lg">Lien indisponible</h1>
            <p className="mt-1 text-muted">Ce lien a été révoqué, a expiré ou n’existe pas.</p>
          </div>
        ) : !cv ? (
          <p role="status" className="p-10 text-center text-muted">
            Chargement…
          </p>
        ) : (
          <>
            <h1 className="sr-only">{cv.title}</h1>
            <p className="mb-4 text-center text-sm text-muted">Partagé le {formatDate(cv.sharedAt)} · version figée</p>
            <PdfPages doc={pdf.doc?.doc ?? null} busy={pdf.status === 'rendering'} />
          </>
        )}
      </main>
      <footer className="border-t border-line bg-paper">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <LegalFooter />
          <span className="text-sm text-faint">Créé avec Cuvylo</span>
        </div>
      </footer>
    </div>
  )
}
