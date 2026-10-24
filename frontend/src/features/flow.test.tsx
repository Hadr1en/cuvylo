import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import { resetCsrf } from '@/api/client'
import { defaultSettings } from '@/domain/cv'
import { emptyProfile, type ProfileData } from '@/domain/profile'
import type * as UsePdfModule from '@/pdf/usePdf'

// react-pdf / pdf.js ne tournent pas dans jsdom : le rendu PDF est couvert par src/pdf/render.test.ts.
const downloadBlob = vi.fn()
vi.mock('@/pdf/usePdf', async (orig) => ({
  ...(await orig<typeof UsePdfModule>()),
  downloadBlob: (...args: unknown[]) => downloadBlob(...args),
  useCvPdf: () => ({
    status: 'ready',
    blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
    extracted: { pages: 1, pageTexts: ['x'], text: 'x' },
  }),
}))
vi.mock('@/pdf/PdfPages', () => ({ PdfPages: () => <div data-testid="pdf-pages" /> }))

/** API en mémoire : même contrat que l’API PHP, suffisant pour le parcours principal. */
function fakeApi() {
  const db = {
    loggedIn: false,
    profile: emptyProfile() as ProfileData,
    cvs: new Map<string, { id: string; title: string; kind: 'base'; settings: ReturnType<typeof defaultSettings>; data: ProfileData; createdAt: string; updatedAt: string }>(),
    puts: [] as ProfileData[],
  }
  const user = { id: 'u1', email: 'camille@example.test', displayName: 'Camille', createdAt: '2026-10-24T08:00:00Z' }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const err = (status: number, code: string) => json({ error: { code, message: code } }, status)

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname.replace(/^\/api/, '')
    // Comme le serveur : un POST porteur de X-HTTP-Method-Override vaut la méthode indiquée.
    const method = (init?.headers as Record<string, string> | undefined)?.['X-HTTP-Method-Override'] ?? init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}

    if (path === '/csrf') return json({ csrfToken: 'test-token' })
    if (path === '/auth/login') {
      db.loggedIn = true
      return json({ user })
    }
    if (path === '/auth/logout') {
      db.loggedIn = false
      return new Response(null, { status: 204 })
    }
    if (!db.loggedIn) return err(401, 'unauthenticated')
    if (method !== 'GET' && (init?.headers as Record<string, string>)['X-CSRF-Token'] !== 'test-token') return err(403, 'forbidden')

    if (path === '/auth/me') return json({ user })
    if (path === '/profile' && method === 'GET') return json({ data: db.profile, updatedAt: '2026-10-24T08:00:00Z' })
    if (path === '/profile' && method === 'PUT') {
      db.profile = body.data as ProfileData
      db.puts.push(db.profile)
      return json({ data: db.profile, updatedAt: '2026-10-24T08:05:00Z' })
    }
    if (path === '/cvs' && method === 'GET') return json({ cvs: [...db.cvs.values()].map((c) => ({ id: c.id, title: c.title, kind: c.kind, template: c.settings.template, createdAt: c.createdAt, updatedAt: c.updatedAt })) })
    if (path === '/cvs' && method === 'POST') {
      const id = `CV${db.cvs.size + 1}`
      const now = new Date().toISOString()
      const cv = { id, title: String(body.title), kind: 'base' as const, settings: defaultSettings(), data: structuredClone(db.profile), createdAt: now, updatedAt: now }
      db.cvs.set(id, cv)
      return json({ cv: { ...cv, template: cv.settings.template } }, 201)
    }
    const m = /^\/cvs\/([^/]+)(\/versions)?$/.exec(path)
    if (m && !m[2]) {
      const cv = db.cvs.get(m[1]!)
      if (!cv) return err(404, 'not_found')
      if (method === 'GET') return json({ cv: { ...cv, template: cv.settings.template } })
      if (method === 'PUT') {
        Object.assign(cv, { title: body.title, settings: body.settings, data: body.data })
        return json({ cv: { ...cv, template: cv.settings.template } })
      }
    }
    if (m && m[2] && method === 'GET') return json({ versions: [] })
    return err(404, 'not_found')
  }
  return { db, handler }
}

describe('parcours principal : connexion → profil → CV → export PDF', () => {
  const api = fakeApi()

  beforeEach(() => {
    resetCsrf()
    downloadBlob.mockReset()
    vi.stubGlobal('fetch', vi.fn(api.handler))
    window.history.pushState({}, '', '/connexion')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('permet de créer un profil, produire un CV et l’exporter', async () => {
    const user = userEvent.setup()
    render(<App />)

    // 1. Connexion
    await user.type(await screen.findByLabelText('Adresse e-mail'), 'camille@example.test')
    await user.type(screen.getByLabelText('Mot de passe'), 'une phrase de passe solide')
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Mes CV' })).toBeInTheDocument()
    expect(screen.getByText('Bonjour Camille.')).toBeInTheDocument()

    // Profil vide : on ne peut pas encore créer de CV.
    expect(screen.getByRole('button', { name: /Nouveau CV/ })).toBeDisabled()

    // 2. Renseigner le profil (autosauvegarde)
    await user.click(screen.getByRole('link', { name: 'Renseigner mon profil' }))
    await user.type(await screen.findByLabelText('Prénom'), 'Camille')
    await user.type(screen.getByLabelText('Nom', { exact: true }), 'Exemple')
    await user.type(screen.getByLabelText('Titre professionnel'), 'Cheffe de projet')
    await waitFor(() => expect(api.db.puts.at(-1)?.identity.lastName).toBe('Exemple'), { timeout: 4000 })
    expect(api.db.puts.at(-1)?.identity.headline).toBe('Cheffe de projet')

    // 3. Créer un CV depuis le profil
    await user.click(within(screen.getByRole('navigation', { name: 'Principale' })).getByRole('link', { name: 'Mes CV' }))
    const create = await screen.findByRole('button', { name: /Nouveau CV/ })
    await waitFor(() => expect(create).toBeEnabled())
    await user.click(create)
    const dialog = await screen.findByRole('dialog', { name: 'Nouveau CV' })
    await user.type(within(dialog).getByLabelText('Nom du CV'), 'Mon CV')
    await user.click(within(dialog).getByRole('button', { name: 'Créer' }))

    // 4. L'éditeur affiche le CV (copie du profil) et son aperçu
    const title = await screen.findByLabelText('Nom du CV')
    expect(title).toHaveValue('Mon CV')
    // L'aperçu se monte un instant après le formulaire (chargements à la demande) : on l'attend.
    expect(await screen.findByTestId('pdf-pages', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByLabelText('Prénom')).toHaveValue('Camille')

    // 5. Export PDF
    await user.click(screen.getByRole('button', { name: 'Exporter' }))
    await user.click(screen.getByRole('menuitem', { name: /^PDF/ }))
    expect(downloadBlob).toHaveBeenCalledTimes(1)
    expect(downloadBlob.mock.calls[0]![1]).toBe('mon-cv.pdf')
  })

  it('redirige vers la connexion quand il n’y a pas de session', async () => {
    api.db.loggedIn = false
    window.history.pushState({}, '', '/profil')
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Se connecter' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/connexion')
  })
})
