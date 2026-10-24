import { DATE_RE, MAX_PHOTO_CHARS, ProfileSchema, SECTION_KEYS, dateIndex, newId, type ProfileData, type SectionRef } from '@/domain/profile'

/** Outils communs aux imports : dates souples, bornes du schéma, finalisation validée. Fonctions pures. */

export const LIMITS = { short: 200, long: 4000, url: 500, items: 50, achievements: 30, missions: 30, skills: 40, skill: 80, interests: 30, customSections: 10, entries: 30 } as const

export type IdFactory = () => string

/** Fabrique d'identifiants déterministe (tests) : `prefix1`, `prefix2`… */
export function sequentialIds(prefix = 'imp'): IdFactory {
  let n = 0
  return () => `${prefix}${++n}`
}

export const defaultIds: IdFactory = newId

/** Texte nettoyé (caractères de contrôle retirés, espaces normalisés) et tronqué à `max`. */
export function clip(value: unknown, max: number = LIMITS.short): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
    // Contrôles C0/C1 et marques bidirectionnelles refusés par le serveur (contrat §7) ; \n et \t conservés.
    // eslint-disable-next-line no-control-regex -- retirer ces caractères est précisément le but
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu, '')
    .replace(/\r\n?/g, '\n')
  const t = max <= LIMITS.short ? s.replace(/\s+/g, ' ').trim() : s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return t.length > max ? t.slice(0, max).trimEnd() : t
}

const MONTHS: Record<string, number> = {}
;(
  [
    ['jan', 'janv', 'january', 'janvier', 'jänner', 'januar'],
    ['feb', 'fev', 'fév', 'fevr', 'févr', 'february', 'fevrier', 'février', 'februar'],
    ['mar', 'mars', 'march', 'märz'],
    ['apr', 'avr', 'avril', 'april'],
    ['may', 'mai'],
    ['jun', 'juin', 'june', 'juni'],
    ['jul', 'juil', 'juillet', 'july', 'juli'],
    ['aug', 'aou', 'aoû', 'aout', 'août', 'august'],
    ['sep', 'sept', 'september', 'septembre'],
    ['oct', 'october', 'octobre', 'oktober'],
    ['nov', 'november', 'novembre'],
    ['dec', 'déc', 'december', 'decembre', 'décembre', 'dezember'],
  ] as const
).forEach((names, i) => names.forEach((n) => (MONTHS[n] = i + 1)))

export interface LooseDate {
  /** "", "AAAA" ou "AAAA-MM". */
  value: string
  /** Vrai pour « Present », « Aujourd'hui », « en cours »… */
  ongoing: boolean
}

const pad = (m: number) => String(m).padStart(2, '0')

/**
 * Date saisie librement → format v2. Accepte « 2021 », « 2021-03 », « 2021-03-15 », « Mar 2021 »,
 * « mars 2021 », « janv. 2021 », « 03/2021 », « 15/03/2021 », « Jan 15, 2020 », « Present », « aujourd’hui ».
 */
