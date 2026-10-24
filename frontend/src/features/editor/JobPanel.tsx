import { useDeferredValue, useMemo, useState } from 'react'
import { ApiError } from '@/api/client'
import { analyzeJob, analyzeJobText, type KeywordMatch, type MatchStatus } from '@/jobs'
import type { ProfileData } from '@/domain/profile'
import { IconPlus } from '@/ui/Icons'

/** Ce à quoi l'offre est comparée : un CV structuré, ou tout le texte extrait d'un PDF (analyse publique). */
type Source = { data: ProfileData; text?: undefined } | { text: string; data?: undefined }

type Props = Source & {
  posting: string
  onPostingChange: (text: string) => void
  /** Crée un CV « adapté » à partir de celui-ci, avec le titre de l'offre. Absent : bouton masqué. */
  onCreateTailored?: (jobTitle: string | null) => Promise<void>
}

const STATUS: Record<MatchStatus, { label: string; badge: string; mark: string }> = {
  present: { label: 'Présent', badge: 'badge-ok', mark: '✓' },
  listed: { label: 'Seulement dans les compétences', badge: 'badge-accent', mark: '◐' },
  variant: { label: 'Formulation différente', badge: 'badge-warn', mark: '≈' },
  missing: { label: 'Absent', badge: 'badge-danger', mark: '✕' },
}

const IMPORTANCE = { required: 'Exigé', preferred: 'Souhaité', mentioned: 'Mentionné' } as const

function Chip({ m }: { m: KeywordMatch }) {
  const s = STATUS[m.status]
  return (
    <li className={`badge ${s.badge} !px-2 !py-0.5 !text-[0.87rem]`} title={`${s.label}${m.variant ? ` (« ${m.variant} » dans votre CV)` : ''} — ${IMPORTANCE[m.importance]}`}>
      <span aria-hidden="true">{s.mark}</span>
      <span>{m.term}</span>
      <span className="sr-only">
        : {s.label}, {IMPORTANCE[m.importance]}
      </span>
    </li>
  )
}

/** Panneau « Offre » : colle une fiche de poste, voit ce que le CV couvre — sans IA, sans rien inventer. */
export function JobPanel({ posting, onPostingChange, data, text, onCreateTailored }: Props) {
  const deferred = useDeferredValue(posting)
  const analysis = useMemo(() => {
    if (deferred.trim().length < 40) return null
    return text !== undefined ? analyzeJobText(deferred, text) : analyzeJob(deferred, data)
  }, [deferred, data, text])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groups = analysis
    ? (['required', 'preferred', 'mentioned'] as const)
        .map((imp) => ({ imp, items: analysis.matches.filter((m) => m.importance === imp) }))
        .filter((g) => g.items.length > 0)
    : []
  const pct = analysis && analysis.required.total > 0 ? Math.round((analysis.required.found / analysis.required.total) * 100) : 0

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-lg">Comparer avec une offre</h2>
        <p className="mt-1 text-sm text-muted">Collez la fiche de poste : ses mots-clés sont repérés et comparés à ce que votre CV contient déjà.</p>
      </div>

      <div>
        <label htmlFor="job-posting" className="label">
          Fiche de poste
        </label>
        <textarea
          id="job-posting"
          className="input"
          rows={9}
          maxLength={20000}
          placeholder="Collez ici le texte de l’annonce (intitulé, missions, profil recherché…)"
          value={posting}
          onChange={(e) => onPostingChange(e.target.value)}
        />
        <p className="mt-1 text-sm text-faint">Analyse locale, dans votre navigateur, sans IA ni service externe. Le texte reste sur cet appareil.</p>
      </div>

      {!analysis ? (
        <p className="m-0 text-sm text-muted">{posting.trim() ? 'Texte trop court pour être analysé.' : 'En attente d’une fiche de poste.'}</p>
      ) : (
        <>
          <section aria-label="Couverture des exigences" className="card p-4">
            {analysis.title ? <p className="overline mb-1">{analysis.title}</p> : null}
            <div className="flex items-end justify-between gap-4">
              <p className="num m-0 text-[1.8rem] font-semibold leading-none text-ink">
                {analysis.required.found}
                <span className="text-lg text-faint"> / {analysis.required.total}</span>
              </p>
              <p className="m-0 max-w-[13rem] text-right text-sm text-muted">exigences de l’offre retrouvées dans votre CV</p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${analysis.required.found} exigences sur ${analysis.required.total} couvertes`}>
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-3 text-sm text-faint">Indicateur de relecture : il compare des mots, pas des compétences, et ne prédit ni un score ATS ni vos chances.</p>
          </section>

          {groups.map((g) => (
            <section key={g.imp} aria-label={IMPORTANCE[g.imp]}>
              <h3 className="mb-2 text-[0.93rem]">
                {IMPORTANCE[g.imp]} <span className="num font-normal text-faint">({g.items.length})</span>
              </h3>
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {g.items.map((m) => (
                  <Chip key={m.key} m={m} />
                ))}
              </ul>
            </section>
          ))}

          <p className="m-0 text-sm text-faint">
            {text !== undefined
              ? '✓ présent dans le texte du PDF · ≈ autre formulation · ✕ absent'
              : '✓ présent · ◐ seulement en compétences · ≈ autre formulation · ✕ absent'}
          </p>

          {analysis.suggestions.length > 0 ? (
            <section aria-label="Pistes de reformulation">
              <h3 className="mb-1 text-[0.93rem]">Pistes de reformulation</h3>
              <p className="mb-3 text-sm text-muted">Aucune ne consiste à ajouter ce que vous n’avez pas fait : à vous de juger ce qui est exact.</p>
              <ul className="m-0 grid list-none gap-2 p-0">
                {analysis.suggestions.map((s, i) => (
                  <li key={i} className="notice notice-info text-sm">
                    {s.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {onCreateTailored ? (
            <div className="border-t border-line pt-4">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  if (busy) return
                  setBusy(true)
                  setError(null)
                  try {
                    await onCreateTailored(analysis.title)
                  } catch (e) {
                    // Document pas encore enregistré : on dit pourquoi au lieu de copier l'ancien état.
                    setError(e instanceof ApiError && e.code === 'not_saved' ? e.message : 'Impossible de créer la version. Réessayez.')
                    setBusy(false)
                  }
                }}
              >
                <IconPlus /> {busy ? 'Création…' : 'Créer une version adaptée'}
              </button>
              <p className="mt-2 text-sm text-muted">Copie ce CV dans un nouveau CV « adapté », modifiable sans toucher à l’original.</p>
              {error ? (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
