import { expect, test } from '@playwright/test'
import { createCvViaApi, openTab, register, sampleProfile, seedProfile, waitForPreview, waitSaved } from './helpers'

const POSTING = `Cheffe de projet digital (H/F)

Vos missions :
- Piloter la refonte du site e-commerce avec les équipes Scrum
- Suivre les KPI de conversion avec Google Analytics
- Animer les comités de pilotage et le reporting

Profil recherché :
- 5 ans d'expérience en gestion de projet digital
- Maîtrise de Jira et de Figma
- Connaissance de SQL, de Power BI et de Salesforce
- Anglais courant

Un plus : certification PSM.`

test.describe('offre d’emploi', () => {
  test('compare la fiche de poste au CV, propose des pistes sans rien inventer et crée une version adaptée', async ({ page }) => {
    await register(page)
    await seedProfile(page)
    const id = await createCvViaApi(page, 'CV de base')
    await page.goto(`/cv/${id}`)
    await waitForPreview(page)

    await openTab(page, 'Offre')
    await expect(page.getByText('En attente d’une fiche de poste.')).toBeVisible()
    await page.getByLabel('Fiche de poste').fill(POSTING)

    const required = page.getByRole('region', { name: 'Exigé' })
    await expect(required).toBeVisible()
    const chip = (term: string) => required.locator('li').filter({ hasText: term }).first()
    await expect(chip('Salesforce')).toContainText('Absent')
    await expect(chip('Jira')).toContainText('dans les compétences')

    const suggestions = page.getByRole('region', { name: 'Pistes de reformulation' })
    await expect(suggestions).toContainText('Sinon, ne l’ajoutez pas')
    await expect(page.getByText(/ne prédit ni un score ATS/)).toBeVisible()

    // La fiche reste dans le navigateur après rechargement (stockage local, jamais envoyée au serveur).
    await page.reload()
    await openTab(page, 'Offre')
    await expect(page.getByLabel('Fiche de poste')).toHaveValue(POSTING)

    // Version adaptée : copie indépendante, étiquetée « Adapté » dans l'atelier.
    await page.getByRole('button', { name: /Créer une version adaptée/ }).click()
    await expect(page).not.toHaveURL(new RegExp(id))
    await expect(page).toHaveURL(/\/cv\/[0-9A-Z]{26}$/)
    expect(page.url()).not.toContain(id)
    await expect(page.getByLabel('Nom du CV')).toHaveValue('CV de base — Cheffe de projet digital (H/F)')

    await page.getByRole('link', { name: 'Retour à mes CV' }).click()
    await expect(page.getByText('Adapté', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'CV de base', exact: true })).toBeVisible()
  })
})

test.describe('analyse ATS', () => {
  test('signale les informations manquantes et lit le texte réellement extrait du PDF', async ({ page }) => {
    await register(page)
    const profile = JSON.parse(JSON.stringify(sampleProfile())) as { identity: Record<string, string> }
    profile.identity.email = ''
    profile.identity.phone = ''
    await seedProfile(page, profile)
    await page.goto(`/cv/${await createCvViaApi(page, 'CV incomplet')}`)
    await waitForPreview(page)

    await openTab(page, 'ATS')
    await expect(page.getByText('Aucune adresse e-mail.')).toBeVisible()
    await expect(page.getByText('Aucun numéro de téléphone.')).toBeVisible()
    await expect(page.getByText(/ne garantissent la compatibilité avec/)).toBeVisible()
    // Les contrôles portant sur le PDF ont été exécutés (texte extrait disponible).
    await expect(page.getByText(/en attente du PDF/)).toHaveCount(0)

    await page.getByRole('button', { name: /Texte lu dans le PDF/ }).click()
    await expect(page.locator('pre')).toContainText('Camille Exemple')
  })

  test('un profil complet n’a aucune erreur bloquante', async ({ page }) => {
    await register(page)
    await seedProfile(page)
    await page.goto(`/cv/${await createCvViaApi(page, 'CV complet')}`)
    await waitForPreview(page)
    await openTab(page, 'ATS')
    const synthese = page.getByRole('group', { name: 'Synthèse des constats' })
    await expect(synthese.getByText('À corriger').locator('..')).toContainText('0')
  })
})

test.describe('versions', () => {
  test('enregistre une version nommée puis la restaure', async ({ page }) => {
    await register(page)
    await seedProfile(page)
    await page.goto(`/cv/${await createCvViaApi(page, 'CV versionné')}`)
    await waitForPreview(page)

    await openTab(page, 'Versions')
    await page.getByLabel('Nom de la version').fill('Avant essai')
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await expect(page.getByText('Avant essai', { exact: true })).toBeVisible()

    await openTab(page, 'Contenu')
    await page.getByLabel('Titre professionnel').fill('Titre modifié par erreur')
    await waitSaved(page)

    await openTab(page, 'Versions')
    await page.getByRole('button', { name: 'Restaurer la version Avant essai' }).click()
    await page.getByRole('dialog', { name: 'Restaurer cette version ?' }).getByRole('button', { name: 'Restaurer', exact: true }).click()

    await openTab(page, 'Contenu')
    await expect(page.getByLabel('Titre professionnel')).toHaveValue('Cheffe de projet digital')
  })
})
