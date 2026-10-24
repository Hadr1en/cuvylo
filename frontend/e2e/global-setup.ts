import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { request } from '@playwright/test'
import { ADMIN_EMAIL, ORIGIN, apiEnv } from './env'
import { PASSWORD } from './helpers'

/**
 * 1. Crée la base MySQL si besoin et applique les migrations (jamais de vidage : voir backend/bin/e2e-prepare.php).
 * 2. Base neuve (CI) : installe l'instance par l'API, comme le ferait l'écran /installation, avec le compte
 *    administrateur des tests. Base déjà utilisée : crée ce compte s'il manque (inscription ouverte en e2e).
 * Les serveurs (API, interface) sont démarrés par Playwright avant cette étape.
 */
export default async function globalSetup(): Promise<void> {
  const script = resolve(process.cwd(), '../backend/bin/e2e-prepare.php')
  try {
    const out = execFileSync('php', [script], { env: { ...process.env, ...apiEnv }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    console.log(`[e2e] ${out.trim()}`)
  } catch (e) {
    const err = e as { stderr?: string }
    throw new Error(`Impossible de préparer la base MySQL des tests e2e. Le serveur MySQL tourne-t-il (E2E_DB_DSN) ?\n${err.stderr ?? ''}`)
  }

  const ctx = await request.newContext({ baseURL: ORIGIN })
  try {
    const status = (await (await ctx.get('/api/setup')).json()) as { needed: boolean }
    const csrf = ((await (await ctx.get('/api/csrf')).json()) as { csrfToken: string }).csrfToken
    const headers = { 'X-CSRF-Token': csrf, Origin: ORIGIN }
    const credentials = { email: ADMIN_EMAIL, password: PASSWORD }
    if (status.needed) {
      const r = await ctx.post('/api/setup', { data: { setupCode: apiEnv.SETUP_CODE, ...credentials }, headers })
      if (r.status() !== 201) throw new Error(`Installation e2e refusée (${r.status()}) : ${await r.text()}`)
      console.log('[e2e] Instance installée (compte administrateur des tests créé).')
    } else {
      const r = await ctx.post('/api/auth/register', { data: credentials, headers })
      if (![201, 422].includes(r.status())) throw new Error(`Compte administrateur e2e : ${r.status()} ${await r.text()}`)
    }
  } finally {
    await ctx.dispose()
  }
}
