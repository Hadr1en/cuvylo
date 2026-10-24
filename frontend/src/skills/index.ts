import type { CvLocale } from '@/domain/cv'
import { dateIndex, type ProfileData } from '@/domain/profile'
import { canonicalKey, normalizeJob } from '@/jobs/dictionary'

/**
 * Matrice compétences × durée pour le dossier de compétences (format conseil et ESN).
 * La durée d'une compétence est calculée sur l'UNION des périodes où elle est cochée
 * (expérience, mission, projet) : deux missions simultanées ne comptent pas double.
 * Dates du format v2 : une année seule vaut janvier en début, décembre en fin ;
 * une période en cours s'arrête au mois de `now` ; rien n'est compté au-delà de `now`.
 */

export type SkillSourceKind = 'experience' | 'mission' | 'project'

export interface SkillSource {
  kind: SkillSourceKind
  /** Identifiant de l'expérience, de la mission ou du projet. */
  id: string
  /** Libellé lisible : « Consultante cybersécurité · Cabinet Imaginaire », « Banque Fictive (Cabinet Imaginaire) ». */
  label: string
}

export interface SkillRow {
  /** Forme affichée (la première rencontrée). */
  skill: string
  /** Clé de regroupement (normalisée, alias résolus : « K8s » = « Kubernetes »). */
  key: string
  /** Nombre de mois distincts où la compétence a été mise en œuvre. */
  months: number
  firstYear: number | null
  lastYear: number | null
  /** Vrai si une période en cours la mobilise. */
  current: boolean
  sources: SkillSource[]
  /** Listée dans la rubrique Compétences du profil. */
  declared: boolean
}

interface Period {
  start: number
  end: number
}

/** Mois courant, même échelle que `dateIndex` (année × 12 + mois - 1). */
const monthOf = (now: Date) => now.getFullYear() * 12 + now.getMonth()

/**
 * Période effective : fin explicite, sinon « en cours » (jusqu'à `now`) quand `ongoing`,
 * sinon la période du seul début (le mois, ou l'année entière si année seule). Plafonnée à `now`.
 */
function period(start: string, end: string | null, ongoing: boolean, now: number, parent?: Period | null): Period | null {
  const s = dateIndex(start, 'start')
  if (s === null || s > now) return null
  let e: number | null = dateIndex(end, 'end')
  if (e === null) e = ongoing ? now : (parent?.end ?? dateIndex(start, 'end'))
  e = Math.min(e!, now)
  return e >= s ? { start: s, end: e } : null
}

/** Somme des mois de l'union des périodes (bornes incluses). */
export function unionMonths(periods: Period[]): number {
  const sorted = [...periods].sort((a, b) => a.start - b.start)
  let total = 0
  let cur: Period | null = null
  for (const p of sorted) {
    if (cur && p.start <= cur.end + 1) {
      cur.end = Math.max(cur.end, p.end)
    } else {
      if (cur) total += cur.end - cur.start + 1
      cur = { ...p }
    }
  }
  if (cur) total += cur.end - cur.start + 1
  return total
}

export function skillKey(skill: string): string {
  return canonicalKey(normalizeJob(skill))
}

export function skillsMatrix(data: ProfileData, now: Date = new Date()): SkillRow[] {
  const today = monthOf(now)
  const rows = new Map<string, SkillRow & { periods: Period[] }>()
  const touch = (skill: string) => {
    const key = skillKey(skill)
    if (!key) return null
    let row = rows.get(key)
    if (!row) {
      row = { skill: skill.trim(), key, months: 0, firstYear: null, lastYear: null, current: false, sources: [], declared: false, periods: [] }
      rows.set(key, row)
    }
    return row
  }
  const record = (skills: string[], p: Period | null, source: SkillSource, ongoing: boolean) => {
    for (const s of new Set(skills.map((x) => x.trim()).filter(Boolean))) {
      const row = touch(s)
      if (!row) continue
      if (!row.sources.some((x) => x.kind === source.kind && x.id === source.id)) row.sources.push(source)
      if (p) {
        row.periods.push(p)
        if (ongoing && p.end === today) row.current = true
      }
    }
  }

  for (const e of data.experiences) {
    const ongoing = e.current
    const ep = period(e.startDate, e.endDate, ongoing, today)
    const label = [e.title, e.company].map((s) => s.trim()).filter(Boolean).join(' · ') || 'Expérience'
    record(e.skills, ep, { kind: 'experience', id: e.id, label }, ongoing)
    for (const m of e.missions) {
      // Mission sans fin : en cours si `null` ; si "", bornée par son expérience.
      const mOngoing = m.endDate === null && ongoing
      const mp = period(m.startDate, m.endDate, mOngoing, today, ep)
      const mLabel = `${m.client.trim() || m.role.trim() || 'Mission'}${e.company.trim() ? ` (${e.company.trim()})` : ''}`
      record(m.skills, mp, { kind: 'mission', id: m.id, label: mLabel }, mOngoing || (m.endDate === '' && ongoing))
    }
  }
  for (const p of data.projects) {
    const pp = period(p.startDate, p.endDate, false, today)
    record(p.skills, pp, { kind: 'project', id: p.id, label: p.name.trim() || 'Projet' }, false)
  }
  for (const g of data.skills) for (const item of g.items) {
    const row = touch(item)
    if (row) row.declared = true
  }

  return [...rows.values()]
    .map(({ periods, ...row }) => ({
      ...row,
      months: unionMonths(periods),
      firstYear: periods.length ? Math.floor(Math.min(...periods.map((p) => p.start)) / 12) : null,
      lastYear: periods.length ? Math.floor(Math.max(...periods.map((p) => p.end)) / 12) : null,
    }))
    .sort((a, b) => b.months - a.months || a.skill.localeCompare(b.skill, 'fr'))
}

/** « 4 ans », « 1 an et 6 mois », « 8 mois » / « 4 years », « 1 year 6 months ». */
export function formatDuration(months: number, locale: CvLocale = 'fr'): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (locale === 'en') {
    const parts = [y ? `${y} year${y > 1 ? 's' : ''}` : '', m ? `${m} month${m > 1 ? 's' : ''}` : ''].filter(Boolean)
    return parts.join(' ') || '—'
  }
  const parts = [y ? `${y} an${y > 1 ? 's' : ''}` : '', m ? `${m} mois` : ''].filter(Boolean)
  return parts.join(' et ') || '—'
}

/** « 2019–2023 », « depuis 2021 » / « since 2021 », « 2020 ». */
export function formatYears(row: Pick<SkillRow, 'firstYear' | 'lastYear' | 'current'>, locale: CvLocale = 'fr'): string {
  if (row.firstYear === null || row.lastYear === null) return ''
  if (row.current) return locale === 'en' ? `since ${row.firstYear}` : `depuis ${row.firstYear}`
  return row.firstYear === row.lastYear ? `${row.firstYear}` : `${row.firstYear}–${row.lastYear}`
}
