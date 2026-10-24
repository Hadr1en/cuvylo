import { z } from 'zod'

/**
 * Modèle du profil maître et des CV — v2.
 * Le serveur reste l'autorité de validation ; ce schéma sert à l'ergonomie, à la validation
 * locale avant envoi et à la lecture des fichiers importés. Les limites sont celles du backend.
 */

/** Rubriques fixes ; les rubriques libres s'y ajoutent sous la forme { key: 'custom', customId }. */
export const SECTION_KEYS = [
  'summary',
  'experiences',
  'skills',
  'education',
  'certifications',
  'languages',
  'projects',
  'awards',
  'publications',
  'interests',
] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

/** Identifiant d'une rubrique dans un plan ou un réglage : clé fixe ou `custom:<id>`. */
export type SectionId = SectionKey | `custom:${string}`

export const SECTION_LABELS: Record<SectionKey, string> = {
  summary: 'Résumé',
  experiences: 'Expériences',
  skills: 'Compétences',
  education: 'Formation',
  certifications: 'Certifications',
  languages: 'Langues',
  projects: 'Projets',
  awards: 'Distinctions',
  publications: 'Publications et médias',
  interests: 'Centres d’intérêt',
}

export const PUBLICATION_KINDS = ['article', 'talk', 'interview', 'book', 'other'] as const
export const PUBLICATION_KIND_LABELS: Record<(typeof PUBLICATION_KINDS)[number], string> = {
  article: 'Article',
  talk: 'Conférence',
  interview: 'Interview',
  book: 'Livre',
  other: 'Autre',
}

const MAX_SHORT = 200
const MAX_LONG = 4000
const MAX_URL = 500
const MAX_ITEMS = 50
export const MAX_PHOTO_CHARS = 200_000

const id = z.string().regex(/^[A-Za-z0-9_-]{1,36}$/)
const short = z.string().max(MAX_SHORT)
const long = z.string().max(MAX_LONG)
/** "", "AAAA" ou "AAAA-MM". */
export const DATE_RE = /^\d{4}(-(0[1-9]|1[0-2]))?$/
const date = z.union([z.string().regex(DATE_RE), z.literal('')])
const endDate = z.union([date, z.null()])
const url = z
  .string()
  .max(MAX_URL)
  .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'URL http(s) attendue (commencez par https://)')
const skillList = z.array(z.string().max(80)).max(40)
const photo = z
  .string()
  .max(MAX_PHOTO_CHARS)
  .refine((v) => v === '' || /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v), 'Image JPEG ou PNG attendue')

/** Une date "AAAA" vaut janvier en début et décembre en fin de période (contrat §1.1). */
export function dateIndex(value: string | null | undefined, edge: 'start' | 'end' = 'start'): number | null {
  if (!value) return null
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(value)
  if (!m) return null
  const month = m[2] ? Number(m[2]) : edge === 'start' ? 1 : 12
  return Number(m[1]) * 12 + month - 1
}

function orderOk(start: string, end: string | null): boolean {
  const s = dateIndex(start, 'start')
  const e = dateIndex(end, 'end')
  return s === null || e === null || e >= s
}

export const AchievementSchema = z.strictObject({ id, text: long })

export const MissionSchema = z
  .strictObject({
    id,
    client: short,
    role: short,
    location: short,
    startDate: date,
    endDate,
    description: long,
    achievements: z.array(AchievementSchema).max(30),
    skills: skillList,
  })
  .refine((m) => orderOk(m.startDate, m.endDate), { message: 'La fin précède le début', path: ['endDate'] })

export const ExperienceSchema = z
  .strictObject({
    id,
    title: short,
    company: short,
    location: short,
    startDate: date,
    endDate,
    current: z.boolean(),
    description: long,
    achievements: z.array(AchievementSchema).max(30),
    parallel: z.boolean(),
    skills: skillList,
    missions: z.array(MissionSchema).max(30),
  })
  .refine((e) => !e.current || e.endDate === null || e.endDate === '', {
    message: 'Un poste actuel n’a pas de date de fin',
    path: ['endDate'],
  })
  .refine((e) => orderOk(e.startDate, e.endDate), { message: 'La fin précède le début', path: ['endDate'] })

