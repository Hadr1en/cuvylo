import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { ORIGIN } from '../env'
import { createCvViaApi, openTab, register, seedProfile, settlePreview, waitForPreview } from '../helpers'

/**
 * Captures du README : données 100 % fictives (profil « Camille Exemple »), jamais de données réelles.
 * Les fichiers sont écrits dans docs/screenshots/ et remplacés à chaque exécution.
 */
const OUT = resolve(process.cwd(), '../docs/screenshots')

const POSTING = `Cheffe de projet cybersécurité (H/F)

Vos missions :
- Piloter les projets d'homologation et l'analyse de risques EBIOS RM
- Suivre les plans de remédiation des vulnérabilités (Qualys)
- Animer les comités de pilotage et le reporting

Profil recherché :
- 5 ans d'expérience en gestion de projet sécurité
- Maîtrise d'ISO 27001 et de la gestion des risques
- Connaissance de CyberArk, Active Directory et Splunk
- Anglais courant

Un plus : certification CISSP.`

/** Les 18 modèles, dans l'ordre de l'onglet Mise en page. */
const TEMPLATES = [
  'Classique', 'Moderne', 'Compact', 'Encre', 'Consultant', 'Direction', 'Ingénierie', 'Médias', 'Académique',
  'Européen', 'Éditorial', 'Grille', 'Bandeau', 'Chronologie', 'Dossier', 'Marge', 'Barre latérale', 'Dossier de compétences',
] as const

const sampleV2 = () => JSON.parse(readFileSync(resolve(process.cwd(), '../shared/fixtures/sample-profile-v2.json'), 'utf8')) as Record<string, unknown>

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: resolve(OUT, `${name}.jpg`), type: 'jpeg', quality: 90, fullPage })
}

/** Première page du PDF telle que dessinée dans l'aperçu (le canvas entier, quelle que soit la zone visible). */
async function sheetImage(page: Page): Promise<string> {
  return page.locator('.sheet canvas').first().evaluate((c) => (c as HTMLCanvasElement).toDataURL('image/jpeg', 0.92))
}

function saveDataUrl(dataUrl: string, name: string): void {
  writeFileSync(resolve(OUT, `${name}.jpg`), Buffer.from(dataUrl.split(',')[1]!, 'base64'))
}

const label = (name: string) => new RegExp(`^${name}\\p{Lu}`, 'u')

