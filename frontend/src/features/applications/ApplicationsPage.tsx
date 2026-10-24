import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { APPLICATION_STATUSES, api, type Application, type ApplicationInput, type ApplicationStatus, type CvSummary } from '@/api/client'
import { useUndoableDelete } from '@/hooks/useUndoableDelete'
import { errorMessage, formatDate } from '@/lib/format'
import { Dialog } from '@/ui/Dialog'
import { SelectField, TextArea, TextField } from '@/ui/fields'
import { IconExternal, IconPlus, IconTrash } from '@/ui/Icons'
import { PageHeader } from '@/ui/Shell'
import { useToast } from '@/ui/Toast'
import { useDocumentTitle } from '@/ui/useDocumentTitle'

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: 'À envoyer',
  applied: 'Envoyée',
  interview: 'Entretien',
  offer: 'Offre reçue',
  rejected: 'Refusée',
  withdrawn: 'Abandonnée',
}

const STATUS_BADGE: Record<ApplicationStatus, string> = {
  draft: '',
  applied: 'badge-accent',
  interview: 'badge-warn',
  offer: 'badge-ok',
  rejected: 'badge-danger',
  withdrawn: '',
}

function emptyInput(): ApplicationInput {
  return { company: '', position: '', url: '', posting: '', cvId: null, status: 'draft', appliedAt: null, nextActionAt: null, notes: '' }
}

/** "2026-10-24T00:00:00Z" ou "2026-10-24" → valeur d'un <input type="date">. */
const toDateInput = (v: string | null) => (v ? v.slice(0, 10) : '')

type Filter = 'active' | 'all' | ApplicationStatus

