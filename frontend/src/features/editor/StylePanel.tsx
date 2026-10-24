import { useDeferredValue, useMemo, useState } from 'react'
import type { ProfileData } from '@/domain/profile'
import { describeIssuePath } from '@/domain/validate'
import { LINT_RULE_LABELS, lintProfile, type LintRuleId } from '@/lint'
import { IconCheck } from '@/ui/Icons'

/**
 * Panneau « Relecture » : relecteur de style français (formulations faibles, temps mélangés,
 * nominalisations…). Il signale et explique, il ne réécrit jamais à votre place.
 */
export function StylePanel({ data }: { data: ProfileData }) {
  const deferred = useDeferredValue(data)
  const findings = useMemo(() => lintProfile(deferred), [deferred])
  const [hidden, setHidden] = useState<Set<LintRuleId>>(new Set())

  const byRule = useMemo(() => {
    const m = new Map<LintRuleId, number>()
    for (const f of findings) m.set(f.id, (m.get(f.id) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [findings])

  const shown = findings.filter((f) => !hidden.has(f.id))

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-lg">Relecture du style</h2>
        <p className="mt-1 text-sm text-muted">
          Des repères de rédaction pour un CV en français. Ce sont des invitations à relire, pas des fautes certaines ; rien n’est modifié à votre place.
          Le correcteur orthographique de votre navigateur reste actif dans les champs.
        </p>
      </div>

      {byRule.length > 0 ? (
        <fieldset className="m-0 border-0 p-0">
          <legend className="label">Afficher</legend>
          <div className="flex flex-wrap gap-1.5">
            {byRule.map(([id, n]) => {
              const on = !hidden.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  className={`badge cursor-pointer !px-2 !py-1 ${on ? 'badge-accent' : 'line-through'}`}
                  onClick={() =>
                    setHidden((s) => {
                      const next = new Set(s)
                      if (next.has(id)) next.delete(id)
                      else next.add(id)
                      return next
                    })
                  }
                >
                  {LINT_RULE_LABELS[id]} <span className="num">{n}</span>
                </button>
              )
            })}
          </div>
        </fieldset>
      ) : null}

      {shown.length === 0 ? (
        <p className="notice notice-ok m-0 flex items-center gap-2 text-sm">
          <IconCheck className="text-ok" /> {findings.length === 0 ? 'Rien à signaler.' : 'Tous les signalements affichés sont masqués.'}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {shown.slice(0, 80).map((f, i) => (
            <li key={`${f.id}-${f.path}-${i}`} className={`notice ${f.severity === 'suggestion' ? 'notice-warn' : 'notice-info'}`}>
              <p className="text-sm text-muted">
                {describeIssuePath(deferred, f.path)} · {LINT_RULE_LABELS[f.id]}
              </p>
              {f.excerpt ? <p className="mt-1 text-[0.93rem] text-ink">« {f.excerpt} »</p> : null}
              <p className="mt-1 text-[0.93rem] font-semibold text-ink">{f.message}</p>
              {f.hint ? <p className="mt-0.5 text-sm text-muted">{f.hint}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {shown.length > 80 ? <p className="text-sm text-muted">{shown.length - 80} autres signalements non affichés.</p> : null}
    </div>
  )
}
