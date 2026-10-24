import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type Cv, type VersionKind, type VersionSummary } from '@/api/client'
import type { CvSettings } from '@/domain/cv'
import { migrateProfile, type ProfileData } from '@/domain/profile'
import { diffCv } from '@/diff'
import { errorMessage, formatDate, relativeTime } from '@/lib/format'
import { Dialog } from '@/ui/Dialog'
import { TextField } from '@/ui/fields'
import { IconHistory } from '@/ui/Icons'

interface Props {
  cvId: string
  /** État affiché dans l'éditeur, pour comparer une version avec lui. */
  current: { title: string; settings: CvSettings; data: ProfileData }
  /** Appelé avant toute action serveur pour que la dernière frappe soit enregistrée. */
  beforeAction: () => Promise<void>
  onRestored: (cv: Cv) => void
}

const KIND_LABEL: Record<VersionKind, string> = { manual: 'Manuelle', auto: 'Automatique', restore: 'Avant restauration' }

/** Ancien serveur : le type se déduit du libellé. */
function kindOf(v: VersionSummary): VersionKind {
  if (v.kind) return v.kind
  if (v.label === 'auto') return 'auto'
  if (v.label === 'avant restauration') return 'restore'
  return 'manual'
}

export function VersionsPanel({ cvId, current, beforeAction, onRestored }: Props) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<VersionSummary | null>(null)
  const [compare, setCompare] = useState<{ version: VersionSummary; changes: ReturnType<typeof diffCv> } | null>(null)
  const [showAuto, setShowAuto] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setVersions((await api.listVersions(cvId)).versions)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [cvId])

  useEffect(() => {
    let cancelled = false
    api
      .listVersions(cvId)
      .then(({ versions }) => !cancelled && setVersions(versions))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [cvId])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await beforeAction()
      await api.createVersion(cvId, label.trim())
      setLabel('')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function restore(v: VersionSummary) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await beforeAction()
      const { cv } = await api.restoreVersion(cvId, v.id)
      setConfirm(null)
      onRestored(cv)
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function openCompare(v: VersionSummary) {
    try {
      const { version } = await api.getVersion(cvId, v.id)
      setCompare({ version: v, changes: diffCv(migrateProfile(version.data) as ProfileData, current.data) })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const list = versions?.filter((v) => showAuto || kindOf(v) !== 'auto') ?? null
  const autoCount = versions?.filter((v) => kindOf(v) === 'auto').length ?? 0

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-lg">Versions</h2>
        <p className="mt-1 text-sm text-muted">Points de retour nommés. Des sauvegardes automatiques sont aussi prises lors des modifications importantes.</p>
      </div>
      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <TextField className="min-w-0 flex-1" label="Nom de la version" value={label} onChange={setLabel} maxLength={120} placeholder="Avant adaptation à l’offre Acme" />
        <button className="btn" type="submit" disabled={busy || !label.trim()}>
          <IconHistory /> Enregistrer
        </button>
      </form>

      {error ? (
        <p role="alert" className="notice notice-danger text-sm">
          {error}
        </p>
      ) : null}

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[0.93rem]">Historique</h3>
          {autoCount > 0 ? (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={showAuto} onChange={(e) => setShowAuto(e.target.checked)} /> Afficher les {autoCount} sauvegardes automatiques
            </label>
          ) : null}
        </div>
        {list === null ? (
          <p className="text-sm text-muted">Chargement…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted">Aucune version pour l’instant.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-line rounded-md border border-line bg-surface p-0">
            {list.map((v) => {
              const kind = kindOf(v)
              return (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[0.93rem] font-semibold text-ink">{kind === 'manual' ? v.label : KIND_LABEL[kind]}</p>
                    <p className="text-sm text-muted" title={formatDate(v.createdAt, true)}>
                      {relativeTime(v.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button className="btn btn-sm btn-ghost" onClick={() => void openCompare(v)} aria-label={`Comparer la version ${v.label} avec l’état actuel`}>
                      Comparer
                    </button>
                    <button className="btn btn-sm" onClick={() => setConfirm(v)} aria-label={`Restaurer la version ${v.label}`}>
                      Restaurer
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <Dialog
        open={confirm !== null}
        title="Restaurer cette version ?"
        description="L’état actuel est d’abord archivé : vous pourrez y revenir."
        onClose={() => setConfirm(null)}
      >
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => confirm && void restore(confirm)}>
            Restaurer
          </button>
        </div>
      </Dialog>

      <Dialog open={compare !== null} title="Différences avec l’état actuel" description={compare ? `Version « ${compare.version.label} » → contenu actuel du CV.` : null} onClose={() => setCompare(null)} width="max-w-2xl">
        {compare && compare.changes.length === 0 ? <p className="text-sm text-muted">Aucune différence de contenu.</p> : null}
        <ul className="m-0 grid max-h-[60vh] list-none gap-2 overflow-y-auto p-0">
          {compare?.changes.map((c, i) => (
            <li key={i} className="rounded-md border border-line p-3 text-sm">
              <p className="font-semibold text-ink">{[c.section, c.item, c.field].filter(Boolean).join(' › ')}</p>
              {c.before ? <p className="mt-1 rounded bg-danger-soft px-2 py-1 text-danger line-through decoration-1">{c.before}</p> : null}
              {c.after ? <p className="mt-1 rounded bg-ok-soft px-2 py-1 text-ok">{c.after}</p> : null}
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  )
}
