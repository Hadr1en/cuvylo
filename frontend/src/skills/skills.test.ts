import { describe, expect, it } from 'vitest'
import { emptyProfile, newExperience, newMission, type Experience, type ProfileData } from '@/domain/profile'
import { NOW, sampleProfileV2 } from '@/ats/testing'
import { formatDuration, formatYears, skillsMatrix, unionMonths } from './index'

const profile = (experiences: Experience[], extra: Partial<ProfileData> = {}): ProfileData => ({ ...emptyProfile(), experiences, ...extra })
const exp = (id: string, startDate: string, endDate: string | null, skills: string[], extra: Partial<Experience> = {}): Experience => ({
  ...newExperience(),
  id,
  title: `Poste ${id}`,
  company: `Société ${id}`,
  startDate,
  endDate: endDate ?? '',
  current: endDate === null,
  skills,
  ...extra,
})
const row = (data: ProfileData, skill: string) => skillsMatrix(data, NOW).find((r) => r.skill.toLowerCase() === skill.toLowerCase())

describe('unionMonths', () => {
  it('additionne sans compter deux fois les chevauchements', () => {
    expect(unionMonths([])).toBe(0)
    expect(unionMonths([{ start: 0, end: 11 }])).toBe(12)
    expect(unionMonths([{ start: 0, end: 11 }, { start: 6, end: 17 }])).toBe(18)
    expect(unionMonths([{ start: 0, end: 5 }, { start: 6, end: 11 }])).toBe(12)
    expect(unionMonths([{ start: 24, end: 35 }, { start: 0, end: 11 }])).toBe(24)
    expect(unionMonths([{ start: 0, end: 23 }, { start: 3, end: 5 }])).toBe(24)
  })
})

