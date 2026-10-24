import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api, type Cv } from '@/api/client'
import { TEMPLATE_INFO, normalizeSettings, type CvSettings } from '@/domain/cv'
import { migrateProfile, type ProfileData } from '@/domain/profile'
import { validateProfile } from '@/domain/validate'
import { ProfileForm } from '@/features/profile/ProfileForm'
import { SaveIndicator } from '@/features/profile/SaveIndicator'
import { SaveProblems } from '@/features/profile/SaveProblems'
import { clearDraft, readDraft, useAutosave } from '@/hooks/useAutosave'
import { errorMessage, formatDate } from '@/lib/format'
import { PdfPages } from '@/pdf/PdfPages'
import { downloadBlob, renderCvBlob, slugify, useCvPdf } from '@/pdf/usePdf'
import { useAuth } from '@/auth/AuthContext'
import { IconArrowLeft, IconDownload } from '@/ui/Icons'
import { Menu } from '@/ui/Menu'
import { useToast } from '@/ui/Toast'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { AtsPanel } from './AtsPanel'
import { CvSettingsPanel } from './CvSettingsPanel'
import { JobPanel } from './JobPanel'
import { SharePanel } from './SharePanel'
import { StylePanel } from './StylePanel'
import { VersionsPanel } from './VersionsPanel'

interface Doc {
  title: string
  settings: CvSettings
  data: ProfileData
}

type Tab = 'content' | 'template' | 'ats' | 'job' | 'style' | 'versions' | 'share'
const TABS: { id: Tab; label: string }[] = [
  { id: 'content', label: 'Contenu' },
  { id: 'template', label: 'Mise en page' },
  { id: 'ats', label: 'Analyse ATS' },
  { id: 'job', label: 'Offre' },
  { id: 'style', label: 'Relecture' },
  { id: 'versions', label: 'Versions' },
  { id: 'share', label: 'Partage' },
]

/** La fiche de poste reste sur l'appareil (localStorage) : elle n'est jamais envoyée au serveur. */
const jobKey = (cvId: string) => `cuvylo-job-${cvId}`
function readPosting(cvId: string): string {
  try {
    return localStorage.getItem(jobKey(cvId)) ?? ''
  } catch {
    return ''
  }
}
function writePosting(cvId: string, text: string): void {
  try {
    if (text) localStorage.setItem(jobKey(cvId), text)
    else localStorage.removeItem(jobKey(cvId))
  } catch {
    /* stockage indisponible : l'analyse reste possible pour la session */
  }
}

const docOf = (cv: Cv): Doc => ({ title: cv.title, settings: normalizeSettings(cv.settings), data: migrateProfile(cv.data) as ProfileData })

/** `key={id}` : changer de CV remonte l'éditeur avec un état neuf. */
export default function CvEditorPage() {
  const { id = '' } = useParams()
  return <CvEditor key={id} id={id} />
}

