import type { CvSettings } from '@/domain/cv'
import type { ProfileData } from '@/domain/profile'
import type { ExtractedPdf } from '@/pdf/extract'
import { planSections } from '@/pdf/layout'
import { CONTENT_RULES } from './rules/content'
import { DATES_RULES } from './rules/dates'
import { PDF_RULES } from './rules/pdf'
import { TEMPLATE_RULES } from './rules/template'
import type { AnalysisContext, Issue, Report, Rule, RuleResult, Severity } from './types'

export * from './types'

/** Ensemble des règles, dans l'ordre d'exécution. Chaque règle est indépendante et déterministe. */
export const RULES: Rule[] = [...CONTENT_RULES, ...TEMPLATE_RULES, ...DATES_RULES, ...PDF_RULES]

export function buildContext(data: ProfileData, settings: CvSettings, pdf: ExtractedPdf | null, now: Date = new Date()): AnalysisContext {
  return { data, settings, plan: planSections(data, settings), pdf, now }
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

/**
 * Exécute toutes les règles. Volontairement **sans score global** : le rapport liste des constats
 * et des contrôles réussis, il ne prétend jamais garantir la compatibilité avec un ATS donné.
 */
export function analyzeCv(ctx: AnalysisContext): Report {
  const results: RuleResult[] = RULES.map((rule): RuleResult => {
    const meta = { id: rule.id, category: rule.category, title: rule.title }
    if (rule.needsPdf && !ctx.pdf) return { rule: meta, status: 'skipped', issues: [] }
    try {
      const issues = rule.run(ctx)
      return { rule: meta, status: issues.length ? 'issues' : 'passed', issues }
    } catch {
      // Une règle défaillante ne doit pas faire tomber l'analyse : elle est ignorée.
      return { rule: meta, status: 'skipped', issues: [] }
    }
  })

  const issues: Issue[] = results.flatMap((r) => r.issues).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  for (const i of issues) counts[i.severity]++

  const skipped = results.filter((r) => r.status === 'skipped').length
  return {
    results,
    issues,
    counts,
    passed: results.filter((r) => r.status === 'passed').length,
    executed: results.length - skipped,
    skipped,
  }
}
