// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { TEMPLATES, defaultSettings, type CvSettings } from '@/domain/cv'
import { newExperience, type ProfileData } from '@/domain/profile'
import { sampleProfileV2 } from '@/test/fixtures'
import { renderAndExtract, sampleProfile } from '@/test/pdf'

const withTemplate = (template: CvSettings['template']): CvSettings => ({ ...defaultSettings(), template })

/** Beaucoup d'expériences pour forcer plusieurs pages. */
function longProfile(count = 9): ProfileData {
  const base = sampleProfile()
  base.experiences = Array.from({ length: count }, (_, i) => ({
    ...newExperience(),
    id: `long${i}`,
    title: `Responsable programme ${i + 1}`,
    company: `Entreprise ${i + 1}`,
    startDate: '2015-01',
    endDate: '2016-01',
    description: 'Pilotage transverse de projets multi-sites avec des équipes internationales.',
    achievements: Array.from({ length: 5 }, (_, j) => ({
      id: `long${i}-${j}`,
      text: `Réalisation ${i + 1}.${j + 1} : réduction des délais et des coûts grâce à un cadrage rigoureux et à un suivi hebdomadaire.`,
    })),
  }))
  return base
}

describe('export PDF et extraction de texte', () => {
  it.each(TEMPLATES)('modèle « %s » : PDF valide, 1 page, texte extractible', async (template) => {
    const { bytes, extracted } = await renderAndExtract(sampleProfile(), withTemplate(template))

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(extracted.pages).toBe(1)

    // Comparaison sans espaces : en marge latérale (« margin »), un titre long passe à la ligne.
    const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '')
    const text = extracted.text
    for (const expected of [
      'Camille Exemple',
      'Cheffe de projet digital',
      'camille.exemple@example.test',
      'Expérience professionnelle',
      'Formation',
      'Compétences',
      'Société Fictive SA',
      'Refonte du site e-commerce',
      'Professional Scrum Master I',
    ]) {
      expect(squash(text)).toContain(squash(expected))
    }
  })

  it('conserve les accents et ne produit pas de caractères de substitution', async () => {
    const { extracted } = await renderAndExtract(sampleProfile(), defaultSettings())
    expect(extracted.text).toContain('é')
    expect(extracted.text).not.toMatch(/[�ﬀ-ﬆ]/) // pas de « ? » ni de ligatures non décomposées
  })

  it('extrait les rubriques dans l’ordre choisi', async () => {
    const data = sampleProfile()
    data.sections = [
      { key: 'skills', visible: true },
      { key: 'experiences', visible: true },
      { key: 'summary', visible: true },
      { key: 'education', visible: true },
      { key: 'certifications', visible: true },
      { key: 'languages', visible: true },
    ]
    const { extracted } = await renderAndExtract(data, defaultSettings())
    const t = extracted.text
    expect(t.indexOf('Compétences')).toBeLessThan(t.indexOf('Expérience professionnelle'))
    expect(t.indexOf('Expérience professionnelle')).toBeLessThan(t.indexOf('Profil'))
  })

  it('n’affiche pas une rubrique masquée', async () => {
    const data = sampleProfile()
    data.sections = data.sections.map((s) => (s.key === 'certifications' ? { ...s, visible: false } : s))
    const { extracted } = await renderAndExtract(data, defaultSettings())
    expect(extracted.text).not.toContain('Professional Scrum Master')
  })

  it('passe sur plusieurs pages quand le contenu est long', async () => {
    const { extracted } = await renderAndExtract(longProfile(), defaultSettings())
    expect(extracted.pages).toBeGreaterThanOrEqual(2)
  })

  it('force un saut de page avant la rubrique demandée', async () => {
    const settings: CvSettings = { ...defaultSettings(), pageBreakBefore: ['education'] }
    const { extracted } = await renderAndExtract(sampleProfile(), settings)
    expect(extracted.pages).toBe(2)
    expect(extracted.pageTexts[0]).not.toContain('Formation')
    expect(extracted.pageTexts[1]).toMatch(/^Formation/)
  })

  it('ne coupe pas une expérience entre deux pages quand « garder ensemble » est actif', async () => {
    const { extracted } = await renderAndExtract(longProfile(), { ...defaultSettings(), keepEntriesTogether: true })
    for (let i = 0; i < 9; i++) {
      const titlePage = extracted.pageTexts.findIndex((p) => p.includes(`Responsable programme ${i + 1}\n`) || p.includes(`Responsable programme ${i + 1} `))
      const lastBulletPage = extracted.pageTexts.findIndex((p) => p.includes(`Réalisation ${i + 1}.5`))
      expect(titlePage).toBeGreaterThanOrEqual(0)
      expect(lastBulletPage).toBe(titlePage)
    }
  })

  it.each(TEMPLATES)('modèle « %s » : contenu v2 complet (missions, projets, publications, rubrique libre)', async (template) => {
    const { extracted } = await renderAndExtract(sampleProfileV2(), withTemplate(template))
    const text = extracted.text.toLowerCase().replace(/\s+/g, '')
    for (const expected of ['Banque Fictive', 'Distributeur Exemple', 'Guide de sensibilisation', 'Prix du meilleur blog', 'Les rançongiciels expliqués', 'Bénévolat', 'Indépendante']) {
      expect(text, `${template} : ${expected}`).toContain(expected.toLowerCase().replace(/\s+/g, ''))
    }
    expect(extracted.text).not.toMatch(/[�]/)
  })

  it('anonymise : ni nom, ni coordonnées, ni liens dans le PDF', async () => {
    const data = sampleProfileV2()
    const { extracted } = await renderAndExtract(data, { ...withTemplate('skills-dossier'), anonymize: true })
    expect(extracted.text).not.toContain('Camille')
    expect(extracted.text).not.toContain('camille.exemple@example.test')
    expect(extracted.text).not.toContain('+33 6')
    expect(extracted.text).toContain('Dossier de compétences')
  })

  it('intitulés et dates en anglais', async () => {
    const { extracted } = await renderAndExtract(sampleProfileV2(), { ...defaultSettings(), locale: 'en' })
    expect(extracted.text).toContain('Professional Experience')
    expect(extracted.text).toMatch(/Present/)
    expect(extracted.text).not.toContain('Expérience professionnelle')
  })

  it('les caractères latins étendus sont imprimés (Ł, ř, ș, ő)', async () => {
    const data = sampleProfile()
    data.identity = { ...data.identity, firstName: 'Łukasz', lastName: 'Dvořák-Ștefănescu Kőváry' }
    const { extracted } = await renderAndExtract(data, defaultSettings())
    expect(extracted.text).toContain('Łukasz')
    expect(extracted.text).toContain('Dvořák-Ștefănescu')
    expect(extracted.text).toContain('Kőváry')
  })

  it('l’échelle réduite fait tenir un CV long sur moins de pages', async () => {
    const { renderPdf } = await import('@/test/pdf')
    const long = longProfile(6)
    const { extracted: full } = await renderAndExtract(long, defaultSettings())
    const small = await renderPdf(long, defaultSettings(), 0.84)
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = getDocument({ data: small, verbosity: 0 })
    const pages = (await task.promise).numPages
    await task.destroy()
    expect(pages).toBeLessThanOrEqual(full.pages)
  })

  it('ne génère aucun texte pour un profil vide', async () => {
    const { emptyProfile } = await import('@/domain/profile')
    const { extracted } = await renderAndExtract(emptyProfile(), defaultSettings())
    expect(extracted.pages).toBe(1)
    expect(extracted.text.trim()).toBe('')
  })
})
