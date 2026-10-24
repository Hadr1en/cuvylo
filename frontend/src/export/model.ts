import { anonymizeProfile } from '@/domain/anonymize'
import type { CvLocale, CvSettings } from '@/domain/cv'
import { PUBLICATION_KIND_LABELS, fullName, type ProfileData, type SectionId } from '@/domain/profile'
import { planSections } from '@/pdf/layout'
import { formatCvDate, formatCvPeriod } from './format'

/**
 * Modèle de document neutre, commun aux exports Word et texte : une seule colonne, l'ordre et
 * les rubriques du plan PDF (`planSections` : rubriques visibles et non vides, intitulés localisés
 * de `CV_HEADINGS`), anonymisation appliquée si demandée.
 */

export type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'meta'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'labelled'; label: string; text: string }

export interface ExportSection {
  id: SectionId
  title: string
  blocks: Block[]
}

export interface ExportDoc {
  locale: CvLocale
  name: string
  headline: string
  /** E-mail, téléphone, localisation, adresses des liens (en clair). */
  contact: string[]
  details: string
  sections: ExportSection[]
}

const WORDS: Record<CvLocale, { skills: string; environment: string; sep: string; parallel: string }> = {
  fr: { skills: 'Compétences', environment: 'Environnement', sep: ' : ', parallel: 'en parallèle' },
  en: { skills: 'Skills', environment: 'Environment', sep: ': ', parallel: 'in parallel' },
}

const PUBLICATION_KIND_EN: Record<keyof typeof PUBLICATION_KIND_LABELS, string> = { article: 'Article', talk: 'Talk', interview: 'Interview', book: 'Book', other: 'Other' }

/** "https://www.example.com/in/x/" → "example.com/in/x". */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
}

const join = (sep: string, ...parts: (string | undefined)[]) =>
  parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(sep)

/** Paragraphes d'un texte libre (une ligne = un paragraphe ; puces saisies converties en liste). */
function textBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length) blocks.push({ kind: 'bullets', items: bullets })
    bullets = []
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const b = /^[-–—•·▪*]\s+(.*)$/u.exec(line)
    if (b) bullets.push(b[1]!)
    else {
      flush()
      blocks.push({ kind: 'paragraph', text: line })
    }
  }
  flush()
  return blocks
}

const bullets = (items: string[]): Block[] => {
  const list = items.map((s) => s.trim()).filter(Boolean)
  return list.length ? [{ kind: 'bullets', items: list }] : []
}

