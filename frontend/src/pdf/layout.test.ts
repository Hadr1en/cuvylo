import { describe, expect, it } from 'vitest'
import { defaultSettings, type CvSettings } from '@/domain/cv'
import { emptyProfile, newExperience, type ProfileData } from '@/domain/profile'
import { MAX_UNBREAKABLE_LINES, estimateExperienceLines, planSections } from './layout'

function profileWith(partial: Partial<ProfileData>): ProfileData {
  return { ...emptyProfile(), ...partial }
}

function exp(id: string, achievements = 2) {
  return {
    ...newExperience(),
    id,
    title: `Poste ${id}`,
    company: 'ACME',
    achievements: Array.from({ length: achievements }, (_, i) => ({ id: `${id}-${i}`, text: 'Résultat mesurable.' })),
  }
}

describe('planSections', () => {
  it('ignore les rubriques masquées et vides', () => {
    const data = profileWith({ summary: 'Bonjour', experiences: [exp('a')] })
    data.sections = data.sections.map((s) => (s.key === 'summary' ? { ...s, visible: false } : s))
    const plan = planSections(data, defaultSettings())
    expect(plan.map((s) => s.key)).toEqual(['experiences'])
  })

  it('respecte l’ordre choisi par l’utilisateur', () => {
    const data = profileWith({
      summary: 'Bonjour',
      experiences: [exp('a')],
      languages: [{ id: 'l1', name: 'Français', level: '' }],
    })
    data.sections = [
      { key: 'languages', visible: true },
      { key: 'experiences', visible: true },
      { key: 'summary', visible: true },
      { key: 'skills', visible: true },
      { key: 'education', visible: true },
      { key: 'certifications', visible: true },
    ]
    expect(planSections(data, defaultSettings()).map((s) => s.key)).toEqual(['languages', 'experiences', 'summary'])
  })

  it('applique un saut de page avant la rubrique demandée, sauf pour la première', () => {
    const data = profileWith({ summary: 'Bonjour', experiences: [exp('a')] })
    const settings: CvSettings = { ...defaultSettings(), pageBreakBefore: ['summary', 'experiences'] }
    const plan = planSections(data, settings)
    expect(plan.find((s) => s.key === 'summary')?.breakBefore).toBe(false)
    expect(plan.find((s) => s.key === 'experiences')?.breakBefore).toBe(true)
  })

  it('rend les expériences insécables seulement si elles tiennent sur une page', () => {
    const data = profileWith({ experiences: [exp('court', 3), exp('long', 40)] })
    const plan = planSections(data, defaultSettings())
    const entries = plan[0]!.entries
    expect(entries.find((e) => e.id === 'court')?.keepTogether).toBe(true)
    expect(entries.find((e) => e.id === 'long')?.keepTogether).toBe(false)
  })

  it('ne rend rien d’insécable quand le réglage est désactivé', () => {
    const data = profileWith({ experiences: [exp('a', 2)] })
    const plan = planSections(data, { ...defaultSettings(), keepEntriesTogether: false })
    expect(plan[0]!.entries.every((e) => !e.keepTogether)).toBe(true)
  })

  it('utilise les intitulés standards attendus par les analyseurs', () => {
    const data = profileWith({ summary: 'x', experiences: [exp('a')] })
    expect(planSections(data, defaultSettings()).map((s) => s.title)).toEqual(['Profil', 'Expérience professionnelle'])
  })
})

describe('estimateExperienceLines', () => {
  it('croît avec le nombre et la longueur des réalisations', () => {
    expect(estimateExperienceLines(exp('a', 10))).toBeGreaterThan(estimateExperienceLines(exp('a', 2)))
    const long = { ...exp('a', 1), achievements: [{ id: 'x', text: 'mot '.repeat(120) }] }
    expect(estimateExperienceLines(long)).toBeGreaterThan(estimateExperienceLines(exp('a', 1)))
  })

  it('reste sous le seuil pour une expérience ordinaire', () => {
    expect(estimateExperienceLines(exp('a', 5))).toBeLessThan(MAX_UNBREAKABLE_LINES)
  })
})
