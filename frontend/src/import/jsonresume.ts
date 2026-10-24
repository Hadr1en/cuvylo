import { PUBLICATION_KINDS, emptyProfile, type CustomSection, type Experience, type ProfileData, type SectionRef } from '@/domain/profile'
import { LIMITS, clip, cleanPhoto, cleanUrl, defaultIds, defaultSections, finalizeProfile, parseLooseDate, skillList, splitName, type IdFactory } from './common'

/**
 * Import et export au format JSON Resume (schéma v1.0.0, https://jsonresume.org/schema).
 * Ce que JSON Resume ne sait pas exprimer (missions, activité parallèle, compétences par expérience,
 * rubriques libres, mentions, ordre des rubriques) voyage dans des propriétés d'extension `x-cuvylo`,
 * ignorées par les autres outils et relues à l'import : l'aller-retour est sans perte (hors photo).
 */

export const JSON_RESUME_SCHEMA = 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json'
export const EXTENSION = 'x-cuvylo'

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObj) : [])
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const lines = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join('\n')

// ── Export ──────────────────────────────────────────────────────────────────

const omitEmpty = (o: Json): Json => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && !(Array.isArray(v) && v.length === 0)))

export interface JsonResumeOptions {
  /** Inclure la photo (data URL) dans `basics.image`. Faux par défaut : poids et données personnelles. */
  includePhoto?: boolean
}

export function toJsonResume(data: ProfileData, opts: JsonResumeOptions = {}): Json {
  const id = data.identity
  const [city, ...rest] = id.location.split(',').map((s) => s.trim())
  return {
    $schema: JSON_RESUME_SCHEMA,
    basics: omitEmpty({
      name: [id.firstName, id.lastName].filter(Boolean).join(' '),
      label: id.headline,
      image: opts.includePhoto ? id.photo : '',
      email: id.email,
      phone: id.phone,
      summary: data.summary,
      location: id.location ? omitEmpty({ city: city ?? '', region: rest.join(', ') }) : undefined,
      profiles: data.links.filter((l) => l.url).map((l) => omitEmpty({ network: l.label, url: l.url })),
    }),
    work: data.experiences.map((e) =>
      omitEmpty({
        name: e.company,
        position: e.title,
        location: e.location,
        startDate: e.startDate,
        endDate: e.current ? '' : (e.endDate ?? ''),
        summary: e.description,
        highlights: e.achievements.map((a) => a.text).filter(Boolean),
        [EXTENSION]: { current: e.current, parallel: e.parallel, skills: e.skills, missions: e.missions },
      }),
    ),
    education: data.education.map((e) => omitEmpty({ institution: e.school, studyType: e.degree, location: e.location, startDate: e.startDate, endDate: e.endDate, [EXTENSION]: { description: e.description } })),
    certificates: data.certifications.map((c) => omitEmpty({ name: c.name, issuer: c.issuer, date: c.date, url: c.url })),
    awards: data.awards.map((a) => omitEmpty({ title: a.title, awarder: a.issuer, date: a.date, summary: a.description })),
    publications: data.publications.map((p) => omitEmpty({ name: p.title, publisher: p.outlet, releaseDate: p.date, url: p.url, summary: p.description, [EXTENSION]: { kind: p.kind } })),
    skills: data.skills.map((g) => omitEmpty({ name: g.category, keywords: g.items, [EXTENSION]: { kind: g.kind } })),
    languages: data.languages.map((l) => omitEmpty({ language: l.name, fluency: l.level })),
    interests: data.interests.map((i) => ({ name: i.text })),
    projects: data.projects.map((p) =>
      omitEmpty({ name: p.name, roles: p.role ? [p.role] : [], startDate: p.startDate, endDate: p.endDate, url: p.url, description: p.description, keywords: p.skills }),
    ),
    meta: {
      version: 'v1.0.0',
      [EXTENSION]: { schemaVersion: 2, details: id.details, customSections: data.customSections, sections: data.sections },
    },
  }
}

// ── Import ──────────────────────────────────────────────────────────────────

export interface JsonResumeImport {
  data: ProfileData
  /** Ce qui n'a pas pu être repris tel quel (à montrer à l'utilisateur). */
  notes: string[]
}

