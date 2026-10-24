import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface ExtractedPdf {
  pages: number
  /** Texte de chaque page, dans l'ordre de lecture rendu par l'extracteur. */
  pageTexts: string[]
  text: string
}

/**
 * Extrait le texte d'un PDF avec pdf.js — le moteur utilisé pour l'aperçu.
 * C'est une approximation de ce que lit un ATS, pas une garantie : chaque
 * éditeur a son propre extracteur.
 */
export async function extractPdfText(doc: PDFDocumentProxy): Promise<ExtractedPdf> {
  const pageTexts: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    let out = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      out += item.str
      out += item.hasEOL ? '\n' : ' '
    }
    pageTexts.push(out.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim())
  }
  return { pages: doc.numPages, pageTexts, text: pageTexts.join('\n\n') }
}
