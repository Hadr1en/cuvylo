import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type CvSummary, type LetterData, type LetterSummary } from '@/api/client'
import { ACCENT_PRESETS } from '@/domain/cv'
import { useUndoableDelete } from '@/hooks/useUndoableDelete'
import { errorMessage, relativeTime } from '@/lib/format'
import { Dialog } from '@/ui/Dialog'
import { SelectField, TextField } from '@/ui/fields'
import { IconPlus, IconTrash } from '@/ui/Icons'
import { PageHeader } from '@/ui/Shell'
import { useToast } from '@/ui/Toast'
import { useDocumentTitle } from '@/ui/useDocumentTitle'

export function emptyLetter(): LetterData {
  const date = new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  return {
    recipient: { name: '', company: '', address: '' },
    subject: '',
    opening: 'Madame, Monsieur,',
    paragraphs: ['', '', ''],
    closing: 'Je vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations distinguées.',
    signature: '',
    place: '',
    date,
  }
}

export default function LettersPage() {
  useDocumentTitle('Lettres')
  const navigate = useNavigate()
  const toast = useToast()
  const [letters, setLetters] = useState<LetterSummary[] | null>(null)
  const [cvs, setCvs] = useState<CvSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.listLetters(), api.listCvs()])
      .then(([l, c]) => {
        if (cancelled) return
        setLetters(l.letters)
        setCvs(c.cvs)
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const remove = useUndoableDelete<LetterSummary>({
    remove: (id) => api.deleteLetter(id),
    hide: (l) => setLetters((x) => x?.filter((y) => y.id !== l.id) ?? null),
    restore: (l) => setLetters((x) => (x && !x.some((y) => y.id === l.id) ? [l, ...x] : x)),
    label: (l) => `« ${l.title} »`,
    onError: (e) => toast.show(errorMessage(e), { tone: 'danger' }),
  })

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
      <PageHeader
        title="Lettres de motivation"
        description="Des lettres assorties à vos CV : mêmes polices, même couleur, même identité."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <IconPlus /> Nouvelle lettre
          </button>
        }
      />
      {error ? (
        <p role="alert" className="notice notice-danger mb-4 text-sm">
          {error}
        </p>
      ) : null}
      <div className="card overflow-hidden">
        {letters === null && !error ? (
          <p className="p-6 text-muted">Chargement…</p>
        ) : !letters || letters.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="font-semibold text-ink">Aucune lettre</p>
            <p className="mt-1 text-sm text-muted">Une lettre courte et précise, adaptée à chaque offre, vaut mieux qu’un modèle générique.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Lettre</th>
                <th scope="col" className="hidden sm:table-cell">CV associé</th>
                <th scope="col" className="hidden sm:table-cell">Modifiée</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {letters.map((l) => (
                <tr key={l.id}>
                  <td className="max-w-[20rem]">
                    <Link to={`/lettres/${l.id}`} className="block truncate font-semibold text-ink hover:text-accent-text hover:underline">
                      {l.title}
                    </Link>
                  </td>
                  <td className="hidden max-w-[14rem] truncate text-muted sm:table-cell">{cvs.find((c) => c.id === l.cvId)?.title ?? '—'}</td>
                  <td className="hidden whitespace-nowrap text-muted sm:table-cell">{relativeTime(l.updatedAt)}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Link to={`/lettres/${l.id}`} className="btn btn-sm">
                        Ouvrir
                      </Link>
                      <button type="button" className="btn btn-ghost btn-sm btn-icon btn-danger" aria-label={`Supprimer ${l.title}`} title="Supprimer" onClick={() => remove(l)}>
                        <IconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <NewLetterDialog open={creating} cvs={cvs} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/lettres/${id}`)} />
    </div>
  )
}

function NewLetterDialog({ open, cvs, onClose, onCreated }: { open: boolean; cvs: CvSummary[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [cvId, setCvId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !title.trim()) return
    setBusy(true)
    setError(null)
    try {
      // La lettre reprend le modèle et la couleur du CV associé.
      const cv = cvId ? (await api.getCv(cvId)).cv : null
      const { letter } = await api.createLetter({
        title: title.trim(),
        cvId: cvId || null,
        settings: { template: cv?.settings.template ?? 'classic', accent: cv?.settings.accent ?? ACCENT_PRESETS[0].value, locale: cv?.settings.locale ?? 'fr' },
        data: emptyLetter(),
      })
      onCreated(letter.id)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} title="Nouvelle lettre" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <TextField label="Nom de la lettre" value={title} onChange={setTitle} maxLength={120} placeholder="Acme — Cheffe de projet" required />
        <SelectField
          label="CV associé"
          value={cvId}
          onChange={setCvId}
          options={[{ value: '', label: 'Aucun (identité du profil)' }, ...cvs.map((c) => ({ value: c.id, label: c.title }))]}
          hint="Coordonnées, modèle et couleur sont repris du CV."
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>
            Créer
          </button>
        </div>
      </form>
    </Dialog>
  )
}