describe('skillsMatrix', () => {
  it('union des périodes : deux missions simultanées ne comptent pas double', () => {
    const d = profile([
      exp('esn', '2019-01', '2022-12', [], {
        missions: [
          { ...newMission(), id: 'm1', client: 'BNP', startDate: '2019-01', endDate: '2020-12', skills: ['CyberArk'] },
          { ...newMission(), id: 'm2', client: 'Sodexo', startDate: '2020-07', endDate: '2022-12', skills: ['CyberArk', 'Qualys'] },
        ],
      }),
    ])
    const r = row(d, 'CyberArk')!
    expect(r.months).toBe(48)
    expect([r.firstYear, r.lastYear, r.current]).toEqual([2019, 2022, false])
    expect(r.sources.map((s) => s.label)).toEqual(['BNP (Société esn)', 'Sodexo (Société esn)'])
    expect(row(d, 'Qualys')!.months).toBe(30)
  })

  it('compétence à la fois sur l’expérience et sur une de ses missions : pas de double compte', () => {
    const d = profile([exp('a', '2020-01', '2021-12', ['Python'], { missions: [{ ...newMission(), id: 'm', client: 'X', startDate: '2020-06', endDate: '2020-12', skills: ['python'] }] })])
    expect(row(d, 'Python')!.months).toBe(24)
    expect(row(d, 'Python')!.sources.map((s) => s.kind)).toEqual(['experience', 'mission'])
  })

  it('années seules (contrat §1.1) : janvier en début, décembre en fin', () => {
    const d = profile([exp('a', '2020', '2022', ['EBIOS RM'])])
    expect(row(d, 'EBIOS RM')).toMatchObject({ months: 36, firstYear: 2020, lastYear: 2022 })
  })

  it('période en cours : jusqu’au mois de `now`, compétence « actuelle »', () => {
    const d = profile([exp('a', '2025-01', null, ['Terraform'])])
    // janvier 2025 → octobre 2026 inclus
    expect(row(d, 'Terraform')).toMatchObject({ months: 22, current: true, firstYear: 2025, lastYear: 2026 })
    // Année seule en cours : de janvier 2026 à octobre 2026, pas jusqu'en décembre.
    expect(row(profile([exp('b', '2026', null, ['Go'])]), 'Go')!.months).toBe(10)
  })

  it('mission sans fin : `null` suit l’expérience en cours, "" est bornée par l’expérience', () => {
    const d = profile([
      exp('a', '2024-01', null, [], { missions: [{ ...newMission(), id: 'm', client: 'X', startDate: '2026-01', endDate: null, skills: ['Kubernetes'] }] }),
      exp('b', '2020-01', '2020-12', [], { missions: [{ ...newMission(), id: 'n', client: 'Y', startDate: '2020-07', endDate: '', skills: ['Ansible'] }] }),
    ])
    expect(row(d, 'Kubernetes')).toMatchObject({ months: 10, current: true })
    expect(row(d, 'Ansible')).toMatchObject({ months: 6, current: false })
  })

  it('regroupe les alias et la casse (« K8s » = « Kubernetes », « ISO27001 » = « ISO 27001 »)', () => {
    const d = profile([exp('a', '2021-01', '2021-12', ['K8s', 'ISO27001']), exp('b', '2019-01', '2019-12', ['kubernetes', 'ISO 27001'])])
    const rows = skillsMatrix(d, NOW)
    expect(rows.map((r) => [r.skill, r.months])).toEqual([
      ['ISO27001', 24],
      ['K8s', 24],
    ])
  })

  it('projets, dates futures ignorées, compétences déclarées sans période', () => {
    const d = profile([exp('a', '2027-01', null, ['Rust'])], {
      projects: [{ id: 'p', name: 'Guide', role: '', startDate: '2021', endDate: '', url: '', description: '', skills: ['Sensibilisation'] }],
      skills: [{ id: 's', category: 'Outils', kind: 'technical', items: ['Excel', 'Sensibilisation'] }],
    })
    expect(row(d, 'Sensibilisation')).toMatchObject({ months: 12, declared: true, sources: [{ kind: 'project', id: 'p', label: 'Guide' }] })
    expect(row(d, 'Rust')).toMatchObject({ months: 0, firstYear: null })
    expect(row(d, 'Excel')).toMatchObject({ months: 0, declared: true, sources: [] })
  })

  it('profil v2 d’exemple : tri par durée décroissante', () => {
    const rows = skillsMatrix(sampleProfileV2(), NOW)
    expect(rows.slice(0, 3).map((r) => [r.skill, r.months])).toEqual([
      ['Vulgarisation', 142], // janvier 2015 → octobre 2026, activité parallèle en cours
      ['Gestion de projet', 48],
      ['EBIOS RM', 37], // octobre 2023 → octobre 2026
    ])
    expect(row(sampleProfileV2(), 'Gestion des vulnérabilités')!.months).toBe(28)
    expect(row(sampleProfileV2(), 'CyberArk')).toMatchObject({ months: 10, firstYear: 2022, lastYear: 2023, declared: true })
    expect(row(sampleProfileV2(), 'EBIOS RM')).toMatchObject({ months: 37, current: true })
  })
})

describe('mise en forme', () => {
  it.each([
    [0, '—'],
    [8, '8 mois'],
    [12, '1 an'],
    [18, '1 an et 6 mois'],
    [48, '4 ans'],
    [142, '11 ans et 10 mois'],
  ])('%i mois → « %s »', (m, s) => {
    expect(formatDuration(m)).toBe(s)
  })

  it('anglais', () => {
    expect(formatDuration(18, 'en')).toBe('1 year 6 months')
    expect(formatYears({ firstYear: 2021, lastYear: 2026, current: true }, 'en')).toBe('since 2021')
  })

  it('années', () => {
    expect(formatYears({ firstYear: 2019, lastYear: 2023, current: false })).toBe('2019–2023')
    expect(formatYears({ firstYear: 2020, lastYear: 2020, current: false })).toBe('2020')
    expect(formatYears({ firstYear: 2021, lastYear: 2026, current: true })).toBe('depuis 2021')
    expect(formatYears({ firstYear: null, lastYear: null, current: false })).toBe('')
  })
})
