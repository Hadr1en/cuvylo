import { expect, test } from '@playwright/test'
import { lastMail, logout, register, uniqueEmail } from './helpers'

test('mot de passe oublié : lien reçu par e-mail, nouveau mot de passe, connexion, e-mail de confirmation', async ({ page }) => {
  const email = uniqueEmail('oubli')
  await register(page, { email, name: 'Camille' })
  await logout(page)

  // 1. Depuis l'écran de connexion.
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Mot de passe oublié' })).toBeVisible()
  await expect(page.getByLabel('Adresse e-mail')).toHaveValue(email)
  await page.getByRole('button', { name: 'Recevoir un lien' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Vérifiez votre boîte e-mail' })).toBeVisible()

  // 2. L'e-mail contient un lien vers l'application.
  const body = await lastMail(email, /Réinitialisation de votre mot de passe/)
  const url = /https?:\/\/\S+\/reinitialisation\/\S+/.exec(body)?.[0]
  expect(url, 'lien présent dans l’e-mail').toBeTruthy()
  expect(body).toContain('60 minutes')

  // 3. Nouveau mot de passe.
  await page.goto(new URL(url!).pathname)
  await page.getByLabel('Nouveau mot de passe').fill('un nouveau mot de passe solide')
  await page.getByLabel('Confirmer').fill('un nouveau mot de passe solide')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Mot de passe modifié. Connectez-vous avec le nouveau.')).toBeVisible()

  // 4. Connexion avec le nouveau mot de passe, et confirmation reçue.
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe').fill('un nouveau mot de passe solide')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Mes CV' })).toBeVisible()
  expect(await lastMail(email, /a été modifié/)).toContain('vient d\'être modifié')

  // 5. Le lien ne sert qu'une fois.
  await page.goto(new URL(url!).pathname)
  await expect(page.getByText(/Ce lien n’est plus valable/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Demander un nouveau lien' })).toBeVisible()
})
