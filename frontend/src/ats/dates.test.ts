import { describe, expect, it } from 'vitest'
import { ctxFor, exp, runRule, withExperiences } from './testing'

const run = (id: string, list: ReturnType<typeof exp>[]) => runRule(id, ctxFor(withExperiences(list)))

describe('date-order', () => {
  it('erreur quand la fin précède le début', () => {
    const [i] = run('date-order', [{ ...exp('a', '2022-05', '2021-01') }])
    expect(i?.severity).toBe('error')
  })

  it('ignore un poste actuel et accepte début = fin', () => {
    expect(run('date-order', [exp('a', '2022-05', null), exp('b', '2020-01', '2020-01')])).toEqual([])
  })

  it('contrôle aussi les formations', () => {
    const d = withExperiences([])
    d.education = [{ id: 'e', degree: 'Master', school: 'U', location: '', startDate: '2020-09', endDate: '2019-06', description: '' }]
    expect(runRule('date-order', ctxFor(d))).toHaveLength(1)
  })
})

describe('future-dates', () => {
  it('avertit pour un début ou une fin dans le futur (aujourd’hui : octobre 2026)', () => {
    expect(run('future-dates', [exp('a', '2027-01', null)])).toHaveLength(1)
    expect(run('future-dates', [exp('a', '2025-01', '2027-03')])).toHaveLength(1)
  })

  it('accepte le mois courant et un poste actuel', () => {
    expect(run('future-dates', [exp('a', '2026-10', '2026-10'), exp('b', '2020-01', null)])).toEqual([])
  })

  it('avertit pour une certification datée dans le futur', () => {
    const d = withExperiences([])
    d.certifications = [{ id: 'c', name: 'X', issuer: 'Y', date: '2028-01', url: '' }]
    expect(runRule('future-dates', ctxFor(d))).toHaveLength(1)
  })
})

describe('chronology', () => {
  it('accepte l’ordre antéchronologique', () => {
    expect(run('chronology', [exp('a', '2022-01', null), exp('b', '2018-01', '2021-12')])).toEqual([])
  })

  it('avertit quand une expérience plus récente est listée après', () => {
    const [i] = run('chronology', [exp('a', '2018-01', '2021-12'), exp('b', '2022-01', null)])
    expect(i?.severity).toBe('warning')
    expect(i?.message).toContain('Poste a')
  })

  it('ignore les expériences sans date de début', () => {
    expect(run('chronology', [exp('a', '', ''), exp('b', '2022-01', null)])).toEqual([])
  })
})

describe('overlaps', () => {
  it('signale un chevauchement de plus de 3 mois, en nommant les deux postes', () => {
    const [i] = run('overlaps', [exp('a', '2020-01', '2022-06'), exp('b', '2021-01', '2023-01')])
    expect(i?.severity).toBe('info')
    expect(i?.message).toMatch(/Poste a.*Poste b/)
    expect(i?.message).toContain('17 mois')
  })

  it('tolère une transition courte et deux postes consécutifs', () => {
    expect(run('overlaps', [exp('a', '2020-01', '2021-03'), exp('b', '2021-01', '2023-01')])).toEqual([])
    expect(run('overlaps', [exp('a', '2021-03', null), exp('b', '2018-01', '2021-02')])).toEqual([])
  })

  it('tolère les missions parallèles par nature (freelance)', () => {
    expect(run('overlaps', [exp('a', '2011-01', '2026-10', { title: 'Journaliste freelance' }), exp('b', '2016-01', '2020-01')])).toEqual([])
  })

  it('compte un poste actuel jusqu’au mois courant', () => {
    expect(run('overlaps', [exp('a', '2025-01', null), exp('b', '2024-01', '2025-10')])).toHaveLength(1)
  })
})

describe('gaps', () => {
  it('signale plus de 6 mois sans expérience, avec la durée', () => {
    const [i] = run('gaps', [exp('b', '2021-01', null), exp('a', '2018-01', '2019-12')])
    expect(i?.severity).toBe('warning')
    expect(i?.message).toContain('12 mois')
  })

  it('tolère un trou de 6 mois ou moins', () => {
    expect(run('gaps', [exp('b', '2020-07', null), exp('a', '2018-01', '2019-12')])).toEqual([])
  })

  it('utilise la fin maximale courante : une longue mission parallèle comble le trou', () => {
    const list = [exp('c', '2023-01', null), exp('b', '2019-01', '2019-12'), exp('a', '2015-01', '2022-12')]
    expect(run('gaps', list)).toEqual([])
  })
})

describe('current-count', () => {
  it('info quand plusieurs postes sont actuels', () => {
    expect(run('current-count', [exp('a', '2024-01', null), exp('b', '2023-01', null)])).toHaveLength(1)
    expect(run('current-count', [exp('a', '2024-01', null)])).toEqual([])
  })
})
