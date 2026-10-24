import type { CvSettings } from '@/domain/cv'
import type { ProfileData, SectionId } from '@/domain/profile'
import type { ExtractedPdf } from '@/pdf/extract'
import type { PlannedSection } from '@/pdf/layout'

/**
 * Gravité d'un signalement.
 * - `error`   : information essentielle absente ou illisible ; à corriger.
 * - `warning` : risque réel de mauvaise lecture ou CV affaibli ; à vérifier.
 * - `info`    : bonne pratique ou point d'attention, sans effet certain.
 */
export type Severity = 'error' | 'warning' | 'info'

export type Category = 'essential' | 'structure' | 'missing' | 'dates' | 'pdf' | 'risks'

export const CATEGORY_LABELS: Record<Category, string> = {
  essential: 'Rubriques essentielles',
  structure: 'Structure du document',
  missing: 'Informations manquantes',
  dates: 'Dates et cohérence',
  pdf: 'Texte extrait du PDF',
  risks: 'Éléments susceptibles de perturber l’extraction',
}

export const CATEGORY_ORDER: Category[] = ['essential', 'missing', 'dates', 'structure', 'risks', 'pdf']

export interface Issue {
  /** Identifiant de la règle ayant produit le signalement. */
  ruleId: string
  severity: Severity
  /** Constat, en une phrase. */
  message: string
  /** Que faire — jamais une invention de contenu. */
  fix?: string
  /** Rubrique concernée (clé fixe ou `custom:<id>`), pour guider l'utilisateur. */
  section?: SectionId
}

export interface AnalysisContext {
  data: ProfileData
  settings: CvSettings
  plan: PlannedSection[]
  /** Texte extrait du PDF généré ; `null` tant qu'il n'est pas disponible. */
  pdf: ExtractedPdf | null
  /** Date de référence (injectée pour des tests déterministes). */
  now: Date
}

export interface Rule {
  id: string
  category: Category
  /** Ce que la règle contrôle, formulé comme une vérification réussie. */
  title: string
  /** Règle nécessitant le texte extrait du PDF. */
  needsPdf?: boolean
  run: (ctx: AnalysisContext) => Issue[]
}

export type RuleStatus = 'passed' | 'issues' | 'skipped'

export interface RuleResult {
  rule: Pick<Rule, 'id' | 'category' | 'title'>
  status: RuleStatus
  issues: Issue[]
}

export interface Report {
  results: RuleResult[]
  issues: Issue[]
  counts: Record<Severity, number>
  /** Contrôles réussis / exécutés (hors contrôles ignorés). */
  passed: number
  executed: number
  skipped: number
}
