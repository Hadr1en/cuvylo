import { describe, expect, it, vi } from 'vitest'
import { CATEGORY_ORDER, RULES, analyzeCv } from './index'
import { ctxFor, fakePdf, sampleProfile } from './testing'

describe('moteur d’analyse', () => {
  it('a des identifiants de règle uniques et couvre toutes les catégories', () => {
    const ids = RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(RULES.map((r) => r.category))).toEqual(new Set(CATEGORY_ORDER))
  })

  it('ignore les règles PDF sans PDF et compte les contrôles', () => {
    const r = analyzeCv(ctxFor())
    const pdfRules = RULES.filter((x) => x.needsPdf).length
    expect(r.skipped).toBe(pdfRules)
    expect(r.executed).toBe(RULES.length - pdfRules)
    expect(r.passed).toBe(r.executed)
    expect(r.results.filter((x) => x.status === 'skipped').every((x) => x.rule.category === 'pdf')).toBe(true)
  })

  it('trie les signalements par gravité et en compte chaque niveau', () => {
    const d = sampleProfile()
    d.identity.firstName = ''
    d.identity.phone = ''
    d.identity.location = ''
    const r = analyzeCv(ctxFor(d))
    expect(r.counts).toEqual({ error: 1, warning: 1, info: 1 })
    expect(r.issues.map((i) => i.severity)).toEqual(['error', 'warning', 'info'])
  })

  it('ne tombe pas si une règle lève une exception : elle est ignorée', () => {
    const spy = vi.spyOn(RULES[0]!, 'run').mockImplementation(() => {
      throw new Error('boom')
    })
    const r = analyzeCv(ctxFor())
    expect(r.results[0]?.status).toBe('skipped')
    expect(r.executed).toBe(RULES.length - RULES.filter((x) => x.needsPdf).length - 1)
    spy.mockRestore()
  })

  it('exécute les règles PDF dès qu’un texte est fourni', () => {
    const r = analyzeCv(ctxFor(sampleProfile(), { pdf: fakePdf(['']) }))
    expect(r.skipped).toBe(0)
    expect(r.issues.some((i) => i.ruleId === 'pdf-text-present')).toBe(true)
  })

  it('n’expose aucun score global de compatibilité', () => {
    const r = analyzeCv(ctxFor()) as unknown as Record<string, unknown>
    expect(Object.keys(r).sort()).toEqual(['counts', 'executed', 'issues', 'passed', 'results', 'skipped'])
  })
})
