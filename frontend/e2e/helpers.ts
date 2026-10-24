import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractPdfText, type ExtractedPdf } from '../src/pdf/extract'
import { MAIL_DIR, ORIGIN } from './env'

/** Mot de passe des comptes de test (compte local jetable, jamais un vrai mot de passe). */
export const PASSWORD = 'e2e-passphrase-correct-horse-2026'

let counter = 0
/** E-mail unique par test : les tests s'isolent par compte, la base n'est jamais vidée. */
export function uniqueEmail(tag = 'u'): string {
  return `${tag}-${Date.now().toString(36)}-${++counter}@example.test`
}

export async function register(page: Page, opts: { email?: string; name?: string } = {}): Promise<string> {
  const email = opts.email ?? uniqueEmail()
  const name = opts.name ?? 'Camille'
  await page.goto('/inscription')
  await page.getByLabel('Nom affiché (facultatif)').fill(name)
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Créer mon compte' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Mes CV' })).toBeVisible()
  await expect(page.getByText(`Bonjour ${name}.`)).toBeVisible()
  return email
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Se déconnecter' }).first().click()
  await expect(page).toHaveURL(/\/connexion$/)
}

/** Profil fictif partagé avec les tests PHP et Vitest. */
export function sampleProfile(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), '../shared/fixtures/sample-profile.json'), 'utf8')) as Record<string, unknown>
}

async function csrf(page: Page): Promise<string> {
  const res = await page.request.get('/api/csrf')
  return ((await res.json()) as { csrfToken: string }).csrfToken
}

/** Écrit un profil par l'API (session de la page courante) : évite de retaper un long parcours dans l'interface. */
export async function seedProfile(page: Page, data: Record<string, unknown> = sampleProfile()): Promise<void> {
  const res = await page.request.put('/api/profile', { data: { data }, headers: { 'X-CSRF-Token': await csrf(page), Origin: ORIGIN } })
  expect(res.status(), 'PUT /api/profile').toBe(200)
}

export async function createCvViaApi(page: Page, title: string): Promise<string> {
  const res = await page.request.post('/api/cvs', {
    data: { title, kind: 'base', source: { type: 'profile' } },
    headers: { 'X-CSRF-Token': await csrf(page), Origin: ORIGIN },
  })
  expect(res.status(), 'POST /api/cvs').toBe(201)
  return ((await res.json()) as { cv: { id: string } }).cv.id
}

/** Attend que l'aperçu soit généré : le pied de l'aperçu annonce le nombre de pages extraites. */
export async function waitForPreview(page: Page): Promise<void> {
  await expect(page.getByText(/\d+ pages? · .* caractères extractibles/)).toBeVisible({ timeout: 45_000 })
}

const TAB_NAMES = { Contenu: 'Contenu', Modèle: 'Mise en page', ATS: 'Analyse ATS', Offre: 'Offre', Relecture: 'Relecture', Versions: 'Versions', Partage: 'Partage' } as const

export async function openTab(page: Page, name: keyof typeof TAB_NAMES): Promise<void> {
  await page.getByRole('tab', { name: TAB_NAMES[name], exact: true }).click()
}

export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByText('Enregistré', { exact: true })).toBeVisible()
}

/**
 * Régénération du PDF après une modification : elle démarre 400 ms après la dernière (délai anti-rebond),
 * donc on attend ce délai avant de vérifier que l'aperçu est à nouveau stable.
 */
export async function settlePreview(page: Page): Promise<void> {
  await page.waitForTimeout(900)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 45_000 })
  await waitForPreview(page)
}

/** Menu « Exporter » → « PDF » : enregistre le fichier téléchargé et l'analyse avec pdf.js. */
export async function exportPdf(page: Page, testInfo: TestInfo, name = 'cv.pdf'): Promise<{ path: string; bytes: Buffer; pdf: ExtractedPdf }> {
  await page.getByRole('button', { name: 'Exporter' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /^PDF\s*Le fichier/ }).click()])
  const path = testInfo.outputPath(name)
  await download.saveAs(path)
  const bytes = readFileSync(path)
  return { path, bytes, pdf: await readPdf(bytes) }
}

export async function readPdf(bytes: Buffer): Promise<ExtractedPdf> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 })
  try {
    return await extractPdfText(await task.promise)
  } finally {
    await task.destroy()
  }
}

/**
 * Dernier e-mail reçu par `to` dans la « boîte » des tests (transport fichier de l'API), corps décodé.
 * Attend jusqu'à 10 s qu'il arrive.
 */
export async function lastMail(to: string, subject: RegExp): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const files = existsSync(MAIL_DIR) ? readdirSync(MAIL_DIR).filter((f) => f.endsWith('.eml')).sort().reverse() : []
    for (const f of files) {
      const raw = readFileSync(resolve(MAIL_DIR, f), 'utf8')
      const [head = '', body = ''] = raw.split('\r\n\r\n')
      const subjectLine = /^Subject: (.*)$/m.exec(head)?.[1] ?? ''
      const decodedSubject = subjectLine.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b64: string) => Buffer.from(b64, 'base64').toString('utf8'))
      if (head.includes(`To: ${to}\r\n`) && subject.test(decodedSubject)) {
        return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8')
      }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Aucun e-mail « ${subject.source} » reçu par ${to}`)
}

/** Comparaison tolérante aux espaces, à la casse et aux retours à la ligne. */
export const squash = (s: string): string => s.toLowerCase().replace(/\s+/g, '')