test('captures du README', async ({ page, browser }) => {
  test.setTimeout(600_000)
  mkdirSync(OUT, { recursive: true })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })

  await page.goto('/connexion')
  await page.waitForTimeout(600)
  await shot(page, 'connexion')

  // Données fictives : profil v2 complet, CV, candidatures et une lettre.
  await register(page, { name: 'Camille' })
  await seedProfile(page, sampleV2())
  const csrf = ((await (await page.request.get('/api/csrf')).json()) as { csrfToken: string }).csrfToken
  const headers = { 'X-CSRF-Token': csrf, Origin: ORIGIN }
  const cvId = await createCvViaApi(page, 'Cheffe de projet cybersécurité')
  const shortId = await createCvViaApi(page, 'Version courte — candidatures spontanées')
  await page.request.post('/api/cvs', { data: { title: 'Cheffe de projet — Aéroport Fictif', kind: 'tailored', source: { type: 'cv', id: cvId } }, headers })
  for (const a of [
    { company: 'Aéroport Fictif', position: 'Cheffe de projet sécurité', status: 'interview', appliedAt: '2026-10-02', nextActionAt: '2026-10-28' },
    { company: 'Banque Exemple', position: 'Responsable homologation', status: 'applied', appliedAt: '2026-10-12', nextActionAt: '2026-10-26' },
    { company: 'Distributeur Imaginaire', position: 'Consultante GRC', status: 'draft', appliedAt: null, nextActionAt: null },
  ]) {
    await page.request.post('/api/applications', { data: { url: '', posting: '', cvId, notes: '', ...a }, headers })
  }

  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Cheffe de projet cybersécurité', exact: true })).toBeVisible()
  await page.waitForTimeout(600)
  await shot(page, 'atelier')

  await page.goto('/profil')
  await expect(page.getByLabel('Prénom', { exact: true })).toHaveValue('Camille')
  await page.waitForTimeout(400)
  await shot(page, 'profil')

  await page.goto('/candidatures')
  await expect(page.getByText('Aéroport Fictif')).toBeVisible()
  await shot(page, 'candidatures')

  // Éditeur : contenu + aperçu PDF.
  await page.goto(`/cv/${cvId}`)
  await waitForPreview(page)
  await page.waitForTimeout(600)
  await shot(page, 'editeur')

  // Mise en page : les miniatures sont rendues par le vrai moteur PDF.
  await openTab(page, 'Modèle')
  await expect(page.locator('input[name=template]').locator('xpath=..').locator('img')).toHaveCount(TEMPLATES.length, { timeout: 240_000 })
  await page.waitForTimeout(500)
  await shot(page, 'modeles')

  await openTab(page, 'Offre')
  await page.getByLabel('Fiche de poste').fill(POSTING)
  await expect(page.getByRole('region', { name: 'Exigé' })).toBeVisible()
  await page.waitForTimeout(400)
  await shot(page, 'offre')

  await openTab(page, 'Relecture')
  await page.waitForTimeout(400)
  await shot(page, 'relecture')

  // ATS : sur un CV volontairement incomplet (sans téléphone) pour montrer de vrais constats.
  const cvBody = (await (await page.request.get(`/api/cvs/${shortId}`)).json()) as { cv: { title: string; settings: unknown; data: { identity: { phone: string } } } }
  cvBody.cv.data.identity.phone = ''
  await page.request.put(`/api/cvs/${shortId}`, { data: { title: cvBody.cv.title, settings: cvBody.cv.settings, data: cvBody.cv.data }, headers })
  await page.goto(`/cv/${shortId}`)
  await waitForPreview(page)
  await openTab(page, 'ATS')
  await expect(page.getByText('Aucun numéro de téléphone.')).toBeVisible()
  await page.waitForTimeout(500)
  await shot(page, 'ats')

  // Galerie des 18 modèles (première page de chaque PDF).
  await page.goto(`/cv/${cvId}`)
  await waitForPreview(page)
  await openTab(page, 'Modèle')
  const sheets: Record<string, string> = {}
  for (const t of TEMPLATES) {
    await page.locator('label').filter({ hasText: label(t) }).first().click()
    await settlePreview(page)
    sheets[t] = await sheetImage(page)
    if (t === 'Consultant') saveDataUrl(sheets[t], 'modele-consultant')
    if (t === 'Grille') saveDataUrl(sheets[t], 'modele-grille')
    if (t === 'Barre latérale') saveDataUrl(sheets[t], 'modele-barre-laterale')
    if (t === 'Dossier de compétences') saveDataUrl(sheets[t], 'modele-dossier-competences')
  }
  const gallery = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 })
  await gallery.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:40px;background:#f4f6f9;font-family:-apple-system,'Segoe UI',sans-serif;color:#14213d}
    .g{display:grid;grid-template-columns:repeat(6,1fr);gap:28px 22px}
    figure{margin:0}img{display:block;width:100%;border-radius:4px;background:#fff;box-shadow:0 1px 2px rgb(16 24 40/.08),0 4px 16px rgb(16 24 40/.08)}
    figcaption{margin-top:10px;font-size:15px;font-weight:600}
  </style><div class="g">${TEMPLATES.map((t) => `<figure><img src="${sheets[t]}" alt=""><figcaption>${t}</figcaption></figure>`).join('')}</div>`)
  await gallery.waitForLoadState('load')
  await gallery.screenshot({ path: resolve(OUT, 'galerie-modeles.jpg'), type: 'jpeg', quality: 88, fullPage: true })
  await gallery.close()

  // Thème sombre.
  await page.locator('label').filter({ hasText: label('Classique') }).first().click()
  await openTab(page, 'Contenu')
  await settlePreview(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.locator('#panel-edit').evaluate((el) => (el.scrollTop = 0))
  await page.waitForTimeout(400)
  await shot(page, 'editeur-sombre')

  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/compte')
  await expect(page.getByRole('heading', { level: 1, name: 'Compte' })).toBeVisible()
  await page.waitForTimeout(600)
  await page.evaluate(() => document.querySelectorAll('dd').forEach((e) => e.textContent?.includes('@') && (e.textContent = 'camille@example.test')))
  await shot(page, 'compte')

  // Mobile : l'aperçu en plein écran, puis l'édition.
  await page.goto(`/cv/${cvId}`)
  await waitForPreview(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Aperçu', exact: true }).click()
  await page.waitForTimeout(1500)
  await shot(page, 'mobile-apercu')
  await page.getByRole('button', { name: 'Éditer', exact: true }).click()
  await page.waitForTimeout(500)
  await shot(page, 'mobile-edition')
})