const KNOWN_PROFILES: Record<string, (u: string) => string> = {
  linkedin: (u) => `https://www.linkedin.com/in/${u}`,
  github: (u) => `https://github.com/${u}`,
  gitlab: (u) => `https://gitlab.com/${u}`,
  twitter: (u) => `https://x.com/${u}`,
  x: (u) => `https://x.com/${u}`,
}

/** Accepte un objet ou une chaîne JSON. */
export function fromJsonResume(input: unknown, opts: { makeId?: IdFactory } = {}): JsonResumeImport {
  const makeId = opts.makeId ?? defaultIds
  const notes: string[] = []
  let json: unknown = input
  if (typeof input === 'string') {
    try {
      json = JSON.parse(input)
    } catch {
      return { data: emptyProfile(), notes: ['Fichier illisible : ce n’est pas du JSON valide.'] }
    }
  }
  if (!isObj(json)) return { data: emptyProfile(), notes: ['Format inattendu : un objet JSON Resume est attendu.'] }

  const data = emptyProfile()
  const basics = isObj(json.basics) ? json.basics : {}
  const { firstName, lastName } = splitName(str(basics.name))
  const loc = isObj(basics.location) ? basics.location : {}
  const ext = isObj(json.meta) && isObj(json.meta[EXTENSION]) ? (json.meta[EXTENSION] as Json) : {}

  data.identity = {
    firstName,
    lastName,
    headline: clip(basics.label),
    email: clip(basics.email),
    phone: clip(basics.phone),
    location: clip([str(loc.city), str(loc.region) || str(loc.countryCode)].filter(Boolean).join(', ') || str(loc.address)),
    details: clip(ext.details),
    photo: cleanPhoto(basics.image),
  }
  if (str(basics.image) && !data.identity.photo) notes.push('Photo non reprise : seule une image JPEG ou PNG intégrée (data URL) est acceptée.')
  data.summary = clip(basics.summary, LIMITS.long)

  if (cleanUrl(basics.url)) data.links.push({ id: makeId(), label: 'Site web', url: cleanUrl(basics.url) })
  for (const p of arr(basics.profiles)) {
    const network = clip(p.network)
    const username = clip(p.username)
    const url = cleanUrl(p.url) || (username && KNOWN_PROFILES[network.toLowerCase()] ? KNOWN_PROFILES[network.toLowerCase()]!(username) : '')
    if (url) data.links.push({ id: makeId(), label: network || 'Profil', url })
    else if (network || username) notes.push(`Profil « ${network || username} » ignoré : adresse manquante.`)
  }

  const experience = (w: Json, company: string, parallel: boolean): Experience => {
    const x = isObj(w[EXTENSION]) ? (w[EXTENSION] as Json) : {}
    const start = parseLooseDate(w.startDate)
    const end = parseLooseDate(w.endDate)
    const current = typeof x.current === 'boolean' ? x.current : end.ongoing || (!end.value && !!start.value)
    return {
      id: makeId(),
      title: clip(w.position),
      company: clip(company),
      location: clip(w.location),
      startDate: start.value,
      endDate: current ? null : end.value,
      current,
      description: clip(lines(str(w.summary), str(w.description)), LIMITS.long),
      achievements: (Array.isArray(w.highlights) ? w.highlights : []).map((h) => clip(h, LIMITS.long)).filter(Boolean).map((text) => ({ id: makeId(), text })),
      parallel: typeof x.parallel === 'boolean' ? x.parallel : parallel,
      skills: skillList(x.skills),
      missions: arr(x.missions).map((m) => ({
        id: makeId(),
        client: clip(m.client),
        role: clip(m.role),
        location: clip(m.location),
        startDate: parseLooseDate(m.startDate).value,
        endDate: m.endDate === null ? null : parseLooseDate(m.endDate).value,
        description: clip(m.description, LIMITS.long),
        achievements: arr(m.achievements).map((a) => clip(a.text, LIMITS.long)).filter(Boolean).map((text) => ({ id: makeId(), text })),
        skills: skillList(m.skills),
      })),
    }
  }
  data.experiences = [...arr(json.work).map((w) => experience(w, str(w.name) || str(w.company), false)), ...arr(json.volunteer).map((v) => experience(v, str(v.organization), true))]

  data.education = arr(json.education).map((e) => {
    const x = isObj(e[EXTENSION]) ? (e[EXTENSION] as Json) : {}
    const courses = Array.isArray(e.courses) ? e.courses.map(str).filter(Boolean) : []
    const description = 'description' in x ? str(x.description) : lines(str(e.score) ? `Résultat : ${str(e.score)}` : '', courses.length ? `Cours : ${courses.join(', ')}` : '')
    return {
      id: makeId(),
      degree: clip([str(e.studyType), str(e.area)].filter(Boolean).join(' ')),
      school: clip(e.institution),
      location: clip(e.location),
      startDate: parseLooseDate(e.startDate).value,
      endDate: parseLooseDate(e.endDate).value,
      description: clip(description, LIMITS.long),
    }
  })
  data.certifications = arr(json.certificates).map((c) => ({ id: makeId(), name: clip(c.name), issuer: clip(c.issuer), date: parseLooseDate(c.date).value, url: cleanUrl(c.url) }))
  data.awards = arr(json.awards).map((a) => ({ id: makeId(), title: clip(a.title), issuer: clip(a.awarder), date: parseLooseDate(a.date).value, description: clip(a.summary, LIMITS.long) }))
  data.publications = arr(json.publications).map((p) => {
    const kind = isObj(p[EXTENSION]) ? str((p[EXTENSION] as Json).kind) : ''
    return {
      id: makeId(),
      title: clip(p.name),
      outlet: clip(p.publisher),
      date: parseLooseDate(p.releaseDate).value,
      url: cleanUrl(p.url),
      kind: (PUBLICATION_KINDS as readonly string[]).includes(kind) ? (kind as (typeof PUBLICATION_KINDS)[number]) : 'article',
      description: clip(p.summary, LIMITS.long),
    }
  })

  const loose: string[] = []
  for (const s of arr(json.skills)) {
    const keywords = skillList(s.keywords)
    const kind = isObj(s[EXTENSION]) && (s[EXTENSION] as Json).kind === 'soft' ? 'soft' : 'technical'
    if (keywords.length) data.skills.push({ id: makeId(), category: clip(s.name), kind, items: keywords })
    else if (clip(s.name, LIMITS.skill)) loose.push(clip(s.name, LIMITS.skill))
  }
  if (loose.length) data.skills.push({ id: makeId(), category: '', kind: 'technical', items: skillList(loose) })

  data.languages = arr(json.languages).map((l) => ({ id: makeId(), name: clip(l.language), level: clip(l.fluency) }))
  data.interests = arr(json.interests)
    .map((i) => clip([str(i.name), Array.isArray(i.keywords) && i.keywords.length ? `(${i.keywords.map(str).join(', ')})` : ''].filter(Boolean).join(' '), 200))
    .filter(Boolean)
    .map((text) => ({ id: makeId(), text }))
  data.projects = arr(json.projects).map((p) => {
    const highlights = Array.isArray(p.highlights) ? p.highlights.map(str).filter(Boolean) : []
    return {
      id: makeId(),
      name: clip(p.name),
      role: clip(Array.isArray(p.roles) ? p.roles.map(str).join(', ') : ''),
      startDate: parseLooseDate(p.startDate).value,
      endDate: parseLooseDate(p.endDate).value,
      url: cleanUrl(p.url),
      description: clip(lines(str(p.description), ...highlights.map((h) => `- ${h}`)), LIMITS.long),
      skills: skillList(p.keywords),
    }
  })
  if (arr(json.references).length) notes.push(`${arr(json.references).length} référence(s) non importée(s) : le profil n’a pas de rubrique dédiée.`)

  // Extensions Cuvylo : rubriques libres et ordre des rubriques (identifiants conservés pour l'ordre).
  const customs: CustomSection[] = arr(ext.customSections).map((c) => ({
    id: /^[A-Za-z0-9_-]{1,36}$/.test(str(c.id)) ? str(c.id) : makeId(),
    title: clip(c.title, 80),
    entries: arr(c.entries).map((e) => ({ id: makeId(), title: clip(e.title), subtitle: clip(e.subtitle), date: parseLooseDate(e.date).value, description: clip(e.description, LIMITS.long) })),
  }))
  data.customSections = customs
  const refs = Array.isArray(ext.sections) ? arr(ext.sections).map((r) => ({ ...r }) as SectionRef) : null
  data.sections = refs ?? defaultSections(data)

  return { data: finalizeProfile(data, notes), notes }
}
