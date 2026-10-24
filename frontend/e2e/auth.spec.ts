import { expect, test } from '@playwright/test'
import { PASSWORD, createCvViaApi, logout, register, seedProfile, uniqueEmail } from './helpers'

test('les pages protégées renvoient vers la connexion', async ({ page }) => {
  await page.goto('/profil')
  await expect(page).toHaveURL(/\/connexion$/)
  await page.goto('/cv/01ARZ3NDEKTSV4RRFFQ69G5FAV')
  await expect(page).toHaveURL(/\/connexion$/)
})

test('connexion, mot de passe erroné (message neutre) et déconnexion qui invalide la session', async ({ page, browser }) => {
  const email = uniqueEmail('login')
  await register(page, { email })
  await logout(page)

  // Un seul échec volontaire : la limitation de connexion par IP est couverte par les tests PHP.
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe-123')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toHaveText('E-mail ou mot de passe incorrect.')

  // Même message pour un compte inexistant : pas d'énumération par la connexion.
  await page.getByLabel('Adresse e-mail').fill(uniqueEmail('nobody'))
  await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe-123')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toHaveText('E-mail ou mot de passe incorrect.')

  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Mes CV' })).toBeVisible()
  expect((await page.request.get('/api/auth/me')).status()).toBe(200)

  // Le jeton de session est supprimé côté serveur : l'ancien cookie ne rouvre rien.
  const cookies = await page.context().cookies()
  const stale = await browser.newContext({ baseURL: page.url().split('/').slice(0, 3).join('/') })
  await stale.addCookies(cookies)
  expect((await stale.request.get('/api/auth/me')).status()).toBe(200)
  await logout(page)
  expect((await page.request.get('/api/auth/me')).status()).toBe(401)
  expect((await stale.request.get('/api/auth/me')).status(), 'cookie volé après déconnexion').toBe(401)
  await stale.close()
})

test('un e-mail déjà inscrit est refusé', async ({ page }) => {
  const email = uniqueEmail('dup')
  await register(page, { email })
  await logout(page)
  await page.goto('/inscription')
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Créer mon compte' }).click()
  await expect(page.getByText('Un compte existe déjà avec cette adresse.')).toBeVisible()
})

test('un mot de passe trop court est refusé par le serveur', async ({ page }) => {
  await page.goto('/inscription')
  await page.getByLabel('Adresse e-mail').fill(uniqueEmail('short'))
  await page.getByLabel('Mot de passe').fill('court')
  await page.getByRole('button', { name: 'Créer mon compte' }).click()
  await expect(page.getByText(/12 caractères minimum/).first()).toBeVisible()
  await expect(page).toHaveURL(/\/inscription$/)
})

test('isolation : un autre utilisateur ne voit ni ne lit les CV d’autrui (404, jamais 403)', async ({ page, browser }) => {
  await register(page, { name: 'Alice' })
  await seedProfile(page)
  const cvId = await createCvViaApi(page, 'CV privé d’Alice')

  const other = await browser.newContext({ baseURL: page.url().split('/').slice(0, 3).join('/') })
  const bob = await other.newPage()
  await register(bob, { name: 'Bob' })

  // Interface : le CV d'Alice est « introuvable » pour Bob et n'apparaît pas dans son atelier.
  await bob.goto(`/cv/${cvId}`)
  await expect(bob.getByText('Ce CV est introuvable.')).toBeVisible()
  await bob.goto('/')
  await expect(bob.getByText('CV privé d’Alice')).toHaveCount(0)

  // API : lecture, modification, suppression, versions → 404 ; aucun fait n'est modifié.
  const csrf = ((await (await bob.request.get('/api/csrf')).json()) as { csrfToken: string }).csrfToken
  expect((await bob.request.get(`/api/cvs/${cvId}`)).status()).toBe(404)
  expect((await bob.request.get(`/api/cvs/${cvId}/versions`)).status()).toBe(404)
  expect((await bob.request.delete(`/api/cvs/${cvId}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(404)

  // Alice garde son CV.
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'CV privé d’Alice' })).toBeVisible()
  await other.close()
})
