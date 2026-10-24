import { useMemo, useState } from 'react'
import { CATEGORY_LABELS, CATEGORY_ORDER, analyzeCv, buildContext, type Issue, type Severity } from '@/ats'
import type { CvSettings } from '@/domain/cv'
import { sectionLabel, type ProfileData } from '@/domain/profile'
import type { ExtractedPdf } from '@/pdf/extract'
import { Disclosure } from '@/ui/fields'
import { IconAlert, IconCheck } from '@/ui/Icons'

interface Props {
  data: ProfileData
  settings: CvSettings
  extracted: ExtractedPdf | null
  rendering: boolean
}

const SEVERITY: Record<Severity, { label: string; notice: string; badge: string }> = {
  error: { label: 'À corriger', notice: 'notice-danger', badge: 'badge-danger' },
  warning: { label: 'À vérifier', notice: 'notice-warn', badge: 'badge-warn' },
  info: { label: 'Info', notice: 'notice-info', badge: '' },
}

function IssueCard({ issue, data }: { issue: Issue; data: ProfileData }) {
  const s = SEVERITY[issue.severity]
  return (
    <li className={`notice ${s.notice}`}>
      <p className="m-0 flex flex-wrap items-center gap-2">
        <span className={`badge ${s.badge}`}>{s.label}</span>
        {issue.section ? <span className="text-sm text-muted">{sectionLabel(data, issue.section)}</span> : null}
      </p>
      <p className="mt-1.5 text-[0.93rem] font-semibold text-ink">{issue.message}</p>
      {issue.fix ? <p className="mt-0.5 text-sm text-muted">{issue.fix}</p> : null}
    </li>
  )
}

/** Panneau « Analyse ATS » : constats déterministes, sans note globale ni promesse de compatibilité. */
export function AtsPanel({ data, settings, extracted, rendering }: Props) {
  const report = useMemo(() => analyzeCv(buildContext(data, settings, extracted)), [data, settings, extracted])
  const [showPassed, setShowPassed] = useState(false)
  const [showText, setShowText] = useState(false)

  const passedByCategory = CATEGORY_ORDER.map((c) => ({
    category: c,
    rules: report.results.filter((r) => r.rule.category === c && r.status === 'passed'),
  })).filter((g) => g.rules.length > 0)

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-lg">Analyse ATS</h2>
        <p className="mt-1 text-sm text-muted">Contrôles de la structure, des dates et du texte réellement extrait du PDF.</p>
      </div>

      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Synthèse des constats">
        {(['error', 'warning', 'info'] as const).map((sev) => (
          <div key={sev} className="card p-3">
            <p className={`num m-0 text-[1.6rem] font-semibold leading-none ${report.counts[sev] > 0 && sev !== 'info' ? (sev === 'error' ? 'text-danger' : 'text-warn') : 'text-ink'}`}>{report.counts[sev]}</p>
            <p className="m-0 mt-1 text-sm text-muted">{SEVERITY[sev].label}</p>
          </div>
        ))}
      </div>

      <p className="m-0 text-sm text-muted" role="status">
        {report.passed} contrôle{report.passed > 1 ? 's' : ''} réussi{report.passed > 1 ? 's' : ''} sur {report.executed}
        {report.skipped > 0 ? ` · ${report.skipped} en attente du PDF` : ''}
        {rendering ? ' · mise à jour…' : ''}
      </p>

      <p className="notice notice-info m-0 text-sm text-muted">
        Ces contrôles repèrent des risques connus d’extraction et de lisibilité. Ils ne garantissent la compatibilité avec aucun ATS : chaque éditeur a son propre analyseur.
      </p>

      {report.issues.length === 0 ? (
        <p className="notice notice-ok m-0 flex items-center gap-2 text-sm">
          <IconCheck className="text-ok" /> Aucun constat sur les contrôles exécutés.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Constats">
          {report.issues.map((issue, i) => (
            <IssueCard key={`${issue.ruleId}-${i}`} issue={issue} data={data} />
          ))}
        </ul>
      )}

      <div className="border-t border-line pt-2">
        <Disclosure title={`Contrôles réussis (${report.passed})`} open={showPassed} onToggle={() => setShowPassed((o) => !o)}>
          <div className="grid gap-4 pb-2 pl-6">
            {passedByCategory.map((g) => (
              <div key={g.category}>
                <p className="overline mb-1">{CATEGORY_LABELS[g.category]}</p>
                <ul className="m-0 grid list-none gap-1 p-0">
                  {g.rules.map((r) => (
                    <li key={r.rule.id} className="flex items-start gap-2 text-sm">
                      <IconCheck className="mt-1 shrink-0 text-ok" /> {r.rule.title}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Disclosure>
        <Disclosure title="Texte lu dans le PDF" open={showText} onToggle={() => setShowText((o) => !o)}>
          <div className="pb-2 pl-6">
            <p className="mb-2 text-sm text-muted">Ce que pdf.js extrait du fichier exporté. Un ATS lit quelque chose de proche : si l’ordre ou les mots sont étranges ici, ils le seront chez lui.</p>
            {extracted ? (
              <pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface p-3 font-mono text-xs leading-relaxed">{extracted.text}</pre>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted">
                <IconAlert /> PDF pas encore généré.
              </p>
            )}
          </div>
        </Disclosure>
      </div>
    </div>
  )
}
