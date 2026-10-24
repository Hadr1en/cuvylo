import { dateIndex, type Experience, type Mission } from '@/domain/profile'
import { formatCvDate } from '@/export/format'
import { normalize } from '../text'
import type { AnalysisContext, Issue, Rule } from '../types'

/**
 * Règles de dates : une date vaut "AAAA-MM" ou "AAAA" (année seule).
 * Principe : ne signaler que ce qui est CERTAIN. Avec une année seule, on ne connaît pas le mois :
 * - un chevauchement est calculé sur l'hypothèse la plus courte (début en décembre, fin en janvier) ;
 * - un trou est calculé sur l'hypothèse la plus courte (début en janvier, fin en décembre) ;
 * - l'ordre chronologique est comparé à l'année quand l'une des deux dates n'a pas de mois.
 */

/** Mois courant sous forme d'index absolu (année × 12 + mois), même échelle que `dateIndex`. */
export function nowIndex(now: Date): number {
  return now.getFullYear() * 12 + now.getMonth()
}

const label = (e: Experience) => [e.title, e.company].map((s) => s.trim()).filter(Boolean).join(' · ') || 'Expérience sans titre'
const missionLabel = (m: Mission) => [m.client, m.role].map((s) => s.trim()).filter(Boolean).join(' · ') || 'mission sans titre'
const fmt = (v: string | null) => formatCvDate(v, 'fr')
const yearOnly = (v: string | null | undefined) => !!v && /^\d{4}$/.test(v)

/** Pluriels français : « mois » est invariable (jamais « 29 moiss »). */
export function months(n: number): string {
  return `${n} mois`
}

/**
 * Activités parallèles par nature : un cumul avec un poste salarié n'a rien d'anormal.
 * Comparé au texte normalisé (minuscules, sans accents) de l'intitulé et de l'entreprise.
 */
