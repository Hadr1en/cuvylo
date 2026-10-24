import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { fullName, type ProfileData } from '@/domain/profile'
import { validateProfile } from '@/domain/validate'
import { clearDraft, readDraft, useAutosave } from '@/hooks/useAutosave'
import { errorMessage, formatDate } from '@/lib/format'
import { parseProfileFile, serializeProfile } from '@/lib/profileFile'
import { downloadBlob } from '@/pdf/usePdf'
import { Dialog } from '@/ui/Dialog'
import { IconDownload, IconUpload } from '@/ui/Icons'
import { useToast } from '@/ui/Toast'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { ProfileForm } from './ProfileForm'
import { SaveIndicator } from './SaveIndicator'
import { SaveProblems } from './SaveProblems'
import { importFile, IMPORT_ACCEPT } from './importers'

export default function ProfilePage() {
  useDocumentTitle('Profil')
  const { user } = useAuth()
  const toast = useToast()
  const draftKey = `cuvylo-draft-profile-${user?.id ?? 'anon'}`
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)
  // Brouillon proposé par une autre page (analyse d'un PDF) : même confirmation qu'un import de fichier.
  const location = useLocation()
  const [pendingImport, setPendingImport] = useState<{ data: ProfileData; source: string; notes: string[] } | null>(() => {
    const s = location.state as { importDraft?: ProfileData; source?: string; notes?: string[] } | null
    return s?.importDraft ? { data: s.importDraft, source: s.source ?? 'un brouillon', notes: s.notes ?? [] } : null
  })
  const [draft, setDraft] = useState<{ savedAt: string; value: ProfileData } | null>(null)
  const revision = useRef<number | undefined>(undefined)
  const fileInput = useRef<HTMLInputElement>(null)

  const { status, issues, touch, flush, reset, resume } = useAutosave<ProfileData>({
    draftKey,
    validate: validateProfile,
    save: async (data) => {
      const r = await api.putProfile(data, revision.current)
      revision.current = r.revision
    },
  })

  useEffect(() => {
    let cancelled = false
    api
      .getProfile()
      .then(({ data, updatedAt, revision: rev }) => {
        if (cancelled) return
        revision.current = rev
        setProfile(data)
        // Brouillon local plus récent que le serveur : on propose de le reprendre.
        const d = readDraft<ProfileData>(draftKey)
        if (d && Date.parse(d.savedAt) > Date.parse(updatedAt)) setDraft(d)
        else if (d) clearDraft(draftKey)
      })
      .catch((e: unknown) => !cancelled && setLoadError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [draftKey])

  const edit = useCallback(
    (next: ProfileData) => {
      setProfile(next)
      touch(next)
    },
    [touch],
  )

  const replaceAll = useCallback(
    (next: ProfileData) => {
      edit(next)
      setFormKey((k) => k + 1)
    },
    [edit],
  )

  function exportJson() {
    if (!profile) return
    downloadBlob(new Blob([serializeProfile(profile)], { type: 'application/json' }), 'cuvylo-profil.json')
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const result = await importFile(file, parseProfileFile)
    if (result.ok) setPendingImport({ data: result.data, source: result.source, notes: result.notes })
    else toast.show(result.error, { tone: 'danger' })
  }

  async function takeServerVersion() {
    try {
      const r = await api.getProfile()
      revision.current = r.revision
      reset()
      setProfile(r.data)
      setFormKey((k) => k + 1)
    } catch (err) {
      toast.show(errorMessage(err), { tone: 'danger' })
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="p-10 text-center text-danger">
        {loadError}
      </p>
    )
  }
  if (!profile) {
    return (
      <p role="status" className="p-10 text-center text-muted">
        Chargement…
      </p>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
      <header className="mb-5">
        <h1 className="text-[1.6rem]">Profil principal</h1>
        <p className="mt-1 max-w-xl text-muted">
          Renseignez votre parcours une fois. Chaque CV en est une copie que vous adaptez ensuite sans toucher à l’original.
        </p>
      </header>

      <div className="sticky top-14 z-20 -mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper/95 px-5 py-2.5 backdrop-blur sm:-mx-8 sm:px-8 lg:top-0">
        <SaveIndicator status={status} issueCount={issues.length} onRetry={() => void flush().catch(() => undefined)} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()}>
            <IconUpload /> Importer
          </button>
          <button type="button" className="btn btn-sm" onClick={exportJson}>
            <IconDownload /> Exporter
          </button>
          <input ref={fileInput} type="file" accept={IMPORT_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Fichier à importer" onChange={(e) => void onFile(e)} />
          <Link to="/" className="btn btn-sm btn-primary">
            Créer un CV
          </Link>
        </div>
      </div>

      {draft ? (
        <div role="status" className="notice notice-info mb-4">
          <p className="font-semibold text-ink">Modifications non enregistrées retrouvées</p>
          <p className="text-sm text-muted">Un brouillon du {formatDate(draft.savedAt, true)} est plus récent que la version enregistrée.</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                replaceAll(draft.value)
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
        data={profile}
        onKeepMine={() => {
          revision.current = undefined
          void resume()
        }}
        onTakeTheirs={() => void takeServerVersion()}
      />

      <ProfileForm key={formKey} value={profile} onChange={edit} issues={issues} />

      <Dialog
        open={pendingImport !== null}
        title="Remplacer le profil ?"
        description={
          pendingImport ? (
            <>
              Import depuis {pendingImport.source} : « {fullName(pendingImport.data) || 'profil sans nom'} ». Le contenu actuel sera remplacé ; exportez-le
              d’abord si vous voulez le conserver. Vos CV existants ne changent pas.
            </>
          ) : null
        }
        onClose={() => setPendingImport(null)}
      >
        {pendingImport?.notes.length ? (
          <ul className="mb-4 list-disc pl-5 text-sm text-muted">
            {pendingImport.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setPendingImport(null)}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (!pendingImport) return
              replaceAll(pendingImport.data)
              setPendingImport(null)
              toast.show('Profil importé. Relisez chaque rubrique.')
            }}
          >
            Remplacer
          </button>
        </div>
      </Dialog>
    </div>
  )
}
