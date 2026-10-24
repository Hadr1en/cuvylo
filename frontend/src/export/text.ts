import type { CvSettings } from '@/domain/cv'
import type { ProfileData } from '@/domain/profile'
import { buildExportDoc, type Block, type ExportDoc } from './model'

/**
 * Export texte brut : ce qu'un portail de recrutement lit le mieux. Une colonne, intitulés de rubrique
 * soulignés, puces « - », une ligne vide entre les entrées. Fins de ligne `\n`.
 */
export function exportText(data: ProfileData, settings: Pick<CvSettings, 'locale' | 'anonymize'> & Partial<CvSettings>): string {
  return renderText(buildExportDoc(data, settings))
}

function blockLines(b: Block, sep: string): string[] {
  switch (b.kind) {
    case 'heading':
      return [b.level === 2 ? b.text : `> ${b.text}`]
    case 'meta':
    case 'paragraph':
      return [b.text]
    case 'bullets':
      return b.items.map((i) => `- ${i}`)
    case 'labelled':
      return [`${b.label}${sep}${b.text}`]
  }
}

export function renderText(doc: ExportDoc): string {
  const sep = doc.locale === 'en' ? ': ' : ' : '
  const out: string[] = []
  if (doc.name) out.push(doc.name)
  if (doc.headline) out.push(doc.headline)
  if (doc.contact.length) out.push(doc.contact.join(' | '))
  if (doc.details) out.push(doc.details)
  for (const s of doc.sections) {
    out.push('', s.title.toUpperCase(), '-'.repeat(Math.min(60, s.title.length)))
    s.blocks.forEach((b, i) => {
      // Une ligne vide avant chaque nouvelle entrée (sauf la première de la rubrique).
      if (b.kind === 'heading' && b.level === 2 && i > 0) out.push('')
      out.push(...blockLines(b, sep))
    })
  }
  return `${out.join('\n').trim()}\n`
}