export default function ApplicationsPage() {
  useDocumentTitle('Candidatures')
  const toast = useToast()
  const [items, setItems] = useState<Application[] | null>(null)
  const [cvs, setCvs] = useState<CvSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Application | 'new' | null>(null)
  const [filter, setFilter] = useState<Filter>('active')

  useEffect(() => {
    let cancelled = false
    Promise.all([api.listApplications(), api.listCvs()])
      .then(([a, c]) => {
        if (cancelled) return
        setItems(a.applications)
        setCvs(c.cvs)
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const remove = useUndoableDelete<Application>({
    remove: (id) => api.deleteApplication(id),
    hide: (a) => setItems((l) => l?.filter((x) => x.id !== a.id) ?? null),
    restore: (a) => setItems((l) => (l && !l.some((x) => x.id === a.id) ? [a, ...l] : l)),
    label: (a) => `Candidature ${a.company || a.position}`,
    onError: (e) => toast.show(errorMessage(e), { tone: 'danger' }),
  })

  const shown = useMemo(() => {
    const list = items ?? []
    const f =
      filter === 'all' ? list : filter === 'active' ? list.filter((a) => a.status !== 'rejected' && a.status !== 'withdrawn') : list.filter((a) => a.status === filter)
    // Prochaine action la plus proche d'abord, puis les plus récentes.
    return [...f].sort((a, b) => (a.nextActionAt ?? '9999').localeCompare(b.nextActionAt ?? '9999') || b.updatedAt.localeCompare(a.updatedAt))
  }, [items, filter])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const a of items ?? []) c[a.status] = (c[a.status] ?? 0) + 1
    return c
  }, [items])

  const today = new Date().toISOString().slice(0, 10)

  // La liste n'inclut pas le texte de l'annonce : on charge la candidature complète avant d'éditer.
  async function openEdit(a: Application) {
    try {
      setEditing((await api.getApplication(a.id)).application)
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' })
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
      <PageHeader
        title="Candidatures"
        description="Suivez vos candidatures, le CV envoyé et la prochaine relance."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <IconPlus /> Nouvelle candidature
          </button>
        }
      />

      {error ? (
        <p role="alert" className="notice notice-danger mb-4 text-sm">
          {error}
        </p>
      ) : null}

      <div className="tabs mb-4" role="tablist" aria-label="Filtrer par statut">
        {(['active', 'all', ...APPLICATION_STATUSES] as Filter[]).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className="tab" onClick={() => setFilter(f)}>
            {f === 'active' ? 'En cours' : f === 'all' ? 'Toutes' : STATUS_LABELS[f]}
            {f !== 'active' && f !== 'all' && counts[f] ? <span className="num ml-1.5 text-faint">{counts[f]}</span> : null}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {items === null && !error ? (
          <p className="p-6 text-muted">Chargement…</p>
        ) : shown.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="font-semibold text-ink">Aucune candidature ici</p>
            <p className="mt-1 text-sm text-muted">Notez chaque candidature pour savoir quel CV vous avez envoyé et quand relancer.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Entreprise et poste</th>
                  <th scope="col">Statut</th>
                  <th scope="col" className="hidden md:table-cell">CV envoyé</th>
                  <th scope="col" className="hidden sm:table-cell">Envoyée</th>
                  <th scope="col">Prochaine action</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => {
                  const cv = cvs.find((c) => c.id === a.cvId)
                  const late = a.nextActionAt && a.nextActionAt.slice(0, 10) < today
                  return (
                    <tr key={a.id}>
                      <td className="max-w-[18rem]">
                        <button type="button" className="block max-w-full truncate text-left font-semibold text-ink hover:text-accent-text hover:underline" onClick={() => void openEdit(a)}>
                          {a.company || 'Entreprise ?'}
                        </button>
                        <span className="block truncate text-sm text-muted">{a.position}</span>
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[a.status]}`}>{STATUS_LABELS[a.status]}</span>
                      </td>
                      <td className="hidden max-w-[12rem] truncate md:table-cell">
                        {cv ? (
                          <Link to={`/cv/${cv.id}`} className="link">
                            {cv.title}
                          </Link>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="num hidden whitespace-nowrap text-muted sm:table-cell">{formatDate(a.appliedAt) || '—'}</td>
                      <td className={`num whitespace-nowrap ${late ? 'font-semibold text-danger' : 'text-muted'}`}>{formatDate(a.nextActionAt) || '—'}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {a.url ? (
                            <a href={a.url} target="_blank" rel="noreferrer noopener" className="btn btn-ghost btn-sm btn-icon" aria-label={`Ouvrir l’annonce ${a.company}`} title="Ouvrir l’annonce">
                              <IconExternal />
                            </a>
                          ) : null}
                          <button type="button" className="btn btn-ghost btn-sm btn-icon btn-danger" aria-label={`Supprimer la candidature ${a.company}`} title="Supprimer" onClick={() => remove(a)}>
                            <IconTrash />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ApplicationDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'none')}
        open={editing !== null}
        initial={editing === 'new' || editing === null ? null : editing}
        cvs={cvs}
        onClose={() => setEditing(null)}
        onSaved={(a) => {
          setItems((l) => (l ? (l.some((x) => x.id === a.id) ? l.map((x) => (x.id === a.id ? a : x)) : [a, ...l]) : [a]))
          setEditing(null)
          toast.show('Candidature enregistrée')
        }}
      />
    </div>
  )
}

function ApplicationDialog({ open, initial, cvs, onClose, onSaved }: {
  open: boolean
  initial: Application | null
  cvs: CvSummary[]
  onClose: () => void
  onSaved: (a: Application) => void
}) {
  const [v, setV] = useState<ApplicationInput>(() => (initial ? { ...emptyInput(), ...initial, posting: initial.posting ?? '' } : emptyInput()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (p: Partial<ApplicationInput>) => setV((x) => ({ ...x, ...p }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const input: ApplicationInput = {
      company: v.company.trim(),
      position: v.position.trim(),
      url: v.url.trim() && !/^https?:\/\//i.test(v.url.trim()) ? `https://${v.url.trim()}` : v.url.trim(),
      posting: v.posting,
      cvId: v.cvId,
      status: v.status,
      appliedAt: v.appliedAt || null,
      nextActionAt: v.nextActionAt || null,
      notes: v.notes,
    }
    try {
      const { application } = initial ? await api.putApplication(initial.id, { ...input, revision: initial.revision }) : await api.createApplication(input)
      onSaved(application)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} title={initial ? 'Candidature' : 'Nouvelle candidature'} onClose={onClose} width="max-w-2xl">
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Entreprise" value={v.company} onChange={(x) => set({ company: x })} maxLength={200} />
          <TextField label="Poste" value={v.position} onChange={(x) => set({ position: x })} maxLength={200} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Statut" value={v.status} onChange={(x) => set({ status: x })} options={APPLICATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
          <SelectField
            label="CV envoyé"
            value={v.cvId ?? ''}
            onChange={(x) => set({ cvId: x || null })}
            options={[{ value: '', label: 'Aucun' }, ...cvs.map((c) => ({ value: c.id, label: c.title }))]}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Date d’envoi" type="date" value={toDateInput(v.appliedAt)} onChange={(x) => set({ appliedAt: x || null })} />
          <TextField label="Prochaine action" type="date" value={toDateInput(v.nextActionAt)} onChange={(x) => set({ nextActionAt: x || null })} hint="Relance, entretien…" />
        </div>
        <TextField label="Lien de l’annonce" type="url" inputMode="url" value={v.url} onChange={(x) => set({ url: x })} maxLength={500} placeholder="https://" />
        <TextArea label="Notes" rows={3} value={v.notes} onChange={(x) => set({ notes: x })} maxLength={4000} hint="Contacts, questions posées, impressions…" />
        <TextArea
          label="Texte de l’annonce (facultatif)"
          rows={4}
          value={v.posting}
          onChange={(x) => set({ posting: x })}
          maxLength={20000}
          hint="Conservé sur le serveur avec la candidature, pour la retrouver si l’annonce disparaît."
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || (!v.company.trim() && !v.position.trim())}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
