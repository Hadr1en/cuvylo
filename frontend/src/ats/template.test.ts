import { describe, expect, it } from 'vitest'
import { TEMPLATES, TEMPLATE_INFO, defaultSettings } from '@/domain/cv'
import { sampleProfile } from './testing'
import { analyzeCv, buildContext } from './index'

describe('règle « lecture linéaire du modèle »', () => {
  const issuesFor = (template: (typeof TEMPLATES)[number]) =>
    analyzeCv(buildContext(sampleProfile(), { ...defaultSettings(), template }, null)).issues.filter((i) => i.ruleId === 'template-reading-order')

  it.each(TEMPLATES.filter((t) => TEMPLATE_INFO[t].ats === 'high'))('« %s » : aucun signalement', (t) => {
    expect(issuesFor(t)).toEqual([])
  })

  it('signale, sans la bloquer, la mise en page à titres en marge', () => {
    const issues = issuesFor('margin')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('info')
    expect(issues[0]!.fix).toMatch(/une colonne/)
  })
})
