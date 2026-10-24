// @vitest-environment node
// Conservé (au lieu d'un fichier de sondage jetable) : vérifie que l'extracteur ne sépare pas
// les lettres des mots dans les 3 modèles de base. Nom historique, voir integration.test.ts pour le reste.
import { expect, it } from 'vitest'
import { defaultSettings } from '@/domain/cv'
import { renderAndExtract, sampleProfile } from '@/test/pdf'
import { hasLetterSpacedText } from './text'

it('aucun texte espacé lettre par lettre dans les modèles de base', async () => {
  for (const template of ['classic', 'modern', 'compact'] as const) {
    const { extracted } = await renderAndExtract(sampleProfile(), { ...defaultSettings(), template })
    expect(hasLetterSpacedText(extracted.text)).toBe(false)
  }
})
