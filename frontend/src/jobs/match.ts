import { contentTexts } from '@/ats/rules/content'
import { sectionId, sectionLabel, type ProfileData, type SectionId } from '@/domain/profile'
import { SYNONYM_GROUPS, canonicalKey, normalizeJob, type Importance } from './dictionary'
import { termMatcher, type JobKeyword } from './extract'

export type MatchStatus =
  /** Présent dans un contexte narratif (résumé, titre, expérience, mission, projet). */
  | 'present'
  /** Présent seulement dans une liste (compétences, certifications, langues, formation). */
  | 'listed'
  /** Absent, mais une expression équivalente figure dans le CV. */
  | 'variant'
  | 'missing'

/** `document` : texte d'un PDF analysé, sans structure fiable (voir corpusFromText). */
export type MatchSection = SectionId | 'headline' | 'document'

export interface KeywordMatch extends JobKeyword {
  status: MatchStatus
  /** Rubriques où le terme apparaît (clé fixe, `custom:<id>` ou `headline`). */
  foundIn: MatchSection[]
  /** Pour `variant` : l'expression équivalente trouvée dans le CV. */
  variant?: string
}

export type SuggestionKind = 'missing' | 'listed' | 'variant' | 'title'

export interface Suggestion {
  kind: SuggestionKind
  term?: string
  message: string
}

export interface Coverage {
  found: number
  total: number
}

export interface JobAnalysis {
  title: string | null
  matches: KeywordMatch[]
  required: Coverage
  all: Coverage
  suggestions: Suggestion[]
}

/** Rubriques où un terme est « en situation » ; les autres ne font que le lister. */
const NARRATIVE = (s: MatchSection) =>
  s === 'headline' || s === 'document' || s === 'summary' || s === 'experiences' || s === 'projects' || s === 'publications' || s.startsWith('custom:')

export interface CorpusPart {
  raw: string
  norm: string
}

/**
 * Texte du CV par rubrique, en version d'origine (pour les termes à casse exacte) et normalisée.
 * Couvre le contenu v2 : missions, compétences rattachées aux expériences, missions et projets,
 * distinctions, publications, centres d'intérêt et rubriques libres.
 * Seulement ce que le PDF montre : une rubrique masquée ne compte pas, pour ne jamais annoncer une
 * couverture que le fichier envoyé au recruteur n'a pas.
 */
export function corpusBySection(data: ProfileData): Map<MatchSection, CorpusPart> {
  const parts = new Map<MatchSection, string[]>()
  const push = (k: MatchSection, t: string) => parts.set(k, [...(parts.get(k) ?? []), t])
  const hidden = new Set(data.sections.filter((s) => !s.visible).map(sectionId))
  push('headline', data.identity.headline)
  for (const { text, section } of contentTexts(data)) {
    if (section && !hidden.has(section)) push(section, text)
  }
  const out = new Map<MatchSection, CorpusPart>()
  for (const [k, v] of parts) {
    // Chaque champ sur sa ligne : un terme ne peut pas « enjamber » deux champs.
    const raw = v.join('\n')
    out.set(k, { raw, norm: v.map(normalizeJob).join(' \n ') })
  }
  return out
}

/**
 * Corpus d'un document dont on ne connaît que le texte (PDF analysé) : tout le texte extrait, sans plafond,
 * en une seule « rubrique ». Sa structure n'étant pas fiable, un terme y est présent ou absent, jamais
 * « seulement dans les compétences ».
 */
export function corpusFromText(text: string): Map<MatchSection, CorpusPart> {
  const lines = text.split('\n')
  return new Map([['document', { raw: lines.join('\n'), norm: lines.map(normalizeJob).join(' \n ') }]])
}

const groupOf = (key: string): string[] | undefined => SYNONYM_GROUPS.find((g) => g.includes(canonicalKey(key)))

function sectionsWith(corpus: Map<MatchSection, CorpusPart>, key: string): MatchSection[] {
  const matcher = termMatcher(key)
  return [...corpus.entries()].filter(([, part]) => part.norm.trim() !== '' && matcher.find(part.raw, part.norm) !== null).map(([k]) => k)
}

