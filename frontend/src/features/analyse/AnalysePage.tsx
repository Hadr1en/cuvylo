import { useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PdfScanResult } from '@/import/pdfscan'
import { SECTION_LABELS } from '@/domain/profile'
import { JobPanel } from '@/features/editor/JobPanel'
import { loadReader, openPdf } from '@/pdf/engine'
import { Disclosure } from '@/ui/fields'
import { IconAlert, IconCheck, IconUpload } from '@/ui/Icons'
import { PageHeader } from '@/ui/Shell'
import { useDocumentTitle } from '@/ui/useDocumentTitle'

const SEVERITY = {
  error: { label: 'À corriger', notice: 'notice-danger', badge: 'badge-danger' },
  warning: { label: 'À vérifier', notice: 'notice-warn', badge: 'badge-warn' },
  info: { label: 'Info', notice: 'notice-info', badge: '' },
} as const

/** Au-delà, ce n'est plus un CV : l'analyse s'arrête plutôt que de bloquer un téléphone. */
const MAX_PAGES = 10

/**
 * En tête du résultat : au plus trois actions concrètes, les plus importantes d'abord (constats à corriger,
 * puis à vérifier). Le détail suit.
 */
function NextSteps({ report }: { report: PdfScanResult['report'] }) {
  const steps = [...report.findings.filter((f) => f.severity === 'error'), ...report.findings.filter((f) => f.severity === 'warning')]
    .slice(0, 3)
    .map((f) => f.fix ?? f.message)
  if (steps.length === 0) return null
  return (
    <section aria-labelledby="next-steps" className="card border-l-[3px] border-l-accent p-4">
      <h3 id="next-steps" className="text-[0.95rem]">
        À faire en priorité
      </h3>
      <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-[0.93rem]">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </section>
  )
}

/** /analyse, dans l'application (personne connectée). La même analyse est publique sur /analyser. */
export default function AnalysePage() {
  useDocumentTitle('Analyser un PDF')
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
      <PageHeader
        title="Analyser un PDF"
        description="Vérifiez comment un CV existant, fait avec n’importe quel outil, est lu par un logiciel de recrutement."
      />
      <AnalyseTool
        next={(scan) => (
          <div className="card p-4">
            <p className="font-semibold text-ink">Repartir de ce CV</p>
            <p className="mt-1 text-sm text-muted">{scan.draftNotice}</p>
            <button
              type="button"
              className="btn mt-3"
              onClick={() => navigate('/profil', { state: { importDraft: scan.draft, source: 'votre PDF', notes: [scan.draftNotice] } })}
            >
              Utiliser comme brouillon de profil
            </button>
          </div>
        )}
      />
    </div>
  )
}

/**
 * Analyse d'un CV PDF existant, quel que soit l'outil qui l'a produit : ce qu'un analyseur
 * en extrait (ordre de lecture, coordonnées, rubriques, caractères illisibles), puis comparaison
 * facultative avec une offre. Le fichier est lu dans le navigateur et n'est jamais envoyé au serveur :
 * aucun compte n'est nécessaire. `next` : suite proposée sous le résultat (brouillon de profil, compte…).
 */
