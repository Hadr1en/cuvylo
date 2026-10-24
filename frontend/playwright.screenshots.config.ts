import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * Génère les captures d'écran du README (docs/screenshots/*.jpg) avec les mêmes serveurs que les
 * tests e2e (API PHP + MySQL + build de production), en haute résolution, sur des données fictives.
 *
 *   npm run screenshots
 */
export default defineConfig({
  ...base,
  testDir: './e2e/screenshots',
  testIgnore: undefined,
  timeout: 240_000,
  use: { ...base.use, deviceScaleFactor: 2 },
})
