import { expect, test } from '@playwright/test'
import { createCvViaApi, exportPdf, openTab, register, seedProfile, squash, waitForPreview, waitSaved } from './helpers'

test('parcours principal : inscription → profil → CV → export PDF', async ({ page }, testInfo) => {
  await register(page, { name: 'Camille' })

  // Un compte neuf n'a qu'un profil quasi vide (seul l'e-mail du compte est prérempli).
  await expect(page.getByRole('progressbar', { name: 'Profil principal' })).toHaveAttribute('aria-valuenow', '10')

  // 1. Renseigner le profil (autosauvegarde, vrai serveur PHP + MySQL).
  await page.getByRole('navigation', { name: 'Principale' }).getByRole('link', { name: 'Profil' }).click()
  await page.getByLabel('Prénom', { exact: true }).fill('Camille')
  await page.getByLabel('Nom', { exact: true }).fill('Exemple')
  await page.getByLabel('Titre professionnel').fill('Cheffe de projet digital')
  await page.getByLabel('E-mail', { exact: true }).fill('camille@example.test')

  const experiences = page.getByRole('region', { name: 'Expériences' })
  await experiences.getByRole('button', { name: 'Ajouter une expérience' }).click()
  await experiences.getByLabel('Intitulé du poste').fill('Cheffe de projet senior')
  await experiences.getByLabel('Entreprise').fill('Société Fictive SA')
  await experiences.getByLabel('Début — année').fill('2021')
  await experiences.getByLabel('Début — mois (facultatif)').selectOption('03')
  await experiences.getByRole('switch', { name: 'Poste actuel' }).click()
  await experiences.getByRole('button', { name: 'Ajouter une réalisation' }).click()
  await experiences.getByRole('textbox', { name: 'Réalisation 1', exact: true }).fill('Refonte du site e-commerce : +18 % de conversion en 6 mois.')
  await waitSaved(page)

  // Les données survivent à un rechargement complet (elles sont bien en base).
  await page.reload()
  await expect(page.getByLabel('Prénom', { exact: true })).toHaveValue('Camille')
  await expect(page.getByRole('region', { name: 'Expériences' }).getByText('Cheffe de projet senior')).toBeVisible()

  // 2. Créer un CV depuis le profil.
  await page.getByRole('navigation', { name: 'Principale' }).getByRole('link', { name: 'Mes CV' }).click()
  await page.getByRole('button', { name: /Nouveau CV/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Nouveau CV' })
  await dialog.getByLabel('Nom du CV').fill('CV Chef de projet — Acme')
  await dialog.getByRole('button', { name: 'Créer' }).click()
  await expect(page).toHaveURL(/\/cv\/[0-9A-Z]{26}$/)

  // 3. Aperçu A4 = PDF généré ; la copie du profil est dans le formulaire.
  await waitForPreview(page)
  await expect(page.getByRole('img', { name: 'Page 1 du CV' })).toBeVisible()
  await expect(page.getByLabel('Prénom', { exact: true })).toHaveValue('Camille')

  // 4. Export PDF : fichier valide, texte réellement extractible, en une page.
  const { bytes, pdf } = await exportPdf(page, testInfo, 'parcours.pdf')
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect(pdf.pages).toBe(1)
  const text = squash(pdf.text)
  for (const expected of ['Camille Exemple', 'Cheffe de projet digital', 'Expérience professionnelle', 'Société Fictive SA', 'Refonte du site e-commerce', 'camille@example.test']) {
    expect(text, expected).toContain(squash(expected))
  }
  expect(pdf.text).not.toMatch(/(?:^|\s)(?:\p{L}\s){5,}\p{L}(?:\s|$)/u) // pas de texte espacé lettre par lettre

  // 5. Le nom du CV et le contenu modifiés sont conservés après rechargement.
  await page.getByLabel('Nom du CV').fill('CV Acme — version finale')
  await waitSaved(page)
  await page.reload()
  await expect(page.getByLabel('Nom du CV')).toHaveValue('CV Acme — version finale')
  await openTab(page, 'Contenu')
  await expect(page.getByLabel('Titre professionnel')).toHaveValue('Cheffe de projet digital')
})

test('l’atelier liste, duplique et supprime les CV', async ({ page }) => {
  await register(page)
  await seedProfile(page)
  await createCvViaApi(page, 'Premier CV')
  await page.goto('/')

  await expect(page.getByRole('link', { name: 'Premier CV', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Dupliquer Premier CV' }).click()
  await expect(page).toHaveURL(/\/cv\/[0-9A-Z]{26}$/)
  await expect(page.getByLabel('Nom du CV')).toHaveValue('Premier CV (copie)')

  await page.getByRole('link', { name: 'Retour à mes CV' }).click()
  await expect(page.getByRole('link', { name: 'Premier CV (copie)' })).toBeVisible()

  // Suppression annulable : « Annuler » remet le CV, sinon il disparaît pour de bon.
  await page.getByRole('button', { name: 'Supprimer Premier CV (copie)' }).click()
  await expect(page.getByRole('link', { name: 'Premier CV (copie)' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Annuler' }).click()
  await expect(page.getByRole('link', { name: 'Premier CV (copie)' })).toBeVisible()
  await page.getByRole('button', { name: 'Supprimer Premier CV (copie)' }).click()
  await expect(page.getByText('« Premier CV (copie) » supprimé')).toBeVisible()
  await expect(page.getByText('« Premier CV (copie) » supprimé')).toHaveCount(0, { timeout: 10_000 })
  await page.reload()
  await expect(page.getByRole('link', { name: 'Premier CV (copie)' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Premier CV', exact: true })).toBeVisible()
})
