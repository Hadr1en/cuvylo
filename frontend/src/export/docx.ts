import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import type { CvSettings } from '@/domain/cv'
import type { ProfileData } from '@/domain/profile'
import { buildExportDoc, type Block, type ExportDoc } from './model'

/**
 * Export Word (.docx) pensé pour les ATS et les ESN : une seule colonne, vrais styles de titres
 * (Titre 1 pour les rubriques, Titre 2 pour les postes, Titre 3 pour les missions), listes à puces
 * natives, aucun tableau, aucune zone de texte, aucun en-tête de page (souvent ignorés par les analyseurs).
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const FONT = 'Calibri'

function blockParagraphs(b: Block, sep: string): Paragraph[] {
  switch (b.kind) {
    case 'heading':
      return [new Paragraph({ text: b.text, heading: b.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, keepNext: true })]
    case 'meta':
      return [new Paragraph({ children: [new TextRun({ text: b.text, italics: true, color: '555555' })], keepNext: true })]
    case 'paragraph':
      return [new Paragraph({ text: b.text })]
    case 'bullets':
      return b.items.map((text) => new Paragraph({ text, bullet: { level: 0 } }))
    case 'labelled':
      return [new Paragraph({ children: [new TextRun({ text: `${b.label}${sep}`, bold: true }), new TextRun({ text: b.text })] })]
  }
}

export function docxDocument(doc: ExportDoc): Document {
  const sep = doc.locale === 'en' ? ': ' : ' : '
  const children: Paragraph[] = []
  if (doc.name) children.push(new Paragraph({ text: doc.name, heading: HeadingLevel.TITLE }))
  if (doc.headline) children.push(new Paragraph({ children: [new TextRun({ text: doc.headline, bold: true, size: 26 })] }))
  if (doc.contact.length) children.push(new Paragraph({ text: doc.contact.join(' | ') }))
  if (doc.details) children.push(new Paragraph({ text: doc.details }))
  for (const s of doc.sections) {
    children.push(new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_1, keepNext: true, spacing: { before: 240 } }))
    for (const b of s.blocks) children.push(...blockParagraphs(b, sep))
  }
  const lang = doc.locale === 'en' ? 'en-GB' : 'fr-FR'
  return new Document({
    creator: 'Cuvylo',
    title: doc.name ? `CV — ${doc.name}` : 'CV',
    description: doc.headline,
    styles: {
      default: {
        document: { run: { font: FONT, size: 21, language: { value: lang } }, paragraph: { spacing: { after: 60 } } },
        heading1: { run: { font: FONT, size: 26, bold: true, color: '1F3A5F', allCaps: false }, paragraph: { spacing: { before: 240, after: 80 } } },
        heading2: { run: { font: FONT, size: 22, bold: true, color: '222222' }, paragraph: { spacing: { before: 160, after: 20 } } },
        heading3: { run: { font: FONT, size: 21, bold: true, color: '333333' }, paragraph: { spacing: { before: 100, after: 20 } } },
        title: { run: { font: FONT, size: 40, bold: true, color: '111111' }, paragraph: { alignment: AlignmentType.LEFT, spacing: { after: 40 } } },
      },
    },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }],
  })
}

/** Octets du fichier .docx (tests, envoi direct). */
export async function buildDocx(data: ProfileData, settings: Pick<CvSettings, 'locale' | 'anonymize'> & Partial<CvSettings>): Promise<Uint8Array> {
  return Packer.pack(docxDocument(buildExportDoc(data, settings)), 'uint8array')
}

/** Fichier Word prêt à télécharger. */
export async function exportDocx(data: ProfileData, settings: CvSettings): Promise<Blob> {
  const bytes = await buildDocx(data, settings)
  return new Blob([bytes as BlobPart], { type: DOCX_MIME })
}