export function matchKeywords(keywords: JobKeyword[], data: ProfileData, corpus = corpusBySection(data)): KeywordMatch[] {
  return keywords.map((k) => {
    const foundIn = sectionsWith(corpus, k.key)
    if (foundIn.length > 0) {
      return { ...k, status: foundIn.some(NARRATIVE) ? 'present' : 'listed', foundIn }
    }
    const group = groupOf(k.key)
    if (group) {
      for (const alt of group) {
        if (alt === canonicalKey(k.key)) continue
        if (sectionsWith(corpus, alt).length > 0) return { ...k, status: 'variant', foundIn: [], variant: alt }
      }
    }
    return { ...k, status: 'missing', foundIn: [] }
  })
}

const covered = (m: KeywordMatch) => m.status === 'present' || m.status === 'listed'

function coverage(matches: KeywordMatch[], importance?: Importance): Coverage {
  const pool = importance ? matches.filter((m) => m.importance === importance) : matches
  return { found: pool.filter(covered).length, total: pool.length }
}

const SECTION_NAMES: Record<string, string> = {
  headline: 'titre',
  summary: 'résumé',
  experiences: 'expériences',
  skills: 'compétences',
  education: 'formation',
  certifications: 'certifications',
  languages: 'langues',
  projects: 'projets',
  awards: 'distinctions',
  publications: 'publications',
  interests: 'centres d’intérêt',
}

const sectionName = (data: ProfileData, s: MatchSection) => SECTION_NAMES[s] ?? `« ${sectionLabel(data, s as SectionId)} »`

/**
 * Suggestions de formulation. Règle d'or : on ne propose jamais d'AJOUTER une compétence ou une
 * expérience que l'utilisateur ne déclare pas — on l'invite à vérifier, et à ne rien ajouter si c'est faux.
 */
export function buildSuggestions(title: string | null, matches: KeywordMatch[], data: ProfileData): Suggestion[] {
  const out: Suggestion[] = []

  if (title) {
    const headline = data.identity.headline
    const t = normalizeJob(title.replace(/\(\s*[hf]\s*\/\s*[hf]\s*\)/i, ''))
    if (headline.trim() && !normalizeJob(headline).includes(t) && !t.includes(normalizeJob(headline))) {
      out.push({
        kind: 'title',
        message: `Intitulé de l’offre : « ${title} ». Votre titre : « ${headline} ». Rapprochez-les seulement si l’intitulé de l’offre décrit réellement votre profil.`,
      })
    }
  }

  const ordered = [...matches].sort((a, b) => b.weight - a.weight)
  for (const m of ordered) {
    if (m.status === 'variant') {
      out.push({
        kind: 'variant',
        term: m.term,
        message: `Vous écrivez « ${m.variant} » ; l’offre dit « ${m.term} ». Si c’est équivalent, reprenez la formulation de l’offre : les filtres cherchent souvent le terme exact.`,
      })
    } else if (m.status === 'listed') {
      out.push({
        kind: 'listed',
        term: m.term,
        message: `« ${m.term} » n’apparaît que dans ${m.foundIn.map((s) => sectionName(data, s)).join(', ')}. Si vous l’avez utilisé en situation, appuyez-le par une réalisation concrète (contexte, action, résultat).`,
      })
    } else if (m.status === 'missing' && m.importance !== 'mentioned') {
      out.push({
        kind: 'missing',
        term: m.term,
        message:
          m.importance === 'required'
            ? `« ${m.term} » est demandé et absent de votre CV. Si vous l’avez réellement pratiqué, mentionnez-le (compétences ou réalisation concernée). Sinon, ne l’ajoutez pas.`
            : `« ${m.term} » est un plus pour l’offre. Ne l’ajoutez que si c’est vrai.`,
      })
    }
  }
  return out
}

export function analyzeMatches(title: string | null, keywords: JobKeyword[], data: ProfileData, corpus = corpusBySection(data)): JobAnalysis {
  const matches = matchKeywords(keywords, data, corpus)
  return {
    title,
    matches,
    required: coverage(matches, 'required'),
    all: coverage(matches),
    suggestions: buildSuggestions(title, matches, data),
  }
}
