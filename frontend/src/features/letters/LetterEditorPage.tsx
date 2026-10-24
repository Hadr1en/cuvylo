import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api, type CvSummary, type Letter, type LetterData, type LetterSettings } from '@/api/client'
import { emptyProfile, type ProfileData } from '@/domain/profile'
import { SaveIndicator } from '@/features/profile/SaveIndicator'
import { useAuth } from '@/auth/AuthContext'
import { clearDraft, readDraft, useAutosave } from '@/hooks/useAutosave'
import { errorMessage, formatDate } from '@/lib/format'
import { PdfPages } from '@/pdf/PdfPages'
import { useLetterPdf } from '@/pdf/useLetterPdf'
import { downloadBlob, slugify } from '@/pdf/usePdf'
import { SelectField, TextArea, TextField } from '@/ui/fields'
import { IconArrowLeft, IconDownload, IconPlus, IconTrash } from '@/ui/Icons'
import { useDocumentTitle } from '@/ui/useDocumentTitle'

interface Doc {
  title: string
  cvId: string | null
  settings: LetterSettings
  data: LetterData
}

export default function LetterEditorPage() {
  const { id = '' } = useParams()
  return <LetterEditor key={id} id={id} />
}

function LetterEditor({ id }: { id: string }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [cvs, setCvs] = useState<CvSummary[]>([])
  const [sender, setSender] = useState<ProfileData['identity'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit')
  const [draft, setDraft] = useState<{ savedAt: string; value: Doc } | null>(null)
  const latest = useRef<Doc | null>(null)
  const revision = useRef<number | undefined>(undefined)
  const { user } = useAuth()
  const draftKey = `cuvylo-draft-letter-${user?.id ?? 'anon'}-${id}`
  useDocumentTitle(doc?.title ?? 'Lettre')

  const { status, touch, flush, reset, resume } = useAutosave<Doc>({
    draftKey,
    save: async (d) => {
      const { letter } = await api.putLetter(id, { ...d, revision: revision.current })
      revision.current = letter.revision
    },
  })

  /** Conflit (modifiée dans un autre onglet) : on reprend la version enregistrée, la saisie locale est abandonnée. */
  async function takeServerVersion() {
    try {
      const { letter } = await api.getLetter(id)
      const d = toDoc(letter)
      revision.current = letter.revision
      latest.current = d
      setDoc(d)
      reset()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const loadSender = useCallback(async (cvId: string | null) => {
    try {
      setSender(cvId ? (await api.getCv(cvId)).cv.data.identity : (await api.getProfile()).data.identity)
    } catch {
      setSender(emptyProfile().identity)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([api.getLetter(id), api.listCvs()])
      .then(([{ letter }, { cvs }]) => {
        if (cancelled) return
        const d = toDoc(letter)
        revision.current = letter.revision
        latest.current = d
        setDoc(d)
        setCvs(cvs)
        void loadSender(letter.cvId)
        // Coupure ou rechargement avant l'enregistrement : le brouillon local plus récent est proposé.
        const saved = readDraft<Doc>(draftKey)
        if (saved && Date.parse(saved.savedAt) > Date.parse(letter.updatedAt)) setDraft(saved)
        else if (saved) clearDraft(draftKey)
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof ApiError && e.status === 404 ? 'Cette lettre est introuvable.' : errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [id, loadSender, draftKey])

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
  const setData = (p: Partial<LetterData>) => latest.current && edit({ data: { ...latest.current.data, ...p } })

  const pdf = useLetterPdf(doc?.data ?? null, doc?.settings ?? null, sender, doc?.title)

  if (error) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p role="alert" className="mb-4">
          {error}
        </p>
        <Link to="/lettres" className="btn">
          Retour aux lettres
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

  const words = doc.data.paragraphs.join(' ').split(/\s+/).filter(Boolean).length

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:h-dvh">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-3 py-2 sm:px-4">
        <Link to="/lettres" className="btn btn-ghost btn-icon" aria-label="Retour aux lettres" title="Retour aux lettres">
          <IconArrowLeft />
        </Link>
        <div className="min-w-0 flex-1 basis-48">
          <label htmlFor="letter-title" className="sr-only">
            Nom de la lettre
          </label>
          <input
            id="letter-title"
            className="w-full truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-[1.15rem] font-semibold text-ink hover:border-line focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            value={doc.title}
            maxLength={120}
            onChange={(e) => edit({ title: e.target.value })}
          />
        </div>
        <SaveIndicator status={status} onRetry={() => void flush().catch(() => undefined)} />
        <div className="flex rounded-md border border-line p-0.5 lg:hidden" role="group" aria-label="Affichage">
          {(['edit', 'preview'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={mobileView === v} onClick={() => setMobileView(v)} className={`rounded px-3 py-1 text-sm font-semibold ${mobileView === v ? 'bg-sunken text-ink' : 'text-muted'}`}>
              {v === 'edit' ? 'Éditer' : 'Aperçu'}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary btn-sm" disabled={!pdf.blob || pdf.status === 'rendering'} onClick={() => pdf.blob && downloadBlob(pdf.blob, `${slugify(doc.title)}.pdf`)}>
          <IconDownload /> PDF
        </button>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(420px,560px)_1fr]">
        <section aria-label="Rédaction" className={`min-h-0 overflow-y-auto border-r border-line bg-paper p-4 sm:p-5 ${mobileView === 'edit' ? 'block' : 'hidden'} lg:block`}>
          <div className="grid gap-4">
            {draft ? (
              <div role="status" className="notice notice-info">
                <p className="font-semibold text-ink">Modifications non enregistrées retrouvées</p>
                <p className="text-sm text-muted">Brouillon local du {formatDate(draft.savedAt, true)}, plus récent que la version enregistrée.</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      edit(draft.value)
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
            {status === 'conflict' ? (
              <div role="alert" className="notice notice-warn">
                <p className="font-semibold text-ink">Cette lettre a été modifiée ailleurs</p>
                <p className="text-sm text-muted">
                  Dans un autre onglet ou un autre appareil. L’enregistrement est suspendu : choisissez la version à garder.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      revision.current = undefined
                      void resume()
                    }}
                  >
                    Garder ma version
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void takeServerVersion()}>
                    Reprendre la version enregistrée
                  </button>
                </div>
              </div>
            ) : null}
            <SelectField
              label="CV associé"
              value={doc.cvId ?? ''}
              onChange={(v) => {
                edit({ cvId: v || null })
                void loadSender(v || null)
              }}
              options={[{ value: '', label: 'Aucun (identité du profil)' }, ...cvs.map((c) => ({ value: c.id, label: c.title }))]}
              hint="L’en-tête reprend les coordonnées de ce CV."
            />
            <fieldset className="card grid gap-3 p-4">
              <legend className="px-1 text-[0.93rem] font-semibold text-ink">Destinataire</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Nom" value={doc.data.recipient.name} onChange={(v) => setData({ recipient: { ...doc.data.recipient, name: v } })} maxLength={200} placeholder="Mme Dupont, DRH" />
                <TextField label="Entreprise" value={doc.data.recipient.company} onChange={(v) => setData({ recipient: { ...doc.data.recipient, company: v } })} maxLength={200} />
              </div>
              <TextArea label="Adresse" rows={2} value={doc.data.recipient.address} onChange={(v) => setData({ recipient: { ...doc.data.recipient, address: v } })} maxLength={400} />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Lieu" value={doc.data.place} onChange={(v) => setData({ place: v })} maxLength={100} placeholder="Lyon" />
                <TextField label="Date" value={doc.data.date} onChange={(v) => setData({ date: v })} maxLength={100} />
              </div>
            </fieldset>
            <TextField label="Objet" value={doc.data.subject} onChange={(v) => setData({ subject: v })} maxLength={200} placeholder="Candidature au poste de cheffe de projet (réf. 1234)" />
            <TextField label="Formule d’appel" value={doc.data.opening} onChange={(v) => setData({ opening: v })} maxLength={200} />
            <fieldset className="grid gap-3">
              <legend className="label">Corps de la lettre</legend>
              <p className="-mt-1 text-sm text-faint">
                Trois paragraphes suffisent : vous (ce que vous apportez), eux (pourquoi cette entreprise), nous (la suite). {words} mot{words > 1 ? 's' : ''}
                {words > 400 ? ' : c’est long, une page se lit mieux.' : '.'}
              </p>
              {doc.data.paragraphs.map((p, i) => (
                <div key={i} className="flex items-start gap-1">
                  <TextArea
                    className="flex-1"
                    label={`Paragraphe ${i + 1}`}
                    rows={4}
                    value={p}
                    maxLength={3000}
                    onChange={(v) => setData({ paragraphs: doc.data.paragraphs.map((x, j) => (j === i ? v : x)) })}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-danger mt-6"
                    aria-label={`Supprimer le paragraphe ${i + 1}`}
                    title="Supprimer"
                    onClick={() => setData({ paragraphs: doc.data.paragraphs.filter((_, j) => j !== i) })}
                  >
                    <IconTrash />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-sm justify-self-start" disabled={doc.data.paragraphs.length >= 10} onClick={() => setData({ paragraphs: [...doc.data.paragraphs, ''] })}>
                <IconPlus /> Ajouter un paragraphe
              </button>
            </fieldset>
            <TextArea label="Formule de politesse" rows={2} value={doc.data.closing} onChange={(v) => setData({ closing: v })} maxLength={400} />
            <TextField label="Signature" value={doc.data.signature} onChange={(v) => setData({ signature: v })} maxLength={200} hint="Vide : votre nom." />
            <SelectField
              label="Langue"
              value={doc.settings.locale}
              onChange={(v) => edit({ settings: { ...doc.settings, locale: v } })}
              options={[
                { value: 'fr', label: 'Français' },
                { value: 'en', label: 'Anglais' },
              ]}
            />
          </div>
        </section>
        <section aria-label="Aperçu A4" className={`min-h-0 flex-col bg-sunken ${mobileView === 'preview' ? 'flex' : 'hidden'} lg:flex`}>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            {pdf.status === 'error' ? (
              <p role="alert" className="notice notice-danger mb-4 text-sm">
                La génération du PDF a échoué.
              </p>
            ) : null}
            <PdfPages doc={pdf.doc?.doc ?? null} busy={pdf.status === 'rendering'} />
          </div>
        </section>
      </div>
    </div>
  )
}

function toDoc(l: Letter): Doc {
  return { title: l.title, cvId: l.cvId, settings: l.settings, data: l.data }
}