export const PARALLEL_BY_NATURE =
  /(?<![\p{L}\p{N}])(freelance|free-lance|independante?s?|auto-?entrepreneu(r|se)|micro-?entreprise|micro-?entrepreneu(r|se)|sasu|eurl|portage( salarial)?|vacataire|format(eur|rice)|charge(e)? d'enseignement|intervenante?|benevol(e|at)|consultante? independante?|mandat electif|elue? municipal)(?![\p{L}\p{N}])/u

/** Vrai si l'expérience est menée en parallèle d'une autre (indicateur v2 ou nature de l'activité). */
export function isParallel(e: Experience): boolean {
  return e.parallel || PARALLEL_BY_NATURE.test(normalize(`${e.title} ${e.company}`))
}

interface Span {
  exp: Experience
  /** Début au plus tôt (janvier si année seule). */
  start: number
  /** Début au plus tard (décembre si année seule). */
  startLate: number
  /** Fin au plus tard (décembre si année seule ; mois courant si poste actuel) ou `null` si inconnue. */
  end: number | null
  /** Fin au plus tôt (janvier si année seule). */
  endEarly: number | null
}

/** Expériences datées (début valide), avec leur période effective, plafonnée au mois courant. */
function spans(ctx: AnalysisContext, list: Experience[] = ctx.data.experiences): Span[] {
  const today = nowIndex(ctx.now)
  const out: Span[] = []
  for (const exp of list) {
    const start = dateIndex(exp.startDate, 'start')
    const startLate = dateIndex(exp.startDate, 'end')
    if (start === null || startLate === null) continue
    let end: number | null = null
    let endEarly: number | null = null
    if (exp.current) {
      end = endEarly = today
    } else if (exp.endDate) {
      end = dateIndex(exp.endDate, 'end')
      endEarly = dateIndex(exp.endDate, 'start')
    }
    if (end !== null) end = Math.min(end, Math.max(today, start))
    out.push({ exp, start, startLate, end, endEarly })
  }
  return out
}

/** Comparaison de deux débuts, à l'année si l'un des deux n'a pas de mois. Négatif : `a` plus ancien. */
function compareStarts(a: Experience, b: Experience): number {
  if (yearOnly(a.startDate) || yearOnly(b.startDate)) return Number(a.startDate.slice(0, 4)) - Number(b.startDate.slice(0, 4))
  return (dateIndex(a.startDate) ?? 0) - (dateIndex(b.startDate) ?? 0)
}

/** Une borne de fin est-elle certainement dans le futur ? (année seule : seulement si l'année est future). */
function endInFuture(value: string | null, today: number): boolean {
  const early = dateIndex(value, 'start')
  return early !== null && (yearOnly(value) ? Math.floor(early / 12) > Math.floor(today / 12) : early > today)
}

function startInFuture(value: string | null, today: number): boolean {
  const s = dateIndex(value, 'start')
  return s !== null && s > today
}

function orderBroken(start: string, end: string | null): boolean {
  const s = dateIndex(start, 'start')
  const e = dateIndex(end, 'end')
  return s !== null && e !== null && e < s
}

export const DATES_RULES: Rule[] = [
  {
    id: 'date-order',
    category: 'dates',
    title: 'Dates de fin postérieures aux dates de début',
    run({ data }) {
      const issues: Issue[] = []
      for (const e of data.experiences) {
        if (!e.current && orderBroken(e.startDate, e.endDate)) {
          issues.push({ ruleId: 'date-order', severity: 'error', section: 'experiences', message: `« ${label(e)} » se termine (${fmt(e.endDate)}) avant d’avoir commencé (${fmt(e.startDate)}).`, fix: 'Corrigez l’une des deux dates : un ATS calcule votre ancienneté avec elles.' })
        }
        for (const m of e.missions) {
          if (orderBroken(m.startDate, m.endDate)) {
            issues.push({ ruleId: 'date-order', severity: 'error', section: 'experiences', message: `La mission « ${missionLabel(m)} » (${label(e)}) se termine avant d’avoir commencé.`, fix: 'Corrigez les dates de la mission.' })
          }
        }
      }
      for (const e of data.education) {
        if (orderBroken(e.startDate, e.endDate)) {
          issues.push({ ruleId: 'date-order', severity: 'error', section: 'education', message: `La formation « ${e.degree || e.school} » se termine avant d’avoir commencé.`, fix: 'Corrigez les dates de début et de fin.' })
        }
      }
      for (const p of data.projects) {
        if (orderBroken(p.startDate, p.endDate)) {
          issues.push({ ruleId: 'date-order', severity: 'error', section: 'projects', message: `Le projet « ${p.name} » se termine avant d’avoir commencé.`, fix: 'Corrigez les dates du projet.' })
        }
      }
      return issues
    },
  },
  {
    id: 'future-dates',
    category: 'dates',
    title: 'Aucune date future inattendue',
    run({ data, now }) {
      const today = nowIndex(now)
      const issues: Issue[] = []
      for (const e of data.experiences) {
        if (startInFuture(e.startDate, today)) {
          issues.push({ ruleId: 'future-dates', severity: 'warning', section: 'experiences', message: `« ${label(e)} » commence dans le futur (${fmt(e.startDate)}).`, fix: 'Vérifiez l’année ; si le poste est confirmé mais pas commencé, mentionnez-le dans le résumé plutôt que dans l’historique.' })
        }
        if (!e.current && endInFuture(e.endDate, today)) {
          issues.push({ ruleId: 'future-dates', severity: 'warning', section: 'experiences', message: `« ${label(e)} » se termine dans le futur (${fmt(e.endDate)}) sans être marqué « poste actuel ».`, fix: 'Cochez « poste actuel » si vous y êtes encore, sinon corrigez la date.' })
        }
        for (const m of e.missions) {
          if (startInFuture(m.startDate, today)) {
            issues.push({ ruleId: 'future-dates', severity: 'warning', section: 'experiences', message: `La mission « ${missionLabel(m)} » commence dans le futur (${fmt(m.startDate)}).`, fix: 'Vérifiez l’année de la mission.' })
          }
        }
      }
      for (const c of data.certifications) {
        if (startInFuture(c.date, today)) {
          issues.push({ ruleId: 'future-dates', severity: 'warning', section: 'certifications', message: `« ${c.name} » est datée dans le futur (${fmt(c.date)}).`, fix: 'Une certification doit être obtenue ; corrigez la date ou retirez-la jusqu’à l’obtention.' })
        }
      }
      for (const a of data.awards) {
        if (startInFuture(a.date, today)) {
          issues.push({ ruleId: 'future-dates', severity: 'warning', section: 'awards', message: `La distinction « ${a.title} » est datée dans le futur (${fmt(a.date)}).`, fix: 'Vérifiez l’année.' })
        }
      }
      return issues
    },
  },
  {
    id: 'chronology',
    category: 'dates',
    title: 'Expériences classées de la plus récente à la plus ancienne',
    run({ data }) {
      // Les activités parallèles sont hors de la chronologie principale : où qu'elles soient listées, rien d'anormal.
      const list = data.experiences.filter((e) => !isParallel(e) && dateIndex(e.startDate) !== null)
      for (let i = 0; i + 1 < list.length; i++) {
        const a = list[i]!
        const b = list[i + 1]!
        if (compareStarts(a, b) < 0) {
          return [{ ruleId: 'chronology', severity: 'warning', section: 'experiences', message: `« ${label(a)} » (début ${fmt(a.startDate)}) est listée avant « ${label(b)} » (début ${fmt(b.startDate)}), plus récente.`, fix: 'Recruteurs et ATS attendent l’ordre antéchronologique : réordonnez avec les flèches.' }]
        }
      }
      return []
    },
  },
  {
    id: 'overlaps',
    category: 'dates',
    title: 'Pas de chevauchement d’expériences significatif',
    run(ctx) {
      // Les missions sont imbriquées dans leur expérience : elles ne sont jamais comparées entre expériences.
      const list = spans(ctx).filter((s) => s.endEarly !== null && !isParallel(s.exp))
      const issues: Issue[] = []
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!
          const b = list[j]!
          // Hypothèse la plus courte : début au plus tard, fin au plus tôt.
          const overlap = Math.min(a.endEarly!, b.endEarly!) - Math.max(a.startLate, b.startLate)
          if (overlap > 3) {
            issues.push({ ruleId: 'overlaps', severity: 'info', section: 'experiences', message: `« ${label(a.exp)} » et « ${label(b.exp)} » se chevauchent sur au moins ${months(overlap)}.`, fix: 'Légitime en cas de cumul ou de transition (cochez alors « en parallèle ») ; sinon vérifiez les dates.' })
          }
        }
      }
      return issues
    },
  },
  {
    id: 'gaps',
    category: 'dates',
    title: 'Pas de trou de plus de 6 mois entre deux expériences',
    run(ctx) {
      const list = spans(ctx).sort((a, b) => a.start - b.start)
      const issues: Issue[] = []
      let prev: Span | null = null
      let maxEnd = -Infinity
      for (const s of list) {
        if (prev && s.start - maxEnd - 1 > 6) {
          const gap = s.start - maxEnd - 1
          issues.push({ ruleId: 'gaps', severity: 'warning', section: 'experiences', message: `${months(gap)} sans expérience entre « ${label(prev.exp)} » et « ${label(s.exp)} ».`, fix: 'Si c’est vrai, une ligne neutre l’explique (formation, projet personnel, congé) ; les ATS et recruteurs repèrent les trous. N’inventez rien.' })
        }
        const end = s.end ?? s.startLate
        if (end >= maxEnd) {
          maxEnd = end
          prev = s
        }
      }
      return issues
    },
  },
  {
    id: 'mission-within-experience',
    category: 'dates',
    title: 'Missions comprises dans la période de leur expérience',
    run(ctx) {
      const today = nowIndex(ctx.now)
      const issues: Issue[] = []
      for (const e of ctx.data.experiences) {
        const eStart = dateIndex(e.startDate, 'start')
        const eEnd = e.current ? today : dateIndex(e.endDate, 'end')
        for (const m of e.missions) {
          // Hypothèse la plus favorable pour la mission (début au plus tard, fin au plus tôt).
          const mStart = dateIndex(m.startDate, 'end')
          const mEnd = dateIndex(m.endDate, 'start')
          const before = eStart !== null && mStart !== null && mStart < eStart
          const after = eEnd !== null && mEnd !== null && mEnd > eEnd
          if (before || after) {
            issues.push({
              ruleId: 'mission-within-experience',
              severity: 'info',
              section: 'experiences',
              message: `La mission « ${missionLabel(m)} » ${before ? 'commence avant' : 'se termine après'} l’expérience « ${label(e)} » qui la contient.`,
              fix: 'Une mission se déroule pendant le contrat qui la porte : vérifiez les dates de l’une ou de l’autre.',
            })
          }
        }
      }
      return issues
    },
  },
  {
    id: 'current-count',
    category: 'dates',
    title: 'Un seul poste « actuel » (hors activités parallèles)',
    run({ data }) {
      const n = data.experiences.filter((e) => e.current && !isParallel(e)).length
      return n > 1
        ? [{ ruleId: 'current-count', severity: 'info', section: 'experiences', message: `${n} expériences sont marquées « poste actuel ».`, fix: 'Possible en cas de cumul (cochez alors « en parallèle ») ; sinon, renseignez une date de fin pour les anciennes.' }]
        : []
    },
  },
]
