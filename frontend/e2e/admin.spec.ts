import { expect, test } from '@playwright/test'
import { ADMIN_EMAIL } from './env'
import { PASSWORD, logout, register, uniqueEmail } from './helpers'

test('administration restreinte : métadonnées seulement, pas de sauvegarde, pas de lien sans demande', async ({ page }) => {
  const friend = uniqueEmail('amie')
  await register(page, { email: friend, name: 'Amie' })
  await logout(page)

  await page.getByLabel('Adresse e-mail').fill(ADMIN_EMAIL)
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.getByRole('navigation', { name: 'Principale' }).getByRole('link', { name: 'Administration' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible()

  // Pas de téléchargement de la base, ni dans l'interface ni par l'API.
  await expect(page.getByText(/Sauvegarde SQL/)).toHaveCount(0)
  expect((await page.request.get('/api/admin/backup')).status()).toBe(404)

  // Le compte apparaît avec ses métadonnées ; aucun lien de réinitialisation sans demande de la personne.
  const row = page.getByRole('row').filter({ hasText: friend })
  await expect(row).toContainText('0 CV')
  await row.getByRole('button', { name: 'Actions' }).click()
  await expect(page.getByRole('menuitem', { name: /Lien de réinitialisation/ })).toBeDisabled()
  await page.keyboard.press('Escape')
})
