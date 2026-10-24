import type { CvLocale, CvSettings } from '@/domain/cv'
import { customSectionOf, sectionHasContent, sectionId, type Experience, type ProfileData, type SectionId, type SectionKey } from '@/domain/profile'

/**
 * Titres de rubriques écrits dans le PDF. Volontairement conventionnels :
 * les analyseurs de CV repèrent les rubriques à ces intitulés standards.
 */
export const CV_HEADINGS: Record<CvLocale, Record<SectionKey, string>> = {
  fr: {
    summary: 'Profil',
    experiences: 'Expérience professionnelle',
    skills: 'Compétences',
    education: 'Formation',
    certifications: 'Certifications',
    languages: 'Langues',
    projects: 'Projets',
    awards: 'Distinctions',
    publications: 'Publications',
    interests: 'Centres d’intérêt',
  },
  en: {
    summary: 'Profile',
    experiences: 'Professional Experience',
    skills: 'Skills',
    education: 'Education',
    certifications: 'Certifications',
    languages: 'Languages',
    projects: 'Projects',
    awards: 'Awards',
    publications: 'Publications',
    interests: 'Interests',
  },
}

export interface PlannedEntry {
  id: string
  /** Vrai : l'entrée ne doit pas être coupée entre deux pages. */
  keepTogether: boolean
}

export interface PlannedSection {
  /** Identifiant stable : clé fixe ou `custom:<id>`. */
  id: SectionId
  key: SectionKey | 'custom'
  customId?: string
  title: string
  /** Vrai : la rubrique démarre sur une nouvelle page. */
  breakBefore: boolean
  entries: PlannedEntry[]
}

/**
 * Au-delà de ce nombre de lignes estimées, une entrée ne peut plus être
 * « insécable » : elle ne tiendrait pas sur une page et le moteur de rendu
 * la tronquerait. Une page A4 de CV porte environ 60 lignes de texte.
 */
export const MAX_UNBREAKABLE_LINES = 28

/** Caractères par ligne pour une colonne de texte A4 (≈ 500 pt, corps 9,5 pt). */
const CHARS_PER_LINE = 95

function linesFor(text: string, width = CHARS_PER_LINE): number {
  if (!text.trim()) return 0
  return text.split('\n').reduce((n, para) => n + Math.max(1, Math.ceil(para.length / width)), 0)
}

/** Estimation prudente de la hauteur d'une expérience (missions comprises), en lignes. */
export function estimateExperienceLines(e: Experience, columnRatio = 1): number {
  const width = Math.max(40, Math.round(CHARS_PER_LINE * columnRatio))
  const bullets = (items: { text: string }[]) => items.reduce((n, a) => n + linesFor(a.text, width - 4), 0)
  const missions = e.missions.reduce((n, m) => n + 2 + linesFor(m.description, width) + bullets(m.achievements), 0)
  return 3 + linesFor(e.description, width) + bullets(e.achievements) + missions
}

export function estimateEducationLines(e: ProfileData['education'][number], columnRatio = 1): number {
  return 3 + linesFor(e.description, Math.round(CHARS_PER_LINE * columnRatio))
}

const named = <T extends { id: string }>(items: T[], has: (x: T) => boolean, keep: boolean): PlannedEntry[] =>
  items.filter(has).map((x) => ({ id: x.id, keepTogether: keep }))

/**
 * Transforme le contenu et les réglages en un plan de mise en page :
 * rubriques visibles, non vides, dans l'ordre choisi, avec les sauts de page
 * forcés et les entrées insécables. Fonction pure : le rendu ne fait que l'exécuter.
 *
 * `columnRatio` : largeur de la colonne de contenu rapportée à une pleine largeur
 * (modèles à marge ou barre latérale) — affine l'estimation des entrées insécables.
 */
export function planSections(data: ProfileData, settings: CvSettings, columnRatio = 1): PlannedSection[] {
  const planned: PlannedSection[] = []
  const headings = CV_HEADINGS[settings.locale ?? 'fr']
  const keep = settings.keepEntriesTogether

  for (const ref of data.sections) {
    const sid = sectionId(ref)
    if (!ref.visible || !sectionHasContent(data, sid)) continue

    let entries: PlannedEntry[]
    let title: string

    if (ref.key === 'custom') {
      const custom = customSectionOf(data, sid)
      if (!custom) continue
      title = custom.title.trim() || (settings.locale === 'en' ? 'Other' : 'Divers')
      entries = named(custom.entries, (e) => !!(e.title.trim() || e.description.trim()), true)
    } else {
      title = headings[ref.key]
      switch (ref.key) {
        case 'summary':
          entries = [{ id: 'summary', keepTogether: false }]
          break
        case 'experiences':
          entries = data.experiences
            .filter((e) => e.title.trim() || e.company.trim())
            .map((e) => ({ id: e.id, keepTogether: keep && estimateExperienceLines(e, columnRatio) <= MAX_UNBREAKABLE_LINES }))
          break
        case 'education':
          entries = data.education
            .filter((e) => e.degree.trim() || e.school.trim())
            .map((e) => ({ id: e.id, keepTogether: keep && estimateEducationLines(e, columnRatio) <= MAX_UNBREAKABLE_LINES }))
          break
        case 'skills':
          entries = named(data.skills, (s) => s.items.length > 0, true)
          break
        case 'certifications':
          entries = named(data.certifications, (c) => !!c.name.trim(), true)
          break
        case 'languages':
          entries = [{ id: 'languages', keepTogether: true }]
          break
        case 'projects':
          entries = named(data.projects, (p) => !!p.name.trim(), keep)
          break
        case 'awards':
          entries = named(data.awards, (a) => !!a.title.trim(), true)
          break
        case 'publications':
          entries = named(data.publications, (p) => !!p.title.trim(), true)
          break
        case 'interests':
          entries = [{ id: 'interests', keepTogether: true }]
          break
      }
    }

    planned.push({
      id: sid,
      key: ref.key,
      ...(ref.key === 'custom' ? { customId: ref.customId } : {}),
      title,
      // Un saut avant la toute première rubrique laisserait l'en-tête seul sur la page 1.
      breakBefore: planned.length > 0 && settings.pageBreakBefore.includes(sid),
      entries,
    })
  }

  return planned
}
