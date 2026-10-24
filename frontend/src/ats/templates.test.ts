// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { TEMPLATES, defaultSettings } from '@/domain/cv'
import { renderAndExtract, sampleProfile } from '@/test/pdf'
import { analyzeCv, buildContext } from './index'
import { hasLetterSpacedText } from './text'
import { NOW } from './testing'

/**
 * Garde-fou : tout modèle ajouté au catalogue doit rester lisible par l'extraction (règles PDF sans avertissement).
 * Seule exception assumée : la barre latérale, lue hors de l'ordre affiché (voir le test dédié ci-dessous).
 */
describe('analyse ATS de chaque modèle du catalogue', () => {
  it('modèle « sidebar » : la colonne latérale est signalée comme lue hors ordre, et rien d’autre', async () => {
    const data = sampleProfile()
    const settings = { ...defaultSettings(), template: 'sidebar' as const }
    const { extracted } = await renderAndExtract(data, settings)
    const report = analyzeCv(buildContext(data, settings, extracted, NOW))
    const pdfProblems = report.results.filter((r) => r.rule.category === 'pdf' && r.status !== 'passed').map((r) => r.rule.id)
    expect(pdfProblems.filter((id) => id !== 'pdf-heading-order')).toEqual([])
    expect(report.issues.find((i) => i.ruleId === 'template-reading-order')?.fix).toMatch(/export ATS/)
  })

  it.each(TEMPLATES.filter((t) => t !== 'sidebar'))('modèle « %s » : texte extrait complet, rubriques dans l’ordre, aucune anomalie', async (template) => {
    const data = sampleProfile()
    const settings = { ...defaultSettings(), template }
    const { extracted } = await renderAndExtract(data, settings)
    const report = analyzeCv(buildContext(data, settings, extracted, NOW))
    const pdfProblems = report.results.filter((r) => r.rule.category === 'pdf' && r.status !== 'passed')
    // Le diagnostic inclut les lignes extraites suspectes pour identifier le titre fautif.
    const spacedLines = extracted.text.split('\n').filter((l) => hasLetterSpacedText(l))
    expect(pdfProblems.map((r) => ({ id: r.rule.id, issues: r.issues.map((i) => i.message), spacedLines }))).toEqual([])
  })
})
