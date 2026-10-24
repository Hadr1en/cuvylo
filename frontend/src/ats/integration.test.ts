// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { defaultSettings, type CvSettings } from '@/domain/cv'
import { analyzeCv, buildContext } from './index'
import { renderAndExtract, sampleProfile } from '@/test/pdf'
import { NOW } from './testing'

const TEMPLATES = ['classic', 'modern', 'compact'] as const
const settings = (template: CvSettings['template'], extra: Partial<CvSettings> = {}): CvSettings => ({ ...defaultSettings(), template, ...extra })

/** Analyse du VRAI PDF généré par react-pdf puis extrait par pdf.js. */
async function analyzeReal(template: CvSettings['template'], extra: Partial<CvSettings> = {}, data = sampleProfile()) {
  const s = settings(template, extra)
  const { extracted } = await renderAndExtract(data, s)
  return { extracted, report: analyzeCv(buildContext(data, s, extracted, NOW)) }
}

describe('analyse ATS sur de vrais PDF', () => {
  it.each(TEMPLATES)('modèle « %s » : aucune erreur ni avertissement sur le profil d’exemple', async (template) => {
    const { report } = await analyzeReal(template)
    expect(report.skipped).toBe(0)
    expect(report.issues.filter((i) => i.severity !== 'info')).toEqual([])
    expect(report.results.filter((r) => r.rule.category === 'pdf').every((r) => r.status === 'passed')).toBe(true)
  })

  it.each(TEMPLATES)('modèle « %s » : chaque titre est sur sa propre ligne extraite', async (template) => {
    const { extracted } = await analyzeReal(template)
    const lines = extracted.text.split('\n').map((l) => l.trim().toLowerCase())
    for (const h of ['profil', 'expérience professionnelle', 'compétences', 'formation', 'certifications', 'langues']) {
      expect(lines).toContain(h)
    }
  })

  it('signale la page quasi vide créée par un saut de page forcé', async () => {
    const { report, extracted } = await analyzeReal('classic', { pageBreakBefore: ['education'] })
    expect(extracted.pages).toBe(2)
    expect(report.issues.map((i) => i.ruleId)).toContain('pdf-sparse-pages')
  })

  it('signale coche et emoji saisis dans le profil (avertissement de lisibilité, sans PDF)', () => {
    const data = sampleProfile()
    data.summary = 'Chef de projet ✓ passionné 😀 par la sécurité.'
    const report = analyzeCv(buildContext(data, settings('classic'), null, NOW))
    const glyph = report.issues.find((i) => i.ruleId === 'unsupported-glyphs')
    expect(glyph?.severity).toBe('warning')
    expect(glyph?.message).toContain('✓')
  })
})