export function parseLooseDate(input: unknown): LooseDate {
  const raw = clip(input).toLowerCase()
  if (!raw) return { value: '', ongoing: false }
  if (/^(present|présent|now|current|aujourd['’]hui|en cours|actuel(le)?|ce jour|à ce jour|today)$/.test(raw)) return { value: '', ongoing: true }
  let m = /^(\d{4})(?:-(\d{1,2})(?:-\d{1,2})?)?(?:t.*)?$/.exec(raw)
  if (m) {
    const month = m[2] ? Number(m[2]) : 0
    return { value: month >= 1 && month <= 12 ? `${m[1]}-${pad(month)}` : m[1]!, ongoing: false }
  }
  m = /^(?:(\d{1,2})[/.-])?(\d{1,2})[/.-](\d{4})$/.exec(raw)
  if (m) {
    const month = Number(m[2])
    return { value: month >= 1 && month <= 12 ? `${m[3]}-${pad(month)}` : m[3]!, ongoing: false }
  }
  m = /^(?:\d{1,2}(?:er)?\s+)?([\p{L}]+)\.?\s+(?:\d{1,2},?\s+)?(\d{4})$/u.exec(raw)
  if (m) {
    const month = MONTHS[m[1]!]
    return month ? { value: `${m[2]}-${pad(month)}`, ongoing: false } : { value: m[2]!, ongoing: false }
  }
  const year = /(?<!\d)(19|20)\d{2}(?!\d)/.exec(raw)
  return { value: year ? year[0] : '', ongoing: false }
}

/** Adresse http(s) valide pour le schéma, sinon "" (une adresse sans schéma reçoit « https:// »). */
export function cleanUrl(value: unknown): string {
  let u = clip(value, LIMITS.url)
  if (!u) return ''
  if (/^www\.|^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(u) && !/^https?:/i.test(u)) u = `https://${u}`
  return /^https?:\/\/\S+$/i.test(u) && u.length <= LIMITS.url ? u : ''
}

export function cleanPhoto(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.length <= MAX_PHOTO_CHARS && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : ''
}

export function skillList(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  for (const v of values) {
    const s = clip(v, LIMITS.skill)
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s)
  }
  return out.slice(0, LIMITS.skills)
}

/** Ordre des rubriques par défaut, rubriques libres en fin. */
export function defaultSections(data: Pick<ProfileData, 'customSections'>): SectionRef[] {
  return [...SECTION_KEYS.map((key) => ({ key, visible: true })), ...data.customSections.map((c) => ({ key: 'custom' as const, customId: c.id, visible: true }))]
}

/**
 * Rend un profil importé conforme au schéma : bornes de tableaux, dates incohérentes neutralisées,
 * rubriques complètes. Toute correction est consignée dans `notes`.
 */
export function finalizeProfile(data: ProfileData, notes: string[]): ProfileData {
  const order = (start: string, end: string | null, what: string): string | null => {
    const s = dateIndex(start, 'start')
    const e = dateIndex(end, 'end')
    if (s !== null && e !== null && e < s) {
      notes.push(`${what} : la fin précède le début, date de fin retirée.`)
      return ''
    }
    return end
  }
  const okDate = (v: string) => (v === '' || DATE_RE.test(v) ? v : '')
  const cap = <T>(list: T[], max: number, what: string): T[] => {
    if (list.length > max) notes.push(`${what} : ${list.length - max} élément(s) au-delà de ${max} non importé(s).`)
    return list.slice(0, max)
  }

  data.experiences = cap(data.experiences, LIMITS.items, 'Expériences').map((e) => {
    e.startDate = okDate(e.startDate)
    e.endDate = e.current ? null : order(e.startDate, e.endDate === null ? null : okDate(e.endDate), `« ${e.title || e.company} »`)
    e.achievements = cap(e.achievements, LIMITS.achievements, `Réalisations de « ${e.title || e.company} »`)
    e.missions = cap(e.missions, LIMITS.missions, 'Missions').map((m) => {
      m.startDate = okDate(m.startDate)
      m.endDate = order(m.startDate, m.endDate === null ? null : okDate(m.endDate), `Mission « ${m.client} »`)
      m.achievements = cap(m.achievements, LIMITS.achievements, `Réalisations de la mission « ${m.client} »`)
      return m
    })
    return e
  })
  data.education = cap(data.education, LIMITS.items, 'Formations').map((e) => ({ ...e, startDate: okDate(e.startDate), endDate: order(okDate(e.startDate), okDate(e.endDate), `Formation « ${e.degree || e.school} »`) ?? '' }))
  data.projects = cap(data.projects, LIMITS.items, 'Projets').map((p) => ({ ...p, startDate: okDate(p.startDate), endDate: order(okDate(p.startDate), okDate(p.endDate), `Projet « ${p.name} »`) ?? '' }))
  data.certifications = cap(data.certifications, LIMITS.items, 'Certifications').map((c) => ({ ...c, date: okDate(c.date) }))
  data.awards = cap(data.awards, LIMITS.items, 'Distinctions').map((a) => ({ ...a, date: okDate(a.date) }))
  data.publications = cap(data.publications, LIMITS.items, 'Publications').map((p) => ({ ...p, date: okDate(p.date) }))
  data.skills = cap(data.skills, LIMITS.items, 'Groupes de compétences')
  data.languages = cap(data.languages, LIMITS.items, 'Langues')
  data.links = cap(data.links, LIMITS.items, 'Liens')
  data.interests = cap(data.interests, LIMITS.interests, 'Centres d’intérêt')
  data.customSections = cap(data.customSections, LIMITS.customSections, 'Rubriques libres').map((c) => ({ ...c, entries: cap(c.entries, LIMITS.entries, `Rubrique « ${c.title} »`).map((e) => ({ ...e, date: okDate(e.date) })) }))

  const check = ProfileSchema.safeParse(data)
  if (!check.success) {
    // Ordre des rubriques incohérent (extension tierce) : on repart de l'ordre par défaut.
    data.sections = defaultSections(data)
    const again = ProfileSchema.safeParse(data)
    if (!again.success) notes.push(`Profil importé incomplet : ${again.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} (${i.message})`).join(' ; ')}.`)
  }
  return data
}

export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = clip(full).split(' ').filter(Boolean)
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' }
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') }
}