export function buildExportDoc(source: ProfileData, settings: Pick<CvSettings, 'locale' | 'anonymize'> & Partial<CvSettings>): ExportDoc {
  const locale = settings.locale ?? 'fr'
  const data = settings.anonymize ? anonymizeProfile(source) : source
  const w = WORDS[locale]
  const id = data.identity
  const plan = planSections(data, { pageBreakBefore: [], keepEntriesTogether: true, ...settings } as CvSettings)

  const sections: ExportSection[] = plan.map((s) => {
    const ids = new Set(s.entries.map((e) => e.id))
    const blocks: Block[] = []
    switch (s.key) {
      case 'summary':
        blocks.push(...textBlocks(data.summary))
        break
      case 'experiences':
        for (const e of data.experiences.filter((x) => ids.has(x.id))) {
          blocks.push({ kind: 'heading', level: 2, text: join(' — ', e.title, e.company) })
          const meta = join(' · ', formatCvPeriod(e.startDate, e.endDate, e.current, locale), e.location, e.parallel ? w.parallel : '')
          if (meta) blocks.push({ kind: 'meta', text: meta })
          blocks.push(...textBlocks(e.description), ...bullets(e.achievements.map((a) => a.text)))
          for (const m of e.missions) {
            if (!m.client.trim() && !m.role.trim() && !m.description.trim() && !m.achievements.some((a) => a.text.trim())) continue
            blocks.push({ kind: 'heading', level: 3, text: join(' — ', m.client, m.role) })
            const mMeta = join(' · ', formatCvPeriod(m.startDate, m.endDate, false, locale), m.location)
            if (mMeta) blocks.push({ kind: 'meta', text: mMeta })
            blocks.push(...textBlocks(m.description), ...bullets(m.achievements.map((a) => a.text)))
            if (m.skills.length) blocks.push({ kind: 'labelled', label: w.environment, text: m.skills.join(', ') })
          }
          if (e.skills.length) blocks.push({ kind: 'labelled', label: w.skills, text: e.skills.join(', ') })
        }
        break
      case 'skills':
        for (const g of data.skills.filter((x) => ids.has(x.id))) {
          if (g.category.trim()) blocks.push({ kind: 'labelled', label: g.category.trim(), text: g.items.join(', ') })
          else blocks.push({ kind: 'paragraph', text: g.items.join(', ') })
        }
        break
      case 'education':
        for (const e of data.education.filter((x) => ids.has(x.id))) {
          blocks.push({ kind: 'heading', level: 2, text: join(' — ', e.degree, e.school) })
          const meta = join(' · ', formatCvPeriod(e.startDate, e.endDate, false, locale), e.location)
          if (meta) blocks.push({ kind: 'meta', text: meta })
          blocks.push(...textBlocks(e.description))
        }
        break
      case 'certifications':
        blocks.push(...bullets(data.certifications.filter((c) => ids.has(c.id)).map((c) => join(' — ', c.name, join(', ', c.issuer, formatCvDate(c.date, locale))))))
        break
      case 'languages':
        blocks.push(...bullets(data.languages.filter((l) => l.name.trim()).map((l) => (l.level.trim() ? `${l.name.trim()}${w.sep}${l.level.trim()}` : l.name.trim()))))
        break
      case 'projects':
        for (const p of data.projects.filter((x) => ids.has(x.id))) {
          blocks.push({ kind: 'heading', level: 2, text: join(' — ', p.name, p.role) })
          const meta = join(' · ', formatCvPeriod(p.startDate, p.endDate, false, locale), p.url ? displayUrl(p.url) : '')
          if (meta) blocks.push({ kind: 'meta', text: meta })
          blocks.push(...textBlocks(p.description))
          if (p.skills.length) blocks.push({ kind: 'labelled', label: w.environment, text: p.skills.join(', ') })
        }
        break
      case 'awards':
        for (const a of data.awards.filter((x) => ids.has(x.id))) {
          blocks.push(...bullets([join(' — ', a.title, join(', ', a.issuer, formatCvDate(a.date, locale)))]), ...textBlocks(a.description))
        }
        break
      case 'publications':
        for (const p of data.publications.filter((x) => ids.has(x.id))) {
          const kind = locale === 'en' ? PUBLICATION_KIND_EN[p.kind] : PUBLICATION_KIND_LABELS[p.kind]
          blocks.push(...bullets([join(' — ', p.title, join(', ', p.outlet, formatCvDate(p.date, locale), kind), p.url ? displayUrl(p.url) : '')]), ...textBlocks(p.description))
        }
        break
      case 'interests':
        blocks.push({ kind: 'paragraph', text: data.interests.map((i) => i.text.trim()).filter(Boolean).join(' · ') })
        break
      case 'custom': {
        const c = data.customSections.find((x) => x.id === s.customId)
        for (const e of (c?.entries ?? []).filter((x) => ids.has(x.id))) {
          if (e.title.trim()) blocks.push({ kind: 'heading', level: 2, text: e.title.trim() })
          const meta = join(' · ', e.subtitle, formatCvDate(e.date, locale))
          if (meta) blocks.push({ kind: 'meta', text: meta })
          blocks.push(...textBlocks(e.description))
        }
        break
      }
    }
    return { id: s.id, title: s.title, blocks }
  })

  return {
    locale,
    name: fullName(data),
    headline: id.headline.trim(),
    contact: [id.email, id.phone, id.location, ...data.links.filter((l) => l.url.trim()).map((l) => displayUrl(l.url))].map((s) => s.trim()).filter(Boolean),
    details: id.details.trim(),
    sections,
  }
}