export const SkillGroupSchema = z.strictObject({
  id,
  category: short,
  kind: z.enum(['technical', 'soft']),
  items: skillList,
})

export const EducationSchema = z
  .strictObject({ id, degree: short, school: short, location: short, startDate: date, endDate: date, description: long })
  .refine((e) => orderOk(e.startDate, e.endDate), { message: 'La fin précède le début', path: ['endDate'] })

export const CertificationSchema = z.strictObject({ id, name: short, issuer: short, date, url })
export const LanguageSchema = z.strictObject({ id, name: short, level: short })
export const LinkSchema = z.strictObject({ id, label: short, url })

export const ProjectSchema = z
  .strictObject({ id, name: short, role: short, startDate: date, endDate: date, url, description: long, skills: skillList })
  .refine((p) => orderOk(p.startDate, p.endDate), { message: 'La fin précède le début', path: ['endDate'] })
export const AwardSchema = z.strictObject({ id, title: short, issuer: short, date, description: long })
export const PublicationSchema = z.strictObject({ id, title: short, outlet: short, date, url, kind: z.enum(PUBLICATION_KINDS), description: long })
export const InterestSchema = z.strictObject({ id, text: z.string().max(200) })
export const CustomEntrySchema = z.strictObject({ id, title: short, subtitle: short, date, description: long })
export const CustomSectionSchema = z.strictObject({ id, title: z.string().max(80), entries: z.array(CustomEntrySchema).max(30) })

export const SectionRefSchema = z.union([
  z.strictObject({ key: z.enum(SECTION_KEYS), visible: z.boolean() }),
  z.strictObject({ key: z.literal('custom'), customId: id, visible: z.boolean() }),
])

export const ProfileSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    identity: z.strictObject({
      firstName: short,
      lastName: short,
      headline: short,
      email: short,
      phone: short,
      location: short,
      details: short,
      photo,
    }),
    links: z.array(LinkSchema).max(MAX_ITEMS),
    summary: long,
    experiences: z.array(ExperienceSchema).max(MAX_ITEMS),
    skills: z.array(SkillGroupSchema).max(MAX_ITEMS),
    education: z.array(EducationSchema).max(MAX_ITEMS),
    certifications: z.array(CertificationSchema).max(MAX_ITEMS),
    languages: z.array(LanguageSchema).max(MAX_ITEMS),
    projects: z.array(ProjectSchema).max(MAX_ITEMS),
    awards: z.array(AwardSchema).max(MAX_ITEMS),
    publications: z.array(PublicationSchema).max(MAX_ITEMS),
    interests: z.array(InterestSchema).max(30),
    customSections: z.array(CustomSectionSchema).max(10),
    sections: z.array(SectionRefSchema),
  })
  .superRefine((p, ctx) => {
    const fixed = p.sections.filter((s) => s.key !== 'custom').map((s) => s.key)
    const custom = p.sections.flatMap((s) => (s.key === 'custom' ? [s.customId] : []))
    const known = new Set(p.customSections.map((c) => c.id))
    const okFixed = fixed.length === SECTION_KEYS.length && new Set(fixed).size === SECTION_KEYS.length
    const okCustom = custom.length === known.size && new Set(custom).size === custom.length && custom.every((c) => known.has(c))
    if (!okFixed || !okCustom) {
      ctx.addIssue({ code: 'custom', message: 'Chaque rubrique doit apparaître exactement une fois', path: ['sections'] })
    }
  })

