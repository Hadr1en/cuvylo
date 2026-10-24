// @vitest-environment node
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { defaultSettings, type CvSettings } from '@/domain/cv'
import { CV_HEADINGS } from '@/pdf/layout'
import { sampleProfileV2 } from '@/ats/testing'
import { buildDocx, DOCX_MIME, exportDocx } from './docx'
import { buildExportDoc } from './model'
import { exportText } from './text'

const settings = (over: Partial<CvSettings> = {}): CvSettings => ({ ...defaultSettings(), ...over })

/** Texte visible de word/document.xml, paragraphe par paragraphe, avec le style de chacun. */
function docxParagraphs(bytes: Uint8Array): { style: string; bullet: boolean; text: string }[] {
  const files = unzipSync(bytes)
  const xml = strFromU8(files['word/document.xml']!)
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => {
    const p = m[0]
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? ''
    const text = [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('')
    return { style, bullet: p.includes('<w:numPr>'), text: text.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"') }
  })
}

describe('modèle d’export', () => {
  it('suit le plan du PDF : rubriques visibles, ordre, intitulés localisés', () => {
    const fr = buildExportDoc(sampleProfileV2(), settings())
    expect(fr.sections.map((s) => s.title)).toEqual([
      ...(['summary', 'experiences', 'skills', 'education', 'certifications', 'languages', 'projects', 'awards', 'publications', 'interests'] as const).map((k) => CV_HEADINGS.fr[k]),
      'Bénévolat',
    ])
    const en = buildExportDoc(sampleProfileV2(), settings({ locale: 'en' }))
    expect(en.sections[1]!.title).toBe(CV_HEADINGS.en.experiences)
    const d = sampleProfileV2()
    d.sections = d.sections.map((s) => (s.key === 'awards' ? { ...s, visible: false } : s))
    expect(buildExportDoc(d, settings()).sections.some((s) => s.id === 'awards')).toBe(false)
  })

  it('missions en sous-blocs avec leur environnement technique', () => {
    const exp = buildExportDoc(sampleProfileV2(), settings()).sections.find((s) => s.id === 'experiences')!
    expect(exp.blocks).toContainEqual({ kind: 'heading', level: 3, text: 'Banque Fictive — Cheffe de projet PAM' })
    expect(exp.blocks).toContainEqual({ kind: 'meta', text: 'mai 2022 – février 2023 · Paris' })
    expect(exp.blocks).toContainEqual({ kind: 'labelled', label: 'Environnement', text: 'CyberArk, Active Directory' })
    expect(exp.blocks).toContainEqual({ kind: 'meta', text: '2015 – Présent · en parallèle' })
  })

  it('anonymisation : initiales, ni coordonnées ni liens', () => {
    const doc = buildExportDoc(sampleProfileV2(), settings({ anonymize: true }))
    expect(doc.name).toBe('C. E.')
    expect(doc.contact).toEqual(['Lille, France'])
    expect(doc.details).toBe('')
  })
})

describe('exportText', () => {
  const text = exportText(sampleProfileV2(), settings())

  it('en-tête lisible, rubriques soulignées, puces simples', () => {
    expect(text.startsWith('Camille Exemple\nCheffe de projet cybersécurité\ncamille.exemple@example.test | +33 6 00 00 00 00 | Lille, France | linkedin.com/in/camille-exemple\nPermis B · Mobilité Hauts-de-France\n')).toBe(true)
    expect(text).toContain('\nEXPÉRIENCE PROFESSIONNELLE\n--------------------------\nCheffe de projet sécurité — Aéroport Fictif\nmars 2023'.replace('mars 2023', 'octobre 2023'))
    expect(text).toContain('- Pilotage de 12 homologations en 18 mois.')
    expect(text).toContain('> Banque Fictive — Cheffe de projet PAM')
    expect(text).toContain('Cybersécurité : EBIOS RM, CyberArk, Qualys, ISO 27001')
    expect(text).toContain('Anglais : Courant (C1)')
    expect(text).toContain('Les rançongiciels expliqués — Magazine Fictif, mars 2022, Article')
    expect(text.endsWith('Ateliers de sécurité numérique pour seniors.\n')).toBe(true)
  })

  it('ordre de lecture = ordre des rubriques', () => {
    const order = ['PROFIL', 'EXPÉRIENCE PROFESSIONNELLE', 'COMPÉTENCES', 'FORMATION', 'CERTIFICATIONS', 'LANGUES', 'PROJETS', 'DISTINCTIONS', 'PUBLICATIONS', 'CENTRES D’INTÉRÊT', 'BÉNÉVOLAT']
    const idx = order.map((h) => text.indexOf(`\n${h}\n`))
    expect(idx.every((i) => i > 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })

  it('anglais : intitulés, mois et « Present »', () => {
    const en = exportText(sampleProfileV2(), settings({ locale: 'en' }))
    expect(en).toContain('PROFESSIONAL EXPERIENCE')
    expect(en).toContain('October 2023 – Present · Lille')
    expect(en).toContain('Environment: CyberArk, Active Directory')
  })

  it('anonymisé : aucune donnée de contact', () => {
    const anon = exportText(sampleProfileV2(), settings({ anonymize: true }))
    for (const s of ['Camille', 'camille.exemple', '+33', 'linkedin', 'Permis B']) expect(anon).not.toContain(s)
    expect(anon.startsWith('C. E.\n')).toBe(true)
  })
})

describe('exportDocx', () => {
  it('fichier Word valide : vrais titres, puces natives, une seule colonne', async () => {
    const bytes = await buildDocx(sampleProfileV2(), settings())
    expect(strFromU8(bytes.slice(0, 2))).toBe('PK')
    const files = unzipSync(bytes)
    expect(Object.keys(files)).toContain('word/document.xml')
    const xml = strFromU8(files['word/document.xml']!)
    expect(xml).not.toContain('<w:tbl>') // aucun tableau
    expect(xml).not.toContain('<w:txbxContent') // aucune zone de texte
    const paras = docxParagraphs(bytes)
    expect(paras[0]).toMatchObject({ style: 'Title', text: 'Camille Exemple' })
    const h1 = paras.filter((p) => p.style === 'Heading1').map((p) => p.text)
    expect(h1).toEqual(['Profil', 'Expérience professionnelle', 'Compétences', 'Formation', 'Certifications', 'Langues', 'Projets', 'Distinctions', 'Publications', 'Centres d’intérêt', 'Bénévolat'])
    expect(paras.filter((p) => p.style === 'Heading2').map((p) => p.text)).toContain('Consultante cybersécurité — Cabinet Imaginaire')
    expect(paras.filter((p) => p.style === 'Heading3').map((p) => p.text)).toEqual(['Banque Fictive — Cheffe de projet PAM', 'Distributeur Exemple — Consultante vulnérabilités'])
    expect(paras.find((p) => p.text === 'Pilotage de 12 homologations en 18 mois.')?.bullet).toBe(true)
    expect(paras.find((p) => p.text === 'Environnement : CyberArk, Active Directory')).toBeDefined()
  })

  it('métadonnées Cuvylo et langue du document', async () => {
    const files = unzipSync(await buildDocx(sampleProfileV2(), settings({ locale: 'en' })))
    expect(strFromU8(files['docProps/core.xml']!)).toContain('Cuvylo')
    expect(strFromU8(files['word/styles.xml']!)).toContain('en-GB')
    expect(docxParagraphs(await buildDocx(sampleProfileV2(), settings({ locale: 'en' }))).filter((p) => p.style === 'Heading1')[1]!.text).toBe('Professional Experience')
  })

  it('anonymisé : ni nom complet ni coordonnées', async () => {
    const xml = strFromU8(unzipSync(await buildDocx(sampleProfileV2(), settings({ anonymize: true })))['word/document.xml']!)
    for (const s of ['Camille', 'camille.exemple', '+33 6']) expect(xml).not.toContain(s)
  })

  it('renvoie un Blob au bon type MIME', async () => {
    const blob = await exportDocx(sampleProfileV2(), settings())
    expect(blob.type).toBe(DOCX_MIME)
    expect(blob.size).toBeGreaterThan(3000)
  })
})
