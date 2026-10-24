// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@/domain/cv'
import { renderAndExtract, sampleProfile } from '@/test/pdf'
import { normalize } from './text'

/**
 * Le modèle « Marge » place les titres à gauche, sur la même ligne que le début du contenu :
 * pdf.js les extrait donc « collés » au texte qui suit. C'est la raison pour laquelle le modèle
 * est annoncé comme moins sûr (`ats: 'medium'`). Ce test documente et verrouille ce comportement :
 * chaque titre reste au moins le DÉBUT d'une ligne extraite, jamais coupé ni dispersé.
 */
describe('modèle « Marge » (titres en colonne latérale)', () => {
  it('chaque titre de rubrique commence une ligne extraite, en un seul morceau', async () => {
    const { extracted } = await renderAndExtract(sampleProfile(), { ...defaultSettings(), template: 'margin' })
    const lines = extracted.text.split('\n').map(normalize)
    for (const heading of ['Profil', 'Expérience professionnelle', 'Compétences', 'Formation', 'Certifications', 'Langues']) {
      expect(lines.some((l) => l.startsWith(normalize(heading))), heading).toBe(true)
    }
    expect(extracted.pages).toBe(1)
  })
})