export type Achievement = z.infer<typeof AchievementSchema>
export type Mission = z.infer<typeof MissionSchema>
export type Experience = z.infer<typeof ExperienceSchema>
export type SkillGroup = z.infer<typeof SkillGroupSchema>
export type Education = z.infer<typeof EducationSchema>
export type Certification = z.infer<typeof CertificationSchema>
export type Language = z.infer<typeof LanguageSchema>
export type Link = z.infer<typeof LinkSchema>
export type Project = z.infer<typeof ProjectSchema>
export type Award = z.infer<typeof AwardSchema>
export type Publication = z.infer<typeof PublicationSchema>
export type Interest = z.infer<typeof InterestSchema>
export type CustomEntry = z.infer<typeof CustomEntrySchema>
export type CustomSection = z.infer<typeof CustomSectionSchema>
export type SectionRef = z.infer<typeof SectionRefSchema>
export type ProfileData = z.infer<typeof ProfileSchema>

/** Identifiant court et sûr (alphabet URL), suffisant pour l'unicité dans un tableau. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)
}

export function emptyProfile(): ProfileData {
  return {
    schemaVersion: 2,
    identity: { firstName: '', lastName: '', headline: '', email: '', phone: '', location: '', details: '', photo: '' },
    links: [],
    summary: '',
    experiences: [],
    skills: [],
    education: [],
    certifications: [],
    languages: [],
    projects: [],
    awards: [],
    publications: [],
    interests: [],
    customSections: [],
    sections: SECTION_KEYS.map((key) => ({ key, visible: true })),
  }
}

// ── Migration des documents (contrat §1.4, même algorithme côté PHP) ─────────

const V2_NEW_SECTIONS: SectionKey[] = ['projects', 'awards', 'publications', 'interests']

type Loose = Record<string, unknown>
const isObj = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Amène un document v1 en v2 sans rien perdre ; renvoie tel quel un document déjà v2 ou inconnu
 * (la validation stricte décide ensuite). Ne modifie pas l'objet reçu.
 */
export function migrateProfile(raw: unknown): unknown {
  if (!isObj(raw) || raw.schemaVersion !== 1) return raw
  const doc = structuredClone(raw)
  doc.schemaVersion = 2
  if (isObj(doc.identity)) doc.identity = { ...doc.identity, details: '', photo: '' }
  if (Array.isArray(doc.experiences)) {
    doc.experiences = doc.experiences.map((e) => (isObj(e) ? { ...e, parallel: false, skills: [], missions: [] } : e))
  }
  for (const key of ['projects', 'awards', 'publications', 'interests', 'customSections']) doc[key] = []
  if (Array.isArray(doc.sections)) doc.sections = [...doc.sections, ...V2_NEW_SECTIONS.map((key) => ({ key, visible: true }))]
  return doc
}

// ── Fabriques ────────────────────────────────────────────────────────────────

export function newExperience(): Experience {
  return {
    id: newId(),
    title: '',
    company: '',
    location: '',
    startDate: '',
    endDate: '',
    current: false,
    description: '',
    achievements: [],
    parallel: false,
    skills: [],
    missions: [],
  }
}

export function newMission(): Mission {
  return { id: newId(), client: '', role: '', location: '', startDate: '', endDate: '', description: '', achievements: [], skills: [] }
}

export function newSkillGroup(): SkillGroup {
  return { id: newId(), category: '', kind: 'technical', items: [] }
}

export function newEducation(): Education {
  return { id: newId(), degree: '', school: '', location: '', startDate: '', endDate: '', description: '' }
}

export function newCertification(): Certification {
  return { id: newId(), name: '', issuer: '', date: '', url: '' }
}

export function newLanguage(): Language {
  return { id: newId(), name: '', level: '' }
}

export function newLink(): Link {
  return { id: newId(), label: '', url: '' }
}

export function newProject(): Project {
  return { id: newId(), name: '', role: '', startDate: '', endDate: '', url: '', description: '', skills: [] }
}

export function newAward(): Award {
  return { id: newId(), title: '', issuer: '', date: '', description: '' }
}

