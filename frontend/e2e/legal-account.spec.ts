import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { PASSWORD, createCvViaApi, register, seedProfile, uniqueEmail } from './helpers'

test.describe('pages légales (sans compte)', () => {
  test('mentions légales, confidentialité et sécurité affichent la configuration de l’instance', async ({ page }) => {
    await page.goto('/connexion')
    await page.getByRole('navigation', { name: 'Informations légales' }).getByRole('link', { name: 'Mentions légales' }).click()
    await expect(page).toHaveURL(/\/mentions-legales$/)
    await expect(page.getByText('Hébergeur Exemple SAS, 1 rue du Test, 59000 Lille')).toBeVisible()
    await expect(page.getByText(/article 6-III-2/)).toBeVisible() // éditeur particulier non nommé
    await expect(page.getByRole('link', { name: 'contact@example.test' }).first()).toHaveAttribute('href', 'mailto:contact@example.test')

    await page.goto('/confidentialite')
    await expect(page.getByText(/au plus tard après 30 jours/)).toBeVisible()
    await expect(page.getByText(/au-delà de 24 heures/)).toBeVisible()

    await page.goto('/securite')
    await expect(page.getByRole('link', { name: 'securite@example.test' })).toBeVisible()
  })

  test('security.txt (RFC 9116) est servi par l’API à partir de la configuration', async ({ request }) => {
    const res = await request.get('/api/security-txt')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/plain')
    const body = await res.text()
    expect(body).toContain('Contact: mailto:securite@example.test')
    expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m)
    expect(body).toContain('/.well-known/security.txt')
  })
})

test.describe('compte : droits RGPD', () => {
  test('export complet puis suppression définitive du compte', async ({ page }, testInfo) => {
    const email = uniqueEmail('rgpd')
    await register(page, { email })
    await seedProfile(page)
    await createCvViaApi(page, 'CV à exporter')

    await page.getByRole('navigation', { name: 'Principale' }).getByRole('link', { name: 'Compte' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Compte' })).toBeVisible()
    await expect(page.locator('#contenu').getByText(email)).toBeVisible()

    // Export : un fichier JSON avec le compte, le profil et les CV, sans hash de mot de passe.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Exporter \(JSON\)/ }).click()])
    const path = testInfo.outputPath('export.json')
    await download.saveAs(path)
    const raw = readFileSync(path, 'utf8')
    const exported = JSON.parse(raw) as { format: string; account: { email: string }; cvs: { title: string }[]; profile: { data: unknown } }
    expect(exported.format).toBe('cuvylo-account')
    expect(exported.account.email).toBe(email)
    expect(exported.cvs.map((c) => c.title)).toEqual(['CV à exporter'])
    expect(exported.profile.data).toBeTruthy()
    expect(raw).not.toContain('password')

    // Suppression : mauvais mot de passe refusé, puis effacement réel.
    const zone = page.getByRole('region', { name: 'Supprimer mon compte' })
    const button = zone.getByRole('button', { name: /Supprimer définitivement/ })
    await zone.getByLabel('Mot de passe actuel').fill('pas-le-bon-mot-de-passe')
    await zone.getByLabel('Tapez SUPPRIMER pour confirmer').fill('SUPPRIMER')
    await button.click()
    await expect(page.getByText('Mot de passe incorrect.')).toBeVisible()
    expect((await page.request.get('/api/auth/me')).status()).toBe(200)

    await zone.getByLabel('Mot de passe actuel').fill(PASSWORD)
    await button.click()
    await expect(page).toHaveURL(/\/connexion$/)
    await expect(page.getByText('Votre compte et toutes ses données ont été supprimés.')).toBeVisible()
    expect((await page.request.get('/api/auth/me')).status()).toBe(401)

    // Le compte n'existe plus : la connexion échoue avec le message neutre habituel.
    await page.getByLabel('Adresse e-mail').fill(email)
    await page.getByLabel('Mot de passe').fill(PASSWORD)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('alert')).toHaveText('E-mail ou mot de passe incorrect.')
  })
})
