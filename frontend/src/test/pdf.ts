import { resolve } from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createElement } from 'react'
import type { CvSettings } from '@/domain/cv'
import type { ProfileData } from '@/domain/profile'
import { CvDocument } from '@/pdf/CvDocument'
import { extractPdfText, type ExtractedPdf } from '@/pdf/extract'
import { FONT_FILES, registerFonts, type FontFiles } from '@/pdf/fonts'

/** Polices lues sur disque (tests Node) — les mêmes fichiers que le build navigateur. */
export function registerNodeFonts(): void {
  const dir = resolve(process.cwd(), 'src/pdf/fonts')
  registerFonts(Object.fromEntries(FONT_FILES.map((f) => [f, resolve(dir, `${f}.ttf`)])) as FontFiles)
}

export { sampleProfile } from './fixtures'

export async function renderPdf(data: ProfileData, settings: CvSettings, scale = 1): Promise<Uint8Array> {
  registerNodeFonts()
  const buffer = await renderToBuffer(createElement(CvDocument, { data, settings, scale }))
  return new Uint8Array(buffer)
}

export async function renderAndExtract(data: ProfileData, settings: CvSettings): Promise<{ bytes: Uint8Array; extracted: ExtractedPdf }> {
  const bytes = await renderPdf(data, settings)
  // pdf.js transfère le buffer : on lui donne une copie pour pouvoir garder `bytes`.
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 })
  try {
    return { bytes, extracted: await extractPdfText(await task.promise) }
  } finally {
    await task.destroy()
  }
}
