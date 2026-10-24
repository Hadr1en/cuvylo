import { defineConfig, devices } from '@playwright/test'
import { API_PORT, ORIGIN, WEB_PORT, apiEnv } from './e2e/env'

/**
 * Tests de bout en bout : vrai navigateur (Chromium), build de production servi par `vite preview`,
 * API PHP réelle (serveur intégré) et base **MySQL**. Voir docs/tests-e2e.md.
 *
 *   npm run e2e
 *
 * Les tests créent des comptes aux e-mails uniques et ne vident jamais la base.
 */
export default defineConfig({
  testDir: './e2e',
  // Les captures du README ont leur propre config (playwright.screenshots.config.ts).
  testIgnore: '**/screenshots/**',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: ORIGIN,
    locale: 'fr-FR',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: `php -d opcache.enable_cli=0 -S 127.0.0.1:${API_PORT} ../backend/bin/dev-router.php`,
      // Attente du port seulement : /api/health ouvre déjà la base, que globalSetup prépare juste après.
      port: API_PORT,
      env: apiEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run build && npx vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: ORIGIN,
      env: { VITE_DEV_API: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
})
