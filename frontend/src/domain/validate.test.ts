import { describe, expect, it } from 'vitest'
import { sampleProfileV2 } from '@/test/fixtures'
import { describeIssuePath, validateProfile } from './validate'

describe('validation locale du profil', () => {
  it('un profil v2 complet est valide', () => {
    expect(validateProfile(sampleProfileV2())).toEqual([])
  })

  it('localise une URL invalide et une date impossible, avec des messages lisibles', () => {
    const p = sampleProfileV2()
    p.links[0] = { ...p.links[0]!, url: 'linkedin.com/in/x' }
    p.experiences[0] = { ...p.experiences[0]!, startDate: '2021-13' }
    const issues = validateProfile(p)
    const url = issues.find((i) => i.path === 'links.0.url')
    const date = issues.find((i) => i.path === 'experiences.0.startDate')
    expect(url?.message).toMatch(/https:\/\//)
    expect(date?.message).toBe('Date invalide : AAAA ou AAAA-MM.')
    expect(describeIssuePath(p, 'experiences.0.startDate')).toBe(`Expériences › ${p.experiences[0]!.title} › Début`)
    expect(describeIssuePath(p, 'identity.email')).toBe('Identité › E-mail')
  })

  it('signale une fin antérieure au début sur l’élément concerné', () => {
    const p = sampleProfileV2()
    p.education[0] = { ...p.education[0]!, startDate: '2020', endDate: '2018' }
    expect(validateProfile(p).map((i) => i.path)).toContain('education.0.endDate')
  })
})
