import { describe, expect, it } from 'vitest'
import { TEMPLATES, TEMPLATE_INFO, contrastRatio, defaultSettings, ACCENT_PRESETS } from '@/domain/cv'
import { MIN_SCALE, themeFor } from './themes'

describe('thèmes de modèles', () => {
  it.each(TEMPLATES)('« %s » : interlettrage assez faible pour une extraction propre', (template) => {
    const t = themeFor({ ...defaultSettings(), template })
    // Au-delà d'environ 0,1 em, pdf.js extrait « e x p é r i e n c e » : on garde une marge.
    expect(t.sectionTitleTracking / t.sectionTitleSize).toBeLessThanOrEqual(0.08)
  })

  it('chaque modèle est décrit et annonce sa lisibilité attendue', () => {
    for (const t of TEMPLATES) {
      expect(TEMPLATE_INFO[t].label).toBeTruthy()
      expect(['high', 'medium']).toContain(TEMPLATE_INFO[t].ats)
    }
  })

  it('seuls les modèles à deux colonnes sont signalés comme moins sûrs', () => {
    expect(TEMPLATES.filter((t) => TEMPLATE_INFO[t].ats === 'medium')).toEqual(['margin', 'sidebar'])
  })

  it('une paire typographique remplace les polices du modèle, avec des graisses embarquées', () => {
    const t = themeFor({ ...defaultSettings(), template: 'editorial', fontPair: 'plex' })
    expect(t.headingFont).toBe('IBM Plex Sans')
    expect(t.bodyFont).toBe('IBM Plex Sans')
    expect([400, 500, 600, 700]).toContain(t.headingWeight)
  })

  it('l’ajustement réduit les tailles sans descendre sous le plancher de lisibilité', () => {
    const base = themeFor(defaultSettings())
    const fit = themeFor(defaultSettings(), 0.5)
    expect(fit.body).toBeLessThan(base.body)
    expect(fit.body).toBeGreaterThanOrEqual(+(base.body * MIN_SCALE).toFixed(2))
  })

  it('la densité resserrée réduit corps et espacements', () => {
    const a = themeFor({ ...defaultSettings(), density: 'comfortable' })
    const b = themeFor({ ...defaultSettings(), density: 'compact' })
    expect(b.body).toBeLessThan(a.body)
    expect(b.sectionGap).toBeLessThan(a.sectionGap)
  })
})

describe('contrastRatio', () => {
  it('vaut 21 entre noir et blanc et 1 pour deux couleurs identiques', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5)
  })

  it('toutes les couleurs proposées sont lisibles sur fond blanc (≥ 4,5)', () => {
    for (const c of ACCENT_PRESETS) expect(contrastRatio(c.value, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})
