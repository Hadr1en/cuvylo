import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Application, type CvSummary } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { TEMPLATE_INFO } from '@/domain/cv'
import { profileCompleteness, type ProfileData } from '@/domain/profile'
import { useUndoableDelete } from '@/hooks/useUndoableDelete'
import { errorMessage, relativeTime } from '@/lib/format'
import { Dialog } from '@/ui/Dialog'
import { SelectField, TextField } from '@/ui/fields'
import { IconCopy, IconPlus, IconSearch, IconTrash } from '@/ui/Icons'
import { PageHeader } from '@/ui/Shell'
import { useToast } from '@/ui/Toast'
import { useDocumentTitle } from '@/ui/useDocumentTitle'

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; cvs: CvSummary[]; profile: ProfileData; applications: Application[] | null }

const ACTIVE_STATUSES = new Set(['applied', 'interview', 'offer'])

export function DashboardPage() {
  useDocumentTitle('Mes CV')
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.listCvs(),
      api.getProfile(),
      // Les candidatures sont un complément : leur absence ne bloque pas le tableau de bord.
      api.listApplications().then((r) => r.applications).catch(() => null),
    ])
      .then(([{ cvs }, { data }, applications]) => !cancelled && setLoad({ state: 'ready', cvs, profile: data, applications }))
      .catch((e: unknown) => !cancelled && setLoad({ state: 'error', message: errorMessage(e) }))
    return () => {
      cancelled = true
    }
  }, [])

  const setCvs = (f: (cvs: CvSummary[]) => CvSummary[]) => setLoad((l) => (l.state === 'ready' ? { ...l, cvs: f(l.cvs) } : l))
  const removeCv = useUndoableDelete<CvSummary>({
    remove: (id) => api.deleteCv(id),
    hide: (cv) => setCvs((l) => l.filter((c) => c.id !== cv.id)),
    restore: (cv) => setCvs((l) => (l.some((c) => c.id === cv.id) ? l : [...l, cv].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))),
    label: (cv) => `« ${cv.title} »`,
    onError: (e) => toast.show(errorMessage(e), { tone: 'danger' }),
  })

  async function duplicate(cv: CvSummary) {
    if (busyId) return
    setBusyId(cv.id)
    try {
      const { cv: copy } = await api.createCv({ title: `${cv.title} (copie)`.slice(0, 120), kind: cv.kind, source: { type: 'cv', id: cv.id } })
      navigate(`/cv/${copy.id}`)
    } catch (err) {
      toast.show(errorMessage(err), { tone: 'danger' })
      setBusyId(null)
    }
  }

  if (load.state === 'loading') {
    return (
      <p role="status" className="p-10 text-center text-muted">
        Chargement…
      </p>
    )
  }
  if (load.state === 'error') {
    return (
      <div className="mx-auto max-w-xl p-10 text-center">
        <p role="alert" className="text-danger">
          {load.message}
        </p>
        <button className="btn mt-4" onClick={() => window.location.reload()}>
          Réessayer
        </button>
      </div>
    )
  }

  const { cvs, profile, applications } = load
  const completeness = Math.round(profileCompleteness(profile) * 100)
  const fullName = [profile.identity.firstName, profile.identity.lastName].filter(Boolean).join(' ')
  const name = user?.displayName?.trim() || profile.identity.firstName
  const active = applications?.filter((a) => ACTIVE_STATUSES.has(a.status)) ?? []
  const nextAction = applications
    ?.filter((a) => a.nextActionAt)
    .sort((a, b) => (a.nextActionAt ?? '').localeCompare(b.nextActionAt ?? ''))[0]

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
      <PageHeader
        title="Mes CV"
        description={name ? `Bonjour ${name}.` : undefined}
        actions={
          <>
            <Link to="/analyse" className="btn">
              <IconSearch /> Analyser un PDF
            </Link>
            <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={completeness === 0}>
              <IconPlus /> Nouveau CV
            </button>
          </>
        }
      />

      <section aria-label="Résumé" className="mb-8 grid gap-3 sm:grid-cols-3">
        <Metric label="CV" value={String(cvs.length)} detail={cvs[0] ? `Dernière modification ${relativeTime(cvs[0].updatedAt)}` : 'Aucun pour l’instant'} />
        <Metric
          label="Candidatures en cours"
          value={applications ? String(active.length) : '—'}
          detail={nextAction ? `Prochaine action : ${nextAction.company || nextAction.position}` : applications ? 'Aucune relance prévue' : 'Indisponible'}
          to="/candidatures"
        />
        <Metric label="Profil principal" value={`${completeness} %`} detail={fullName || 'À compléter'} to="/profil" progress={completeness} />
      </section>

      {completeness === 0 ? (
        <div className="notice notice-info mb-6">
          <p className="font-semibold text-ink">Commencez par votre profil</p>
          <p className="text-sm text-muted">
            Un CV est une copie de votre profil principal que vous adaptez ensuite librement. Vous pouvez aussi importer un export LinkedIn ou
            un fichier JSON.
          </p>
          <Link to="/profil" className="btn btn-primary btn-sm mt-3">
            Renseigner mon profil
          </Link>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        {cvs.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="font-semibold text-ink">Aucun CV</p>
            <p className="mt-1 text-sm text-muted">Créez un premier CV à partir de votre profil.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <caption className="sr-only">Vos CV, du plus récemment modifié au plus ancien</caption>
              <thead>
                <tr>
                  <th scope="col">Nom</th>
                  <th scope="col" className="hidden sm:table-cell">Type</th>
                  <th scope="col" className="hidden md:table-cell">Modèle</th>
                  <th scope="col" className="hidden sm:table-cell">Modifié</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cvs.map((cv) => (
                  <tr key={cv.id}>
                    <td className="max-w-[18rem]">
                      <Link to={`/cv/${cv.id}`} className="block truncate font-semibold text-ink hover:text-accent-text hover:underline">
                        {cv.title}
                      </Link>
                    </td>
                    <td className="hidden sm:table-cell">
                      <span className={`badge ${cv.kind === 'tailored' ? 'badge-accent' : ''}`}>{cv.kind === 'tailored' ? 'Adapté' : 'Base'}</span>
                    </td>
                    <td className="hidden text-muted md:table-cell">{TEMPLATE_INFO[cv.template]?.label ?? cv.template}</td>
                    <td className="hidden whitespace-nowrap text-muted sm:table-cell">{relativeTime(cv.updatedAt)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Link to={`/cv/${cv.id}`} className="btn btn-sm">
                          Ouvrir
                        </Link>
                        <button
                          className="btn btn-ghost btn-sm btn-icon"
                          aria-label={`Dupliquer ${cv.title}`}
                          title="Dupliquer"
                          disabled={busyId !== null}
                          onClick={() => void duplicate(cv)}
                        >
                          <IconCopy />
                        </button>
                        <button className="btn btn-ghost btn-sm btn-icon btn-danger" aria-label={`Supprimer ${cv.title}`} title="Supprimer" onClick={() => removeCv(cv)}>
                          <IconTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewCvDialog open={creating} cvs={cvs} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/cv/${id}`)} />
    </div>
  )
}

function Metric({ label, value, detail, to, progress }: { label: string; value: string; detail: string; to?: string; progress?: number }) {
  const body = (
    <>
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="num mt-1 text-[1.6rem] font-semibold leading-none text-ink">{value}</p>
      {progress !== undefined ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      <p className="mt-2 truncate text-sm text-muted">{detail}</p>
    </>
  )
  return to ? (
    <Link to={to} className="card block p-4 transition-colors hover:border-line-strong">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  )
}

function NewCvDialog({ open, cvs, onClose, onCreated }: { open: boolean; cvs: CvSummary[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [source, setSource] = useState('profile')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const from = source === 'profile' ? undefined : cvs.find((c) => c.id === source)
      const { cv } = await api.createCv({
        title: title.trim(),
        kind: from?.kind ?? 'base',
        source: from ? { type: 'cv', id: from.id } : { type: 'profile' },
      })
      onCreated(cv.id)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} title="Nouveau CV" description="Le CV est une copie indépendante : modifiez-le sans toucher à votre profil." onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <TextField label="Nom du CV" hint="Pour vous y retrouver : « Chef de projet — Acme », « Version courte »…" value={title} onChange={setTitle} maxLength={120} required />
        <SelectField
          label="Partir de"
          value={source}
          onChange={setSource}
          options={[{ value: 'profile', label: 'Mon profil principal' }, ...cvs.map((c) => ({ value: c.id, label: `Copie de « ${c.title} »` }))]}
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
            {busy ? 'Création…' : 'Créer'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
