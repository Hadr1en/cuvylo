import { expect, test } from '@playwright/test'
import { createCvViaApi, exportPdf, openTab, register, seedProfile, settlePreview, squash, waitForPreview } from './helpers'

/** Les 18 modèles du catalogue (libellés affichés dans l'onglet Mise en page). */
const TEMPLATES = [
  'Classique', 'Moderne', 'Compact', 'Éditorial', 'Marge', 'Dossier', 'Bandeau', 'Chronologie',
  'Consultant', 'Direction', 'Médias', 'Ingénierie', 'Académique', 'Européen', 'Grille', 'Encre', 'Barre latérale', 'Dossier de compétences',
] as const

test.describe('export PDF', () => {
  test('chacun des 18 modèles produit un PDF valide, une page, au texte extractible', async ({ page }, testInfo) => {
    test.setTimeout(480_000)
    await register(page)
    await seedProfile(page)
    const id = await createCvViaApi(page, 'CV modèles')
    await page.goto(`/cv/${id}`)
    await waitForPreview(page)
    await openTab(page, 'Modèle')

    for (const label of TEMPLATES) {
      // Le libellé est suivi de la description (majuscule) : « Dossier » ne prend pas « Dossier de compétences ».
      await page.locator('label').filter({ hasText: new RegExp(`^${label}\\p{Lu}`, 'u') }).first().click()
      await settlePreview(page)
      const { bytes, pdf } = await exportPdf(page, testInfo, `${label}.pdf`)

      expect(bytes.subarray(0, 5).toString('latin1'), label).toBe('%PDF-')
      expect(pdf.pages, `${label} : pages`).toBe(1)
      const text = squash(pdf.text)
      for (const expected of ['Camille Exemple', 'Expérience professionnelle', 'Société Fictive SA', 'camille.exemple@example.test', 'Professional Scrum Master I']) {
        expect(text, `${label} : « ${expected} »`).toContain(squash(expected))
      }
      expect(pdf.text, `${label} : texte espacé`).not.toMatch(/(?:^|\s)(?:\p{L}\s){5,}\p{L}(?:\s|$)/u)
      expect(pdf.text, `${label} : caractères de substitution`).not.toMatch(/[�ﬀ-ﬆ]/)
    }
  })

  test('le modèle choisi est bien celui du fichier exporté (nom en capitales pour « Dossier »)', async ({ page }, testInfo) => {
    await register(page)
    await seedProfile(page)
    await page.goto(`/cv/${await createCvViaApi(page, 'CV style')}`)
    await waitForPreview(page)

    const classic = await exportPdf(page, testInfo, 'classique.pdf')
    expect(classic.pdf.text).toContain('Camille Exemple')

    await openTab(page, 'Modèle')
    await page.locator('label').filter({ hasText: /^Dossier/ }).first().click()
    await settlePreview(page)
    const dossier = await exportPdf(page, testInfo, 'dossier.pdf')
    expect(dossier.pdf.text).toContain('CAMILLE EXEMPLE')
  })

  test('un saut de page forcé avant « Formation » ouvre une seconde page par cette rubrique', async ({ page }, testInfo) => {
    await register(page)
    await seedProfile(page)
    await page.goto(`/cv/${await createCvViaApi(page, 'CV sauts')}`)
    await waitForPreview(page)

    await openTab(page, 'Modèle')
    await page.getByRole('switch', { name: 'Formation', exact: true }).click()
    await settlePreview(page)
    await expect(page.getByText(/2 pages · /)).toBeVisible()

    const { pdf } = await exportPdf(page, testInfo, 'sauts.pdf')
    expect(pdf.pages).toBe(2)
    expect(pdf.pageTexts[0]).not.toContain('Formation')
    expect(pdf.pageTexts[1]).toMatch(/^Formation/)
  })

  test('masquer une rubrique la retire du PDF exporté', async ({ page }, testInfo) => {
    await register(page)
    await seedProfile(page)
    await page.goto(`/cv/${await createCvViaApi(page, 'CV masqué')}`)
    await waitForPreview(page)

    await page.getByRole('button', { name: 'Masquer la rubrique Certifications' }).click()
    await settlePreview(page)
    const { pdf } = await exportPdf(page, testInfo, 'masque.pdf')
    expect(pdf.text).not.toContain('Professional Scrum Master')
    expect(pdf.text).toContain('Expérience professionnelle')
  })

  test('réordonner les rubriques change l’ordre de lecture du PDF', async ({ page }, testInfo) => {
    await register(page)
    await seedProfile(page)
    await page.goto(`/cv/${await createCvViaApi(page, 'CV ordre')}`)
    await waitForPreview(page)

    // Compétences remonte au-dessus des expériences.
    await page.getByRole('button', { name: 'Monter la rubrique Compétences' }).click()
    await settlePreview(page)
    const { pdf } = await exportPdf(page, testInfo, 'ordre.pdf')
    const t = pdf.text
    expect(t.indexOf('Compétences')).toBeGreaterThanOrEqual(0)
    expect(t.indexOf('Compétences')).toBeLessThan(t.indexOf('Expérience professionnelle'))
  })
})