export function newPublication(): Publication {
  return { id: newId(), title: '', outlet: '', date: '', url: '', kind: 'article', description: '' }
}

export function newInterest(): Interest {
  return { id: newId(), text: '' }
}

export function newCustomEntry(): CustomEntry {
  return { id: newId(), title: '', subtitle: '', date: '', description: '' }
}

/** Ajoute une rubrique libre (et sa référence d'ordre, visible, en fin de liste). */
export function addCustomSection(p: ProfileData, title: string): ProfileData {
  const section: CustomSection = { id: newId(), title, entries: [] }
  return {
    ...p,
    customSections: [...p.customSections, section],
    sections: [...p.sections, { key: 'custom', customId: section.id, visible: true }],
  }
}

export function removeCustomSection(p: ProfileData, customId: string): ProfileData {
  return {
    ...p,
    customSections: p.customSections.filter((c) => c.id !== customId),
    sections: p.sections.filter((s) => !(s.key === 'custom' && s.customId === customId)),
  }
}

// ── Lecture ──────────────────────────────────────────────────────────────────

export function fullName(p: ProfileData): string {
  return [p.identity.firstName, p.identity.lastName].filter(Boolean).join(' ').trim()
}

export function sectionId(ref: SectionRef): SectionId {
  return ref.key === 'custom' ? `custom:${ref.customId}` : ref.key
}

export function customSectionOf(p: ProfileData, sid: SectionId): CustomSection | undefined {
  return sid.startsWith('custom:') ? p.customSections.find((c) => c.id === sid.slice(7)) : undefined
}

/** Libellé d'interface d'une rubrique (titre saisi pour une rubrique libre). */
export function sectionLabel(p: ProfileData, sid: SectionId): string {
  if (sid.startsWith('custom:')) return customSectionOf(p, sid)?.title.trim() || 'Rubrique sans titre'
  return SECTION_LABELS[sid as SectionKey]
}

/** Une rubrique contient-elle quelque chose à afficher ? */
export function sectionHasContent(p: ProfileData, sid: SectionId): boolean {
  if (sid.startsWith('custom:')) {
    return (customSectionOf(p, sid)?.entries ?? []).some((e) => e.title.trim() || e.description.trim())
  }
  switch (sid as SectionKey) {
    case 'summary':
      return p.summary.trim() !== ''
    case 'experiences':
      return p.experiences.some((e) => e.title.trim() || e.company.trim())
    case 'skills':
      return p.skills.some((s) => s.items.length > 0)
    case 'education':
      return p.education.some((e) => e.degree.trim() || e.school.trim())
    case 'certifications':
      return p.certifications.some((c) => c.name.trim())
    case 'languages':
      return p.languages.some((l) => l.name.trim())
    case 'projects':
      return p.projects.some((x) => x.name.trim())
    case 'awards':
      return p.awards.some((x) => x.title.trim())
    case 'publications':
      return p.publications.some((x) => x.title.trim())
    case 'interests':
      return p.interests.some((x) => x.text.trim())
  }
  return false
}

/** Déplace l'élément `from` vers `to` sans muter le tableau d'origine. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item as T)
  return next
}

/** Part du profil renseignée, de 0 à 1 (indicateur indicatif, pas un score ATS). */
export function profileCompleteness(p: ProfileData): number {
  const checks = [
    p.identity.firstName.trim() !== '' && p.identity.lastName.trim() !== '',
    p.identity.headline.trim() !== '',
    p.identity.email.trim() !== '',
    p.identity.phone.trim() !== '' || p.identity.location.trim() !== '',
    p.summary.trim() !== '',
    p.experiences.length > 0,
    p.experiences.some((e) => e.achievements.some((a) => a.text.trim() !== '') || e.missions.some((m) => m.achievements.length > 0)),
    p.skills.some((s) => s.items.length > 0),
    p.education.length > 0,
    p.languages.length > 0,
  ]
  return checks.filter(Boolean).length / checks.length
}
