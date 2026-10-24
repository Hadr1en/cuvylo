import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { api, type AdminOverview, type AdminUser, type Invitation } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { errorMessage, formatBytes, formatDate, relativeTime } from '@/lib/format'
import { Dialog } from '@/ui/Dialog'
import { Switch, TextField } from '@/ui/fields'
import { IconCopy, IconPlus, IconTrash } from '@/ui/Icons'
import { Menu } from '@/ui/Menu'
import { PageHeader } from '@/ui/Shell'
import { useToast } from '@/ui/Toast'
import { useDocumentTitle } from '@/ui/useDocumentTitle'

const abs = (url: string) => new URL(url, window.location.origin).toString()

function CopyLink({ url, label }: { url: string; label: string }) {
  const toast = useToast()
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted">{label}</p>
      <p className="break-all rounded-md bg-sunken px-3 py-2 font-mono text-sm text-ink">{url}</p>
      <button
        type="button"
        className="btn btn-sm justify-self-start"
        onClick={() =>
          void navigator.clipboard.writeText(url).then(
            () => toast.show('Lien copié'),
            () => toast.show('Copie impossible : sélectionnez le lien.', { tone: 'danger' }),
          )
        }
      >
        <IconCopy /> Copier
      </button>
    </div>
  )
}

/**
 * Administration de l'instance (compte créé à l'installation, adresses d'ADMIN_EMAILS) : comptes et espace
 * utilisé, invitations, suppression, liens de réinitialisation DEMANDÉS par les utilisateurs. Volontairement
 * sans accès au contenu des CV ni téléchargement de la base.
 */
