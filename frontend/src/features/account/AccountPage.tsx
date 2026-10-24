import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { renderSVG } from 'uqr'
import { api, type SessionInfo, type Usage } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { errorMessage, fieldError, formatBytes, formatDate, relativeTime } from '@/lib/format'
import { downloadBlob } from '@/pdf/usePdf'
import { TextField } from '@/ui/fields'
import { IconDownload, IconKey, IconTrash } from '@/ui/Icons'
import { PageHeader } from '@/ui/Shell'
import { useToast } from '@/ui/Toast'
import { useDocumentTitle } from '@/ui/useDocumentTitle'

const CONFIRM_WORD = 'SUPPRIMER'

function Card({ id, title, description, children, tone }: { id: string; title: string; description?: ReactNode; children: ReactNode; tone?: 'danger' }) {
  return (
    <section aria-labelledby={id} className={`card p-5 ${tone === 'danger' ? 'border-danger/60' : ''}`}>
      <h2 id={id} className={`text-lg ${tone === 'danger' ? '!text-danger' : ''}`}>
        {title}
      </h2>
      {description ? <div className="mt-1 text-sm text-muted">{description}</div> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Feedback({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error)
    return (
      <p role="alert" className="mt-3 text-sm text-danger">
        {error}
      </p>
    )
  if (ok)
    return (
      <p role="status" className="mt-3 text-sm text-ok">
        {ok}
      </p>
    )
  return null
}

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [ok, setOk] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || next !== confirm) return
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      await api.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setOk('Mot de passe modifié. Vos autres sessions ont été fermées.')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const currentErr = fieldError(error, 'currentPassword') ?? (error && (error as { code?: string }).code === 'invalid_password' ? 'Mot de passe incorrect.' : undefined)
  const nextErr = fieldError(error, 'newPassword')
  return (
    <Card id="compte-mdp" title="Mot de passe" description="Changer de mot de passe ferme toutes vos autres sessions.">
      <form onSubmit={submit} className="grid gap-3 sm:max-w-sm" noValidate>
        <TextField label="Mot de passe actuel" type="password" autoComplete="current-password" value={current} onChange={setCurrent} error={currentErr} required />
        <TextField label="Nouveau mot de passe" type="password" autoComplete="new-password" value={next} onChange={setNext} hint="12 caractères minimum." error={nextErr} required />
        <TextField label="Confirmer" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={confirm && next !== confirm ? 'Les deux saisies diffèrent.' : undefined} required />
        <button type="submit" className="btn justify-self-start" disabled={busy || !current || next.length < 12 || next !== confirm}>
          {busy ? 'Enregistrement…' : 'Changer le mot de passe'}
        </button>
      </form>
      <Feedback error={error && !currentErr && !nextErr ? errorMessage(error) : null} ok={ok} />
    </Card>
  )
}

function TotpCard() {
  const { user, refresh } = useAuth()
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const qr = useMemo(() => (setup ? `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(setup.otpauthUri, { border: 2 }))}` : null), [setup])
  const enabled = user?.mfaEnabled === true

  async function run(f: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await f()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (codes) {
    return (
      <Card id="compte-2fa" title="Double authentification activée" description="Conservez ces codes de secours hors ligne : chacun permet une connexion si vous perdez votre téléphone. Ils ne seront plus affichés.">
        <ul className="grid grid-cols-2 gap-1 rounded-md bg-sunken p-3 font-mono text-sm sm:max-w-sm">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn btn-sm" onClick={() => downloadBlob(new Blob([`Codes de secours Cuvylo (${user?.email})\n\n${codes.join('\n')}\n`], { type: 'text/plain' }), 'cuvylo-codes-secours.txt')}>
            <IconDownload /> Télécharger
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setCodes(null)}>
            C’est noté
          </button>
        </div>
      </Card>
    )
  }

  if (enabled) {
    return (
      <Card id="compte-2fa" title="Double authentification" description={<span className="badge badge-ok">Activée</span>}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              await api.totpDisable(password)
              setPassword('')
              await refresh()
            })
          }}
          className="grid gap-3 sm:max-w-sm"
        >
          <TextField label="Mot de passe (pour désactiver)" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
          <button type="submit" className="btn btn-danger justify-self-start" disabled={busy || !password}>
            Désactiver
          </button>
        </form>
        <Feedback error={error} />
      </Card>
    )
  }

  return (
    <Card
      id="compte-2fa"
      title="Double authentification"
      description="Un code à 6 chiffres, généré par une application (Aegis, 2FAS, Google Authenticator, 1Password…), est demandé en plus du mot de passe."
    >
      {!setup ? (
        <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => setSetup(await api.totpSetup()))}>
          <IconKey /> Configurer
        </button>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          {qr ? <img src={qr} alt="QR code à scanner avec l’application d’authentification" className="size-40 rounded-md border border-line bg-white p-1" /> : null}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                const r = await api.totpEnable(code.trim())
                setCodes(r.recoveryCodes)
                setSetup(null)
                setCode('')
                await refresh()
              })
            }}
            className="grid content-start gap-3"
          >
            <p className="text-sm text-muted">
              Scannez le QR code, ou saisissez la clé : <span className="break-all font-mono text-ink">{setup.secret}</span>
            </p>
            <TextField label="Code affiché par l’application" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={setCode} maxLength={6} />
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={busy || code.trim().length !== 6}>
                Activer
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setSetup(null)}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}
      <Feedback error={error} />
    </Card>
  )
}