function CvEditor({ id }: { id: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const draftKey = `cuvylo-draft-cv-${user?.id ?? 'anon'}-${id}`
  const [doc, setDoc] = useState<Doc | null>(null)
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null)
  const [tab, setTab] = useState<Tab>('content')
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit')
  const [formKey, setFormKey] = useState(0)
  const [posting, setPosting] = useState(() => readPosting(id))
  const [draft, setDraft] = useState<{ savedAt: string; value: Doc } | null>(null)
  const latest = useRef<Doc | null>(null)
  const revision = useRef<number | undefined>(undefined)
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})
  useDocumentTitle(doc?.title || 'CV')

  const { status, issues, touch, flush, reset, resume } = useAutosave<Doc>({
    draftKey,
    validate: (d) => validateProfile(d.data),
    save: async (d) => {
      const { cv } = await api.putCv(id, { ...d, revision: revision.current })
      revision.current = cv.revision
    },
  })

  useEffect(() => {
    let cancelled = false
    api
      .getCv(id)
      .then(({ cv }) => {
        if (cancelled) return
        const d = docOf(cv)
        revision.current = cv.revision
        latest.current = d
        setDoc(d)
        const saved = readDraft<Doc>(draftKey)
        if (saved && Date.parse(saved.savedAt) > Date.parse(cv.updatedAt)) setDraft(saved)
        else if (saved) clearDraft(draftKey)
      })
      .catch((e: unknown) => !cancelled && setError({ message: errorMessage(e), notFound: e instanceof ApiError && e.status === 404 }))
    return () => {
      cancelled = true
    }
  }, [id, draftKey])

  const edit = useCallback(
    (patch: Partial<Doc>) => {
      const base = latest.current
      if (!base) return
      const next = { ...base, ...patch }
      latest.current = next
      setDoc(next)
      touch(next)
    },
    [touch],
  )

  const replaceDoc = useCallback((d: Doc) => {
    latest.current = d
    setDoc(d)
    setFormKey((k) => k + 1)
  }, [])

  const pdf = useCvPdf(doc?.data ?? null, doc?.settings ?? null, doc?.title)

  /** Après une restauration : le serveur fait foi, rien d'ancien ne doit repartir. */
  const onRestored = useCallback(
    (cv: Cv) => {
      reset()
      revision.current = cv.revision
      replaceDoc(docOf(cv))
    },
    [replaceDoc, reset],
  )

  const onPosting = useCallback(
    (text: string) => {
      setPosting(text)
      writePosting(id, text)
    },
    [id],
  )

  const createTailored = useCallback(
    async (jobTitle: string | null) => {
      const current = latest.current
      if (!current) return
      await flush()
      const title = (jobTitle ? `${current.title} — ${jobTitle}` : `${current.title} (adapté)`).slice(0, 120)
      const { cv } = await api.createCv({ title, kind: 'tailored', source: { type: 'cv', id } })
      writePosting(cv.id, posting)
      navigate(`/cv/${cv.id}`)
    },
    [flush, id, navigate, posting],
  )

  async function takeServerVersion() {
    try {
      const { cv } = await api.getCv(id)
      onRestored(cv)
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' })
    }
  }

  async function exportAs(kind: 'pdf' | 'pdf-ats' | 'docx' | 'txt' | 'jsonresume') {
    if (!doc) return
    // Dossier anonymisé : le nom du fichier ne trahit pas le titre interne (« CV Alice Martin »).
    const name = doc.settings.anonymize ? (doc.settings.locale === 'en' ? 'skills-profile' : 'dossier-de-competences') : slugify(doc.title)
    try {
      if (kind === 'pdf') {
        if (pdf.blob) downloadBlob(pdf.blob, `${name}.pdf`)
      } else if (kind === 'pdf-ats') {
        const blob = await renderCvBlob(doc.data, { ...doc.settings, template: 'classic', showPhoto: false, targetPages: 0 }, { title: doc.title })
        downloadBlob(blob, `${name}-ats.pdf`)
      } else if (kind === 'docx') {
        const { exportDocx } = await import('@/export/docx')
        downloadBlob(await exportDocx(doc.data, doc.settings), `${name}.docx`)
      } else if (kind === 'txt') {
        const { exportText } = await import('@/export/text')
        downloadBlob(new Blob([exportText(doc.data, doc.settings)], { type: 'text/plain;charset=utf-8' }), `${name}.txt`)
      } else {
        const { toJsonResume } = await import('@/import/jsonresume')
        downloadBlob(new Blob([JSON.stringify(toJsonResume(doc.data), null, 2)], { type: 'application/json' }), `${name}.resume.json`)
      }
    } catch (e) {
      console.error('Export impossible', e instanceof Error ? e.message : e)
      toast.show('Export impossible. Réessayez.', { tone: 'danger' })
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p role="alert" className="mb-4">
          {error.notFound ? 'Ce CV est introuvable.' : error.message}
        </p>
        <Link to="/" className="btn">
          Retour à mes CV
        </Link>
      </div>
    )
  }
  if (!doc) {
    return (
      <p role="status" className="p-10 text-center text-muted">
        Chargement…
      </p>
    )
  }

  const stale = pdf.status === 'rendering'
  const pageCount = pdf.extracted?.pages ?? 0
  const charCount = pdf.extracted?.text.replace(/\s/g, '').length ?? 0
  const twoColumns = TEMPLATE_INFO[doc.settings.template].ats !== 'high'

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:h-dvh">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-3 py-2 sm:px-4">
        <Link to="/" className="btn btn-ghost btn-icon" aria-label="Retour à mes CV" title="Retour à mes CV">
          <IconArrowLeft />
        </Link>
        <div className="min-w-0 flex-1 basis-48">
          <label htmlFor="cv-title" className="sr-only">
            Nom du CV
          </label>
          <input
            id="cv-title"
            className="w-full truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-[1.15rem] font-semibold text-ink hover:border-line focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            value={doc.title}
            maxLength={120}
            onChange={(e) => edit({ title: e.target.value })}
          />
        </div>
        <SaveIndicator status={status} issueCount={issues.length} onRetry={() => void flush().catch(() => undefined)} />
        <div className="flex rounded-md border border-line p-0.5 lg:hidden" role="group" aria-label="Affichage">
          {(['edit', 'preview'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={mobileView === v}
              onClick={() => setMobileView(v)}
              className={`rounded px-3 py-1 text-sm font-semibold ${mobileView === v ? 'bg-sunken text-ink' : 'text-muted'}`}
            >
              {v === 'edit' ? 'Éditer' : 'Aperçu'}
            </button>
          ))}
        </div>
        <Menu
          label="Exporter"
          icon={<IconDownload />}
          className="btn btn-primary btn-sm"
          items={[
            { label: 'PDF', description: 'Le fichier affiché dans l’aperçu.', onSelect: () => void exportAs('pdf'), disabled: !pdf.blob || stale },
            ...(twoColumns
              ? [{ label: 'PDF une colonne (ATS)', description: 'Même contenu, modèle Classique : lecture linéaire garantie par la mise en page.', onSelect: () => void exportAs('pdf-ats') }]
              : []),
            { label: 'Word (.docx)', description: 'Pour les plateformes qui exigent un fichier Word.', onSelect: () => void exportAs('docx') },
            { label: 'Texte brut (.txt)', description: 'À coller dans un formulaire de candidature.', onSelect: () => void exportAs('txt') },
            { label: 'JSON Resume', description: 'Format ouvert, réutilisable dans d’autres outils.', onSelect: () => void exportAs('jsonresume') },
          ]}
        />
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(440px,600px)_1fr]">
        <section aria-label="Édition" className={`min-h-0 flex-col overflow-hidden border-r border-line ${mobileView === 'edit' ? 'flex' : 'hidden'} lg:flex`}>
          <div role="tablist" aria-label="Panneaux d’édition" className="tabs overflow-x-auto bg-surface px-3">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el
                }}
                id={`tab-${t.id}`}
                role="tab"
                type="button"
                aria-selected={tab === t.id}
                aria-controls="panel-edit"
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  let next: number | null = null
                  if (e.key === 'ArrowRight') next = (i + 1) % TABS.length
                  if (e.key === 'ArrowLeft') next = (i + TABS.length - 1) % TABS.length
                  if (e.key === 'Home') next = 0
                  if (e.key === 'End') next = TABS.length - 1
                  if (next === null) return
                  e.preventDefault()
                  const target = TABS[next]!.id
                  setTab(target)
                  tabRefs.current[target]?.focus()
                }}
                className="tab"
              >
                {t.label}
              </button>
            ))}
          </div>
          <div id="panel-edit" role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto bg-paper p-4 sm:p-5">
            {draft ? (
              <div role="status" className="notice notice-info mb-4">
                <p className="font-semibold text-ink">Modifications non enregistrées retrouvées</p>
                <p className="text-sm text-muted">Brouillon local du {formatDate(draft.savedAt, true)}, plus récent que la version enregistrée.</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      const d = { ...draft.value, settings: normalizeSettings(draft.value.settings) }
                      replaceDoc(d)
                      touch(d)
                      setDraft(null)
                    }}
                  >
                    Reprendre le brouillon
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      clearDraft(draftKey)
                      setDraft(null)
                    }}
                  >
                    Ignorer
                  </button>
                </div>
              </div>
            ) : null}
            <SaveProblems
              status={status}
              issues={issues}
              data={doc.data}
              onKeepMine={() => {
                revision.current = undefined
                void resume()
              }}
              onTakeTheirs={() => void takeServerVersion()}
            />
            {tab === 'content' ? <ProfileForm key={formKey} value={doc.data} onChange={(data) => edit({ data })} issues={issues} /> : null}
            {tab === 'template' ? <CvSettingsPanel settings={doc.settings} data={doc.data} onChange={(settings) => edit({ settings })} fit={pdf.fit} /> : null}
            {tab === 'ats' ? <AtsPanel data={doc.data} settings={doc.settings} extracted={pdf.extracted} rendering={stale} /> : null}
            {tab === 'job' ? <JobPanel posting={posting} onPostingChange={onPosting} data={doc.data} onCreateTailored={createTailored} /> : null}
            {tab === 'style' ? <StylePanel data={doc.data} /> : null}
            {tab === 'versions' ? <VersionsPanel cvId={id} current={doc} beforeAction={flush} onRestored={onRestored} /> : null}
            {tab === 'share' ? <SharePanel cvId={id} anonymized={doc.settings.anonymize} beforeAction={flush} /> : null}
          </div>
        </section>

        <section aria-label="Aperçu A4" className={`min-h-0 flex-col bg-sunken ${mobileView === 'preview' ? 'flex' : 'hidden'} lg:flex`}>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            {pdf.status === 'error' ? (
              <p role="alert" className="notice notice-danger mb-4 text-sm">
                {pdf.message}
              </p>
            ) : null}
            <div className={`transition-opacity duration-150 ${stale ? 'opacity-70' : ''}`}>
              <PdfPages doc={pdf.doc?.doc ?? null} busy={stale} />
            </div>
          </div>
          <p className="border-t border-line bg-surface px-4 py-2 text-sm text-muted" role="status">
            {pageCount > 0 ? (
              <>
                <span className="num">{pageCount}</span> page{pageCount > 1 ? 's' : ''} · <span className="num">{charCount.toLocaleString('fr-FR')}</span> caractères extractibles ·{' '}
              </>
            ) : null}
            L’aperçu est le PDF exporté, à l’identique.
          </p>
        </section>
      </div>
    </div>
  )
}
