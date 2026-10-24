import { describe, expect, it } from 'vitest'
import { emptyProfile, newCertification, newEducation, newLanguage, newLink } from '@/domain/profile'
import { ctxFor, exp, runRule, sampleProfile, withExperiences } from './testing'

describe('règles de contenu — profil d’exemple', () => {
  it('ne produit aucun signalement hors PDF sur le profil d’exemple', async () => {
    const { analyzeCv } = await import('./index')
    const report = analyzeCv(ctxFor())
    expect(report.issues).toEqual([])
    expect(report.skipped).toBeGreaterThan(0) // règles PDF ignorées sans PDF
  })
})

describe('rubriques essentielles', () => {
  it('signale l’absence de nom', () => {
    const d = sampleProfile()
    d.identity.firstName = ''
    expect(runRule('identity-name', ctxFor(d))).toMatchObject([{ severity: 'error' }])
  })

  it('distingue e-mail absent et e-mail invalide (tous deux bloquants)', () => {
    const d = sampleProfile()
    d.identity.email = ''
    expect(runRule('contact-email', ctxFor(d))[0]?.message).toContain('Aucune adresse')
    d.identity.email = 'pas-un-mail'
    const [issue] = runRule('contact-email', ctxFor(d))
    expect(issue?.severity).toBe('error')
    expect(issue?.message).toContain('pas-un-mail')
  })

  it('avertit pour un téléphone absent ou implausible, accepte un format usuel', () => {
    const d = sampleProfile()
    d.identity.phone = ''
    expect(runRule('contact-phone', ctxFor(d))).toHaveLength(1)
    d.identity.phone = 'appelez-moi'
    expect(runRule('contact-phone', ctxFor(d))).toHaveLength(1)
    d.identity.phone = '+33 6 12 34 56 78'
    expect(runRule('contact-phone', ctxFor(d))).toEqual([])
  })

  it('explique qu’une rubrique remplie est masquée plutôt que vide', () => {
    const d = sampleProfile()
    d.sections = d.sections.map((s) => (s.key === 'experiences' ? { ...s, visible: false } : s))
    const [issue] = runRule('section-experiences', ctxFor(d))
    expect(issue?.severity).toBe('error')
    expect(issue?.message).toContain('masquée')
  })

  it('signale une rubrique réellement vide', () => {
    const d = { ...sampleProfile(), experiences: [] }
    const [issue] = runRule('section-experiences', ctxFor(d))
    expect(issue?.message).toContain('Aucune expérience')
  })

  it('gradue la gravité : formation et compétences en avertissement, résumé en info', () => {
    const c = ctxFor(emptyProfile())
    expect(runRule('section-education', c)[0]?.severity).toBe('warning')
    expect(runRule('section-skills', c)[0]?.severity).toBe('warning')
    expect(runRule('section-summary', c)[0]?.severity).toBe('info')
  })
})

describe('informations manquantes', () => {
  it('liste ce qui manque à une expérience', () => {
    const d = withExperiences([{ ...exp('a', '', '', { company: '' }), current: false }])
    const [issue] = runRule('experience-fields', ctxFor(d))
    expect(issue?.message).toMatch(/l’entreprise.*date de début.*date de fin/)
  })

  it('accepte un poste actuel sans date de fin', () => {
    expect(runRule('experience-fields', ctxFor(withExperiences([exp('a', '2024-01', null)])))).toEqual([])
  })

  it('signale une expérience sans description ni réalisation', () => {
    const d = withExperiences([exp('a', '2024-01', null, { description: '', achievements: [] })])
    expect(runRule('experience-substance', ctxFor(d))).toHaveLength(1)
  })

  it('signale l’absence de chiffre sans exiger d’en inventer', () => {
    const d = withExperiences([
      exp('a', '2024-01', null, { achievements: [{ id: 'x', text: 'Pilotage des audits' }, { id: 'y', text: 'Rédaction de plans d’actions' }] }),
    ])
    const [issue] = runRule('achievements-measurable', ctxFor(d))
    expect(issue?.severity).toBe('info')
    expect(issue?.fix).toContain('N’inventez aucun chiffre')
  })

  it('formation incomplète, liens, certifications et langues', () => {
    const d = sampleProfile()
    d.education = [{ ...newEducation(), degree: 'Master' }]
    d.links = [{ ...newLink(), label: 'Site' }, { ...newLink(), url: 'https://x.test' }, newLink()]
    d.certifications = [{ ...newCertification(), name: 'ITIL' }]
    d.languages = [{ ...newLanguage(), name: 'Anglais' }]
    const c = ctxFor(d)
    expect(runRule('education-fields', c)).toHaveLength(1)
    expect(runRule('links-complete', c)).toHaveLength(3)
    expect(runRule('certifications-complete', c)).toHaveLength(1)
    expect(runRule('languages-level', c)).toHaveLength(1)
  })

  it('résumé trop court ou trop long, peu de compétences', () => {
    const d = sampleProfile()
    d.summary = 'Court.'
    expect(runRule('summary-length', ctxFor(d))[0]?.severity).toBe('info')
    d.summary = 'x'.repeat(1000)
    expect(runRule('summary-length', ctxFor(d))[0]?.severity).toBe('warning')
    d.skills = [{ id: 's', category: 'Outils', kind: 'technical', items: ['A', 'B'] }]
    expect(runRule('skills-volume', ctxFor(d))).toHaveLength(1)
  })
})

describe('éléments susceptibles de perturber', () => {
  it('signale coche et emoji non dessinables par les polices', () => {
    const d = sampleProfile()
    d.summary = 'Chef de projet ✓ passionné 😀 par la sécurité.'
    const issues = runRule('unsupported-glyphs', ctxFor(d))
    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.message).toContain('✓')
    expect(issues[0]?.section).toBe('summary')
  })

  it('accepte accents, œ, €, guillemets et tirets typographiques', () => {
    const d = sampleProfile()
    d.summary = 'Œuvre « complète » — budget 12 000 € – déjà là, naïf, Ça va.'
    expect(runRule('unsupported-glyphs', ctxFor(d))).toEqual([])
  })

  it('détecte puces manuelles, majuscules, blocs longs et titre trop long', () => {
    const d = sampleProfile()
    d.experiences[0]!.achievements = [{ id: 'z', text: '- Une puce saisie à la main' }]
    d.experiences[0]!.description = 'x'.repeat(650)
    d.experiences[1]!.title = 'CHEF DE PROJETS SECURITE'
    d.identity.headline = 'h'.repeat(95)
    const c = ctxFor(d)
    expect(runRule('manual-bullets', c)).toHaveLength(1)
    expect(runRule('all-caps', c)).toHaveLength(1)
    expect(runRule('long-blocks', c)).toHaveLength(1)
    expect(runRule('headline-length', c)).toHaveLength(1)
  })
})

describe('structure', () => {
  it('signale les rubriques remplies mais masquées', () => {
    const d = sampleProfile()
    d.sections = d.sections.map((s) => (s.key === 'languages' ? { ...s, visible: false } : s))
    expect(runRule('hidden-sections', ctxFor(d))).toHaveLength(1)
  })

  it('signale un saut de page demandé avant une rubrique absente, et un CV vide', () => {
    const d = sampleProfile()
    d.sections = d.sections.map((s) => (s.key === 'education' ? { ...s, visible: false } : s))
    const issues = runRule('forced-breaks', ctxFor(d, { settings: { pageBreakBefore: ['education'] } }))
    expect(issues).toHaveLength(1)
    expect(issues[0]?.section).toBe('education')
    expect(runRule('forced-breaks', ctxFor(emptyProfile()))).toHaveLength(1)
  })
})
