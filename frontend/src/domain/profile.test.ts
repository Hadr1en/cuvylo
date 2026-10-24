import { describe, expect, it } from 'vitest'
import { formatMonth, formatPeriod } from './dates'
import { ProfileSchema, emptyProfile, moveItem, newExperience, profileCompleteness, sectionHasContent } from './profile'
import { sampleProfile } from '@/test/fixtures'

describe('ProfileSchema', () => {
  it('accepte le profil d’exemple partagé avec le backend', () => {
    expect(ProfileSchema.safeParse(sampleProfile()).success).toBe(true)
  })

  it('accepte un profil vide (autosauvegarde en cours de saisie)', () => {
    expect(ProfileSchema.safeParse(emptyProfile()).success).toBe(true)
  })

  it('rejette les champs inconnus', () => {
    expect(ProfileSchema.safeParse({ ...emptyProfile(), injected: true }).success).toBe(false)
  })

  it('rejette une URL qui n’est pas http(s)', () => {
    const p = emptyProfile()
    p.links = [{ id: 'a', label: 'x', url: 'javascript:alert(1)' }]
    expect(ProfileSchema.safeParse(p).success).toBe(false)
  })

  it('rejette un identifiant non sûr', () => {
    const p = emptyProfile()
    p.languages = [{ id: '../x', name: 'FR', level: '' }]
    expect(ProfileSchema.safeParse(p).success).toBe(false)
  })

  it('rejette une rubrique en double ou manquante', () => {
    const p = emptyProfile()
    p.sections = [...p.sections.slice(0, 5), { key: 'summary', visible: true }]
    expect(ProfileSchema.safeParse(p).success).toBe(false)
  })

  it('rejette un poste actuel qui a une date de fin', () => {
    const p = emptyProfile()
    p.experiences = [{ ...newExperience(), current: true, endDate: '2020-01' }]
    expect(ProfileSchema.safeParse(p).success).toBe(false)
  })

  it('rejette une date mal formée', () => {
    const p = emptyProfile()
    p.experiences = [{ ...newExperience(), startDate: '2020-13' }]
    expect(ProfileSchema.safeParse(p).success).toBe(false)
  })
})

describe('helpers du profil', () => {
  it('moveItem déplace sans muter', () => {
    const a = [1, 2, 3]
    expect(moveItem(a, 0, 2)).toEqual([2, 3, 1])
    expect(a).toEqual([1, 2, 3])
    expect(moveItem(a, 0, -1)).toEqual([1, 2, 3])
  })

  it('sectionHasContent ignore les entrées vides', () => {
    const p = emptyProfile()
    p.experiences = [newExperience()]
    expect(sectionHasContent(p, 'experiences')).toBe(false)
    p.experiences = [{ ...newExperience(), title: 'Dev' }]
    expect(sectionHasContent(p, 'experiences')).toBe(true)
  })

  it('profileCompleteness va de 0 à 1', () => {
    expect(profileCompleteness(emptyProfile())).toBe(0)
    expect(profileCompleteness(sampleProfile())).toBeGreaterThan(0.8)
  })
})

describe('dates', () => {
  it('formate les mois en français', () => {
    expect(formatMonth('2021-03')).toBe('mars 2021')
    expect(formatMonth('2021-13')).toBe('')
    expect(formatMonth('')).toBe('')
  })

  it('formate les périodes', () => {
    expect(formatPeriod('2021-03', null, true)).toBe('mars 2021 – Présent')
    expect(formatPeriod('2017-09', '2021-02', false)).toBe('septembre 2017 – février 2021')
    expect(formatPeriod('', null, false)).toBe('')
  })
})
