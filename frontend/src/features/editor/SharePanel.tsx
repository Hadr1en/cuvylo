import { useEffect, useMemo, useState } from 'react'
import { renderSVG } from 'uqr'
import { api, type Share } from '@/api/client'
import { errorMessage, formatDate } from '@/lib/format'
import { SelectField } from '@/ui/fields'
import { IconCopy, IconExternal, IconLink, IconTrash } from '@/ui/Icons'
import { useToast } from '@/ui/Toast'

const EXPIRY = [
  { value: '7', label: '7 jours' },
  { value: '30', label: '30 jours' },
  { value: '90', label: '3 mois' },
  { value: 'none', label: 'Sans expiration' },
] as const

/** URL absolue d'un partage (le serveur renvoie un chemin relatif ou absolu selon la config). */
function absolute(url: string): string {
  try {
    return new URL(url, window.location.origin).toString()
  } catch {
    return url
  }
}

function Qr({ text }: { text: string }) {
  // SVG généré localement (aucun service externe) ; on le place dans une image pour qu'il soit inerte.
  const src = useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(text, { border: 2 }))}`, [text])
  return <img src={src} alt={`QR code vers ${text}`} className="size-36 rounded-md border border-line bg-white p-1" />
}

/**
 * Partage par lien : le serveur fige un instantané du CV (les modifications suivantes ne sont pas
 * publiées). Révocable à tout moment ; l'anonymisation du CV est respectée.
 */
export function SharePanel({ cvId, anonymized, beforeAction }: { cvId: string; anonymized: boolean; beforeAction: () => Promise<void> }) {
  const toast = useToast()
  const [shares, setShares] = useState<Share[] | null>(null)
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]['value']>('30')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .listShares(cvId)
      .then((r) => !cancelled && setShares(r.shares))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [cvId])

  async function create() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await beforeAction()
      const { share } = await api.createShare(cvId, expiry === 'none' ? null : Number(expiry))
      setShares((l) => [share, ...(l ?? [])])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(s: Share) {
    try {
      await api.revokeShare(s.id)
      setShares((l) => l?.filter((x) => x.id !== s.id) ?? null)
      toast.show('Lien révoqué : il ne fonctionne plus.')
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' })
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast.show('Lien copié')
    } catch {
      toast.show('Copie impossible : sélectionnez le lien à la main.', { tone: 'danger' })
    }
  }

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-lg">Partager par lien</h2>
        <p className="mt-1 text-sm text-muted">
          Le lien montre une copie figée du CV à cet instant, en lecture seule, avec le téléchargement du PDF. Toute personne qui a le lien peut
          le consulter : ne le diffusez qu’aux destinataires voulus.
          {anonymized ? ' Ce CV est anonymisé : le lien l’est aussi.' : ''}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <SelectField label="Validité" value={expiry} onChange={setExpiry} options={EXPIRY} className="w-44" />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
          <IconLink /> {busy ? 'Création…' : 'Créer un lien'}
        </button>
      </div>

      {error ? (
        <p role="alert" className="notice notice-danger text-sm">
          {error}
        </p>
      ) : null}

      {shares === null ? (
        <p className="text-sm text-muted">Chargement…</p>
      ) : shares.length === 0 ? (
        <p className="text-sm text-muted">Aucun lien actif.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {shares.map((s) => {
            const url = absolute(s.url)
            return (
              <li key={s.id} className="card flex flex-wrap gap-4 p-4">
                <Qr text={url} />
                <div className="min-w-0 flex-1">
                  <p className="break-all font-mono text-sm text-ink">{url}</p>
                  <p className="mt-1 text-sm text-muted">
                    Créé le {formatDate(s.createdAt)} · {s.expiresAt ? `expire le ${formatDate(s.expiresAt)}` : 'sans expiration'} · {s.views} consultation
                    {s.views > 1 ? 's' : ''}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn btn-sm" onClick={() => void copy(url)}>
                      <IconCopy /> Copier
                    </button>
                    <a href={url} target="_blank" rel="noreferrer" className="btn btn-sm">
                      <IconExternal /> Ouvrir
                    </a>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void revoke(s)}>
                      <IconTrash /> Révoquer
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