export function AnalyseTool({ next }: { next: (scan: PdfScanResult) => ReactNode }) {
  const input = useRef<HTMLInputElement>(null)
  const [posting, setPosting] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ name: string; scan: PdfScanResult } | null>(null)
  const [showText, setShowText] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Chaque analyse a un numéro : « Annuler » (ou une nouvelle analyse) rend la précédente caduque.
  const runId = useRef(0)

  async function analyse(file: File) {
    if (busy) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setError('Choisissez un fichier PDF.')
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('PDF trop volumineux (15 Mo au plus).')
      return
    }
    const run = ++runId.current
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      // Lecteur seul : le générateur de PDF, plus lourd, n'est pas nécessaire pour analyser.
      const [{ extractPdfText }, { scanPdf }] = await Promise.all([loadReader(), import('@/import/pdfscan')])
      const open = await openPdf(new Uint8Array(await file.arrayBuffer()))
      try {
        if (run !== runId.current) return
        if (open.doc.numPages > MAX_PAGES) {
          setError(`Ce PDF compte ${open.doc.numPages} pages : un CV en fait 1 à 3. L’analyse s’arrête à ${MAX_PAGES} pages.`)
          return
        }
        const scan = scanPdf(await extractPdfText(open.doc))
        if (run === runId.current) setResult({ name: file.name, scan })
      } finally {
        await open.close()
      }
    } catch {
      if (run === runId.current) setError('Ce PDF n’a pas pu être lu (fichier protégé, endommagé ou qui n’est pas un PDF).')
    } finally {
      if (run === runId.current) setBusy(false)
    }
  }

  function cancel() {
    runId.current++
    setBusy(false)
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void analyse(file)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void analyse(file)
  }

  const report = result?.scan.report
  const found = report ? [report.name, report.email, report.phone] : []

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`card flex flex-col items-center gap-3 border-dashed px-6 py-10 text-center ${dragging ? 'border-accent bg-accent-soft' : ''}`}
      >
        <IconUpload width={24} height={24} className="text-faint" />
        <p className="font-semibold text-ink">Déposez un CV au format PDF</p>
        <p className="text-sm text-muted">Le fichier est lu dans votre navigateur : il n’est envoyé nulle part.</p>
        {busy ? (
          <div className="flex items-center gap-2">
            <p role="status" className="m-0 text-sm font-semibold text-ink">
              Analyse…
            </p>
            <button type="button" className="btn btn-sm" onClick={cancel}>
              Annuler
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => input.current?.click()}>
            Choisir un fichier
          </button>
        )}
        <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} aria-label="CV au format PDF" onChange={onFile} />
      </div>

      {error ? (
        <p role="alert" className="notice notice-danger mt-4 text-sm">
          {error}
        </p>
      ) : null}

      {result && report ? (
        <div className="mt-6 grid gap-5" aria-live="polite">
          <div>
            <h2 className="text-lg">{result.name}</h2>
            <p className="text-sm text-muted">
              {report.pages} page{report.pages > 1 ? 's' : ''} · {report.lines.length} lignes de texte extraites
            </p>
          </div>

          <NextSteps report={report} />

          <section aria-label="Informations repérées" className="card grid gap-2 p-4 sm:grid-cols-3">
            {(['Nom', 'E-mail', 'Téléphone'] as const).map((label, i) => {
              const v = found[i]
              return (
                <div key={label}>
                  <p className="text-sm font-semibold text-muted">{label}</p>
                  <p className={`flex items-center gap-1.5 truncate text-[0.93rem] ${v ? 'text-ink' : 'text-danger'}`}>
                    {v ? <IconCheck className="shrink-0 text-ok" /> : <IconAlert className="shrink-0" />}
                    {v ? v.value : 'Non trouvé'}
                  </p>
                </div>
              )
            })}
          </section>

          <section aria-label="Rubriques repérées">
            <h3 className="mb-2 text-[0.93rem]">Rubriques repérées, dans l’ordre de lecture</h3>
            {report.headings.length === 0 ? (
              <p className="text-sm text-muted">Aucune rubrique reconnue.</p>
            ) : (
              <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {report.headings.map((h, i) => (
                  <li key={i} className={`badge ${h.key ? 'badge-accent' : ''}`}>
                    {h.text}
                    {h.key ? <span className="sr-only"> ({SECTION_LABELS[h.key]})</span> : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {report.findings.length === 0 ? (
            <p className="notice notice-ok m-0 flex items-center gap-2 text-sm">
              <IconCheck className="text-ok" /> Aucun problème de lecture repéré.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0" aria-label="Constats">
              {report.findings.map((f, i) => {
                const s = SEVERITY[f.severity]
                return (
                  <li key={`${f.id}-${i}`} className={`notice ${s.notice}`}>
                    <span className={`badge ${s.badge}`}>{s.label}</span>
                    <p className="mt-1.5 text-[0.93rem] font-semibold text-ink">{f.message}</p>
                    {f.fix ? <p className="mt-0.5 text-sm text-muted">{f.fix}</p> : null}
                    {f.examples?.length ? (
                      <ul className="mt-1 list-disc pl-5 font-mono text-xs text-muted">
                        {f.examples.map((x, j) => (
                          <li key={j}>{x}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}

          <p className="notice notice-info m-0 text-sm text-muted">
            Ces constats décrivent le texte que pdf.js extrait du fichier ; un logiciel de recrutement lit quelque chose de proche. Aucun outil ne peut garantir
            la lecture par un ATS précis.
          </p>

          <div className="border-t border-line pt-2">
            <Disclosure title="Texte lu dans le PDF" open={showText} onToggle={() => setShowText((o) => !o)}>
              <pre className="m-0 ml-6 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface p-3 font-mono text-xs leading-relaxed">
                {report.lines.map((l) => l.text).join('\n')}
              </pre>
            </Disclosure>
          </div>

          {/* Tout le texte extrait (pas le brouillon d'import, plafonné) : la comparaison porte sur ce que l'ATS a lu. */}
          <section className="card p-4 sm:p-5">
            <JobPanel posting={posting} onPostingChange={setPosting} text={report.lines.map((l) => l.text).join('\n')} />
          </section>

          {next(result.scan)}
        </div>
      ) : null}
    </div>
  )
}