function SessionsCard() {
  const toast = useToast()
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .listSessions()
      .then((r) => !cancelled && setSessions(r.sessions))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [])

  async function revoke(id: string) {
    try {
      await api.revokeSession(id)
      setSessions((l) => l?.filter((s) => s.id !== id) ?? null)
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' })
    }
  }
  async function revokeOthers() {
    try {
      await api.revokeOtherSessions()
      setSessions((l) => l?.filter((s) => s.current) ?? null)
      toast.show('Autres sessions fermées')
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' })
    }
  }

  const others = sessions?.filter((s) => !s.current).length ?? 0
  return (
    <Card id="compte-sessions" title="Sessions ouvertes" description="Appareils actuellement connectés à votre compte. Fermez ce que vous ne reconnaissez pas.">
      {error ? <Feedback error={error} /> : null}
      {sessions === null && !error ? <p className="text-sm text-muted">Chargement…</p> : null}
      {sessions && sessions.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-line rounded-md border border-line p-0">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[0.93rem] font-semibold text-ink">
                  {s.device || 'Appareil inconnu'} {s.current ? <span className="badge badge-accent ml-1">Cette session</span> : null}
                </p>
                <p className="text-sm text-muted">
                  Ouverte le {formatDate(s.createdAt)} · active {relativeTime(s.lastSeenAt)}
                </p>
              </div>
              {!s.current ? (
                <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => void revoke(s.id)}>
                  Fermer
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {others > 0 ? (
        <button type="button" className="btn btn-sm mt-3" onClick={() => void revokeOthers()}>
          Fermer les {others} autre{others > 1 ? 's' : ''} session{others > 1 ? 's' : ''}
        </button>
      ) : null}
    </Card>
  )
}

function UsageCard() {
  const [usage, setUsage] = useState<Usage | null>(null)
  useEffect(() => {
    let cancelled = false
    api
      .usage()
      .then((u) => !cancelled && setUsage(u))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  if (!usage) return null
  const pct = usage.limitBytes > 0 ? Math.min(100, Math.round((usage.bytes / usage.limitBytes) * 100)) : 0
  return (
    <Card id="compte-espace" title="Espace utilisé" description="Profil, CV, versions, lettres et candidatures. Les plus anciennes versions automatiques sont les premières à supprimer si besoin.">
      <div className="h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Espace utilisé">
        <div className={`h-full rounded-full ${pct > 85 ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="num mt-2 text-sm text-muted">
        {formatBytes(usage.bytes)} sur {formatBytes(usage.limitBytes)} · {usage.cvs} CV · {usage.versions} versions · {usage.letters} lettres · {usage.applications} candidatures
      </p>
    </Card>
  )
}

/** Page « Compte » : sécurité, sessions, espace, export complet (portabilité) et suppression (effacement). */
export default function AccountPage() {
  useDocumentTitle('Compte')
  const { user, deleteAccount } = useAuth()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<unknown>(null)

  async function exportAll() {
    setExporting(true)
    setExportError(null)
    try {
      const data = await api.exportAccount()
      const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
      downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `cuvylo-export-${day}.json`)
    } catch (e) {
      setExportError(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  async function remove(e: FormEvent) {
    e.preventDefault()
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      // La garde de route renvoie d'elle-même vers la connexion, qui annonce la suppression.
      await deleteAccount(password)
    } catch (err) {
      setDeleteError(err)
      setPassword('')
      setDeleting(false)
    }
  }

  const passwordError = fieldError(deleteError, 'password') ?? (deleteError && !fieldError(deleteError, 'password') ? errorMessage(deleteError) : undefined)

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
      <PageHeader
        title="Compte"
        description="Sécurité de l’accès et données que l’instance conserve sur vous."
      />

      <div className="grid gap-4">
        <Card id="compte-identite" title="Identité du compte">
          <dl className="m-0 grid gap-x-6 gap-y-2 text-[0.93rem] sm:grid-cols-[9rem_1fr]">
            <dt className="font-semibold text-muted">E-mail</dt>
            <dd className="m-0">{user?.email}</dd>
            <dt className="font-semibold text-muted">Nom affiché</dt>
            <dd className="m-0">{user?.displayName ?? <span className="text-faint">—</span>}</dd>
            <dt className="font-semibold text-muted">Créé le</dt>
            <dd className="m-0">{formatDate(user?.createdAt)}</dd>
          </dl>
        </Card>

        <PasswordCard />
        <TotpCard />
        <SessionsCard />
        <UsageCard />

        <Card
          id="compte-export"
          title="Exporter toutes mes données"
          description={
            <>
              Un fichier JSON avec votre compte, votre profil, vos CV et leurs versions, vos lettres et candidatures. Détail dans la{' '}
              <Link to="/confidentialite" className="link">
                politique de confidentialité
              </Link>
              .
            </>
          }
        >
          <button type="button" className="btn" onClick={() => void exportAll()} disabled={exporting}>
            <IconDownload /> {exporting ? 'Préparation…' : 'Exporter (JSON)'}
          </button>
          <Feedback error={exportError} />
        </Card>

        <Card
          id="compte-suppression"
          tone="danger"
          title="Supprimer mon compte"
          description={
            <>
              Effacement <strong className="font-semibold text-ink">immédiat et définitif</strong> du compte et de toutes ses données. Exportez d’abord ce que vous
              voulez garder.
            </>
          }
        >
          <form onSubmit={remove} className="grid gap-3 sm:max-w-sm" noValidate>
            <TextField label="Mot de passe actuel" type="password" autoComplete="current-password" value={password} onChange={setPassword} error={passwordError} />
            <TextField label={`Tapez ${CONFIRM_WORD} pour confirmer`} autoComplete="off" value={confirm} onChange={setConfirm} spellCheck={false} />
            <button type="submit" className="btn btn-danger-solid justify-self-start" disabled={deleting || !password || confirm.trim() !== CONFIRM_WORD}>
              <IconTrash /> {deleting ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          </form>
        </Card>
      </div>
    </div>
  )
}