export default function AdminPage() {
  useDocumentTitle('Administration')
  const { user } = useAuth()
  const toast = useToast()
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [invitations, setInvitations] = useState<Invitation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [shownLink, setShownLink] = useState<{ title: string; label: string; url: string } | null>(null)
  const [deleting, setDeleting] = useState<AdminUser | null>(null)
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null)
  const [savingSetting, setSavingSetting] = useState(false)

  const load = useCallback(async () => {
    try {
      const [o, i] = await Promise.all([api.admin.overview(), api.admin.invitations()])
      setOverview(o)
      setInvitations(i.invitations)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([api.admin.overview(), api.admin.invitations(), api.admin.settings()])
      .then(([o, i, s]) => {
        if (cancelled) return
        setOverview(o)
        setInvitations(i.invitations)
        setRegistrationOpen(s.registrationOpen)
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [])
  if (user && !user.isAdmin) return <Navigate to="/" replace />

  async function resetLink(u: AdminUser) {
    try {
      const r = await api.admin.resetLink(u.id)
      setShownLink({ title: 'Lien de réinitialisation', label: `À transmettre à ${u.email} par un canal sûr. Valable jusqu’au ${formatDate(r.expiresAt, true)}, une seule fois.`, url: abs(r.url) })
      // La demande est consommée quand le lien sert ; elle reste affichée d'ici là.
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' })
    }
  }

  async function revokeSessions(u: AdminUser) {
    try {
      await api.admin.revokeSessions(u.id)
      toast.show(`${u.email} est déconnecté partout`)
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' })
    }
  }

  async function toggleRegistration(open: boolean) {
    if (savingSetting) return
    setSavingSetting(true)
    try {
      const r = await api.admin.updateSettings({ registrationOpen: open })
      setRegistrationOpen(r.registrationOpen)
      toast.show(r.registrationOpen ? 'Inscriptions ouvertes à tous' : 'Inscriptions sur invitation uniquement')
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' })
    } finally {
      setSavingSetting(false)
    }
  }

  async function deleteInvitation(inv: Invitation) {
    try {
      await api.admin.deleteInvitation(inv.id)
      setInvitations((l) => l?.filter((x) => x.id !== inv.id) ?? null)
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' })
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
      <PageHeader
        title="Administration"
        description="Comptes de l’instance, espace utilisé et invitations. Le contenu des CV reste privé : il n’est visible ni ici ni ailleurs."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setInviteOpen(true)}>
            <IconPlus /> Inviter
          </button>
        }
      />

      {error ? (
        <p role="alert" className="notice notice-danger mb-4 text-sm">
          {error}
        </p>
      ) : null}

      {overview ? (
        <section aria-label="Totaux" className="mb-6 grid gap-3 sm:grid-cols-4">
          {[
            ['Comptes', String(overview.totals.users)],
            ['CV', String(overview.totals.cvs)],
            ['Versions', String(overview.totals.versions)],
            ['Base de données', overview.databaseBytes !== null ? formatBytes(overview.databaseBytes) : formatBytes(overview.totals.bytes)],
          ].map(([label, value]) => (
            <div key={label} className="card p-4">
              <p className="text-sm font-semibold text-muted">{label}</p>
              <p className="num mt-1 text-[1.5rem] font-semibold leading-none text-ink">{value}</p>
            </div>
          ))}
        </section>
      ) : null}

      <section aria-label="Inscriptions" className="card mb-8 p-4 sm:p-5">
        <Switch
          checked={registrationOpen ?? false}
          onChange={(v) => void toggleRegistration(v)}
          disabled={registrationOpen === null || savingSetting}
          label="Inscriptions ouvertes"
          description={
            registrationOpen
              ? 'Tout le monde peut créer un compte gratuit depuis la page d’accueil.'
              : 'Comptes sur invitation uniquement (bouton « Inviter »). L’analyse d’un CV reste ouverte à tous, sans compte.'
          }
        />
      </section>

      <h2 className="mb-2 text-lg">Comptes</h2>
      <div className="card mb-8 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Compte</th>
                <th scope="col" className="hidden sm:table-cell">Créé</th>
                <th scope="col">Dernière connexion</th>
                <th scope="col" className="hidden md:table-cell">Espace</th>
                <th scope="col" className="hidden md:table-cell">2FA</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {overview?.users.map((u) => (
                <tr key={u.id}>
                  <td className="max-w-[16rem]">
                    <span className="block truncate font-semibold text-ink">{u.email}</span>
                    <span className="block truncate text-sm text-muted">
                      {u.displayName ?? '—'} · {u.cvs} CV
                    </span>
                    {u.resetRequestedAt ? (
                      <span className="badge badge-warn mt-1" title={`Demandé ${relativeTime(u.resetRequestedAt)}`}>
                        Mot de passe oublié
                      </span>
                    ) : null}
                  </td>
                  <td className="num hidden whitespace-nowrap text-muted sm:table-cell">{formatDate(u.createdAt)}</td>
                  <td className="whitespace-nowrap text-muted">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Jamais'}</td>
                  <td className="num hidden whitespace-nowrap text-muted md:table-cell">{formatBytes(u.bytes)}</td>
                  <td className="hidden md:table-cell">{u.mfaEnabled ? <span className="badge badge-ok">Oui</span> : <span className="badge">Non</span>}</td>
                  <td>
                    <div className="flex justify-end">
                      <Menu
                        label="Actions"
                        className="btn btn-sm btn-ghost"
                        items={[
                          {
                            label: 'Lien de réinitialisation',
                            description: u.resetRequestedAt
                              ? 'Demandé par la personne : lien valable 24 h, à lui transmettre.'
                              : 'Disponible seulement si la personne clique sur « Mot de passe oublié ».',
                            onSelect: () => void resetLink(u),
                            disabled: !u.resetRequestedAt,
                          },
                          { label: 'Déconnecter partout', description: 'Ferme toutes ses sessions.', onSelect: () => void revokeSessions(u) },
                          { label: 'Supprimer le compte', description: 'Définitif, avec toutes ses données.', onSelect: () => setDeleting(u), disabled: u.id === user?.id },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="mb-2 text-lg">Invitations</h2>
      <p className="mb-3 text-sm text-muted">Liens nominatifs à usage unique : ils permettent de créer un compte même quand l’inscription libre est fermée.</p>
      <div className="card overflow-hidden">
        {invitations && invitations.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Pour</th>
                <th scope="col">État</th>
                <th scope="col" className="hidden sm:table-cell">Expire</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => {
                const expired = inv.status === 'expired'
                return (
                  <tr key={inv.id}>
                    <td>{inv.note || <span className="text-faint">Sans note</span>}</td>
                    <td>{inv.usedAt ? <span className="badge badge-ok">Utilisée</span> : expired ? <span className="badge">Expirée</span> : <span className="badge badge-accent">En attente</span>}</td>
                    <td className="num hidden whitespace-nowrap text-muted sm:table-cell">{formatDate(inv.expiresAt)}</td>
                    <td>
                      <div className="flex justify-end">
                        <button type="button" className="btn btn-ghost btn-sm btn-icon btn-danger" aria-label={`Supprimer l’invitation ${inv.note}`} title="Supprimer" onClick={() => void deleteInvitation(inv)}>
                          <IconTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="p-6 text-sm text-muted">{invitations === null ? 'Chargement…' : 'Aucune invitation.'}</p>
        )}
      </div>

      <p className="mt-6 text-sm text-muted">
        Sauvegarde de la base : export SQL depuis l’espace client de l’hébergeur (ou <code>php bin/backup.php</code> avec un accès SSH). Elle contient toutes
        les données : conservez-la chiffrée, hors du serveur.
      </p>

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={(inv) => {
          setInviteOpen(false)
          setInvitations((l) => [inv, ...(l ?? [])])
          setShownLink({ title: 'Invitation créée', label: 'Ce lien n’est affiché qu’une fois. Transmettez-le à la personne invitée.', url: abs(inv.url ?? '') })
        }}
      />

      <Dialog open={shownLink !== null} title={shownLink?.title ?? ''} onClose={() => setShownLink(null)}>
        {shownLink ? <CopyLink url={shownLink.url} label={shownLink.label} /> : null}
      </Dialog>

      <DeleteUserDialog
        user={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null)
          toast.show('Compte supprimé')
          void load()
        }}
      />
    </div>
  )
}

function InviteDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (inv: Invitation) => void }) {
  const [note, setNote] = useState('')
  const [days, setDays] = useState('14')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { invitation } = await api.admin.createInvitation(note.trim(), Math.min(60, Math.max(1, Number(days) || 14)))
      setNote('')
      onCreated(invitation)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} title="Inviter quelqu’un" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <TextField label="Pour qui ?" hint="Une note pour vous y retrouver, par exemple un prénom." value={note} onChange={setNote} maxLength={120} />
        <TextField label="Validité (jours)" type="number" min={1} max={60} value={days} onChange={setDays} />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Créer le lien
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function DeleteUserDialog({ user, onClose, onDeleted }: { user: AdminUser | null; onClose: () => void; onDeleted: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!user || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.admin.deleteUser(user.id, password)
      setPassword('')
      onDeleted()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={user !== null} title="Supprimer ce compte ?" description={user ? `${user.email} et toutes ses données seront effacés définitivement.` : null} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <TextField label="Votre mot de passe d’administrateur" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn btn-danger-solid" disabled={busy || !password}>
            Supprimer
          </button>
        </div>
      </form>
    </Dialog>
  )
}
