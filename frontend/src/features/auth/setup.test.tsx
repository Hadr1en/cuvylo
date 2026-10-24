import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import { resetCsrf } from '@/api/client'
import { resetInstanceCache } from '@/hooks/useInstance'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** API minimale : instance neuve ou installée, installation, demande de réinitialisation. */
function stub(opts: { needed: boolean; configured?: boolean; byEmail?: boolean }) {
  const calls: { path: string; body: unknown }[] = []
  let loggedIn = false
  const admin = { id: 'u1', email: 'owner@example.test', displayName: null, createdAt: '2026-10-24T08:00:00Z', isAdmin: true, mfaEnabled: false }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api/, '')
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined
      calls.push({ path, body })
      if (path === '/csrf') return json({ csrfToken: 't' })
      if (path === '/instance')
        return json({
          registration: { open: false, inviteRequired: false },
          legal: { publisher: null, contactEmail: 'c@example.test', host: 'H', securityEmail: null, policyVersion: '2026-10-24' },
          retention: { sessionIdleMinutes: 10080, sessionMaxDays: 30, loginAttemptsHours: 24 },
          features: { passwordResetByEmail: opts.byEmail ?? false },
        })
      if (path === '/setup' && init?.method === 'POST') {
        loggedIn = true
        return json({ user: admin, csrfToken: 't2' }, 201)
      }
      if (path === '/setup') return json({ needed: opts.needed, configured: opts.configured ?? true })
      if (path === '/auth/reset-request') return new Response(null, { status: 204 })
      if (path === '/auth/me') return loggedIn ? json({ user: admin }) : json({ error: { code: 'unauthenticated' } }, 401)
      if (path === '/admin/overview') return json({ users: [{ ...admin, lastLoginAt: null, bytes: 1000, cvs: 0, resetRequestedAt: null }], totals: { users: 1, cvs: 0, versions: 0, bytes: 1000 }, databaseBytes: null })
      if (path === '/admin/invitations') return json({ invitations: [] })
      if (path === '/admin/settings') return json(body ?? { registrationOpen: false })
      return json({ error: { code: 'not_found' } }, 404)
    }),
  )
  return calls
}

/** Serveur sans configuration : seules les routes de l'assistant répondent, jusqu'à l'installation. */
function stubInstaller(opts: { written?: boolean } = {}) {
  const calls: { path: string; method: string; body: unknown; headers: Record<string, string> }[] = []
  let installed = false
  const admin = { id: 'u1', email: 'owner@example.test', displayName: 'Camille', createdAt: '2026-10-24T08:00:00Z', isAdmin: true, mfaEnabled: false }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api/, '')
      const method = init?.method ?? 'GET'
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
      calls.push({ path, method, body, headers: (init?.headers ?? {}) as Record<string, string> })
      if (!installed) {
        if (path === '/setup') return json({ needed: true, configured: false, installer: true })
        if (path === '/install' && method === 'GET')
          return json({ checks: [{ id: 'php', ok: true, detail: '8.5.0' }, { id: 'pdo_mysql', ok: true }, { id: 'writable', ok: true }] })
        if (path === '/install/database') {
          const db = (body as { database: { password: string } }).database
          return db.password === 'bon-mot-de-passe' ? new Response(null, { status: 204 }) : json({ error: { code: 'validation_failed', message: 'x', fields: { database: 'access_denied' } } }, 422)
        }
        if (path === '/install' && method === 'POST') {
          installed = opts.written ?? true
          return opts.written === false
            ? json({ written: false, existingAccounts: false, envFile: 'APP_URL="http://localhost"\n' })
            : json({ written: true, existingAccounts: false }, 201)
        }
        return json({ error: { code: 'not_installed', message: 'Cuvylo n’est pas encore installé.' } }, 503)
      }
      if (path === '/csrf') return json({ csrfToken: 't' })
      if (path === '/auth/login') return json({ user: admin, csrfToken: 't2' })
      if (path === '/instance')
        return json({
          registration: { open: false, inviteRequired: false },
          legal: { publisher: null, contactEmail: 'c@example.test', host: 'H', securityEmail: null, policyVersion: '2026-10-24' },
          retention: { sessionIdleMinutes: 10080, sessionMaxDays: 30, loginAttemptsHours: 24 },
        })
      if (path === '/admin/overview') return json({ users: [{ ...admin, lastLoginAt: null, bytes: 0, cvs: 0, resetRequestedAt: null }], totals: { users: 1, cvs: 0, versions: 0, bytes: 0 }, databaseBytes: null })
      if (path === '/admin/invitations') return json({ invitations: [] })
      if (path === '/admin/settings') return json({ registrationOpen: false })
      return json({ error: { code: 'not_found' } }, 404)
    }),
  )
  return calls
}

describe('assistant d’installation (serveur sans configuration)', () => {
  beforeEach(() => {
    resetCsrf()
    resetInstanceCache()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('de la première visite à l’administration, sans fichier à éditer', async () => {
    const user = userEvent.setup()
    const calls = stubInstaller()
    window.history.pushState({}, '', '/')
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Bienvenue dans Cuvylo' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/installation')
    expect(await screen.findByText('PHP 8.1 ou plus récent')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Commencer' }))

    // Base : une erreur d'accès est expliquée en clair, puis corrigée.
    expect(await screen.findByRole('heading', { level: 1, name: 'Base de données' })).toHaveFocus()
    await user.type(screen.getByLabelText('Serveur'), 'sql.example.test')
    await user.type(screen.getByLabelText('Nom de la base'), 'cuvylo')
    await user.type(screen.getByLabelText('Utilisateur'), 'cuvylo')
    await user.type(screen.getByLabelText('Mot de passe de la base'), 'mauvais')
    await user.click(screen.getByRole('button', { name: 'Tester et continuer' }))
    expect(await screen.findByText('Utilisateur ou mot de passe refusé par le serveur MySQL.')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Mot de passe de la base'))
    await user.type(screen.getByLabelText('Mot de passe de la base'), 'bon-mot-de-passe')
    await user.click(screen.getByRole('button', { name: 'Tester et continuer' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Votre compte administrateur' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Nom affiché (facultatif)'), 'Camille')
    await user.type(screen.getByLabelText('Adresse e-mail'), 'owner@example.test')
    await user.type(screen.getByLabelText('Mot de passe'), 'une phrase de passe solide')
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'une phrase de passe solide')
    await user.click(screen.getByRole('button', { name: 'Continuer' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Le site' })).toBeInTheDocument()
    expect(screen.getByLabelText('Adresse du site')).toHaveValue(window.location.origin)
    expect(screen.getByLabelText('E-mail de contact')).toHaveValue('owner@example.test')
    await user.click(screen.getByRole('button', { name: 'Installer Cuvylo' }))

    await waitFor(() => expect(window.location.pathname).toBe('/admin'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Administration' })).toBeInTheDocument()
    const install = calls.find((c) => c.path === '/install' && c.method === 'POST')
    expect(install?.body).toEqual({
      appUrl: window.location.origin,
      database: { host: 'sql.example.test', name: 'cuvylo', user: 'cuvylo', password: 'bon-mot-de-passe' },
      admin: { email: 'owner@example.test', password: 'une phrase de passe solide', displayName: 'Camille' },
      legal: { publisher: '', contactEmail: 'owner@example.test', host: '' },
    })
    expect(install?.headers['X-CSRF-Token']).toBeUndefined()
    expect(calls.some((c) => c.path === '/auth/login')).toBe(true)
  })

  it('dossier non modifiable : la configuration est affichée pour être déposée à la main', async () => {
    const user = userEvent.setup()
    stubInstaller({ written: false })
    window.history.pushState({}, '', '/installation')
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Commencer' }))
    await user.type(await screen.findByLabelText('Serveur'), 'sql.example.test')
    await user.type(screen.getByLabelText('Nom de la base'), 'cuvylo')
    await user.type(screen.getByLabelText('Utilisateur'), 'cuvylo')
    await user.type(screen.getByLabelText('Mot de passe de la base'), 'bon-mot-de-passe')
    await user.click(screen.getByRole('button', { name: 'Tester et continuer' }))
    await user.type(await screen.findByLabelText('Adresse e-mail'), 'owner@example.test')
    await user.type(screen.getByLabelText('Mot de passe'), 'une phrase de passe solide')
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'une phrase de passe solide')
    await user.click(screen.getByRole('button', { name: 'Continuer' }))
    await user.click(await screen.findByRole('button', { name: 'Installer Cuvylo' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Dernière étape : le fichier de configuration' })).toBeInTheDocument()
    expect(screen.getByLabelText('Contenu du fichier .env')).toHaveValue('APP_URL="http://localhost"\n')
  })
})

describe('installation et mot de passe oublié', () => {
  beforeEach(() => {
    resetCsrf()
    resetInstanceCache()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('instance neuve : la connexion mène à l’installation, qui crée l’administrateur', async () => {
    const user = userEvent.setup()
    const calls = stub({ needed: true })
    window.history.pushState({}, '', '/connexion')
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Installation' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/installation')
    await user.type(await screen.findByLabelText('Code d’installation'), 'code-installation-de-test')
    await user.type(screen.getByLabelText('Adresse e-mail'), 'owner@example.test')
    await user.type(screen.getByLabelText('Mot de passe'), 'une phrase de passe solide')
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'une phrase de passe solide')
    await user.click(screen.getByRole('button', { name: 'Créer le compte administrateur' }))

    await waitFor(() => expect(window.location.pathname).toBe('/admin'))
    expect(calls.find((c) => c.path === '/setup' && c.body)?.body).toEqual({
      setupCode: 'code-installation-de-test',
      email: 'owner@example.test',
      password: 'une phrase de passe solide',
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Administration' })).toBeInTheDocument()
    expect(screen.queryByText(/Sauvegarde SQL/)).toBeNull()

    // Inscriptions : fermées par défaut, ouvertes d'un clic, sans éditer .env.
    const toggle = await screen.findByRole('switch', { name: 'Inscriptions ouvertes' })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    expect(calls.find((c) => c.path === '/admin/settings' && c.body)?.body).toEqual({ registrationOpen: true })
    expect(screen.getByText(/Tout le monde peut créer un compte/)).toBeInTheDocument()
  })

  it('sans SETUP_CODE, l’écran explique quoi ajouter au fichier .env', async () => {
    stub({ needed: true, configured: false })
    window.history.pushState({}, '', '/installation')
    render(<App />)
    expect(await screen.findByText(/SETUP_CODE=…/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Code d’installation')).toBeNull()
  })

  it('« Mot de passe oublié » : lien par e-mail, sans révéler si le compte existe', async () => {
    const user = userEvent.setup()
    const calls = stub({ needed: false, byEmail: true })
    window.history.pushState({}, '', '/connexion')
    render(<App />)

    await user.type(await screen.findByLabelText('Adresse e-mail'), 'ami@example.test')
    await user.click(screen.getByRole('link', { name: 'Mot de passe oublié ?' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Mot de passe oublié' })).toBeInTheDocument()
    expect(screen.getByLabelText('Adresse e-mail')).toHaveValue('ami@example.test')
    await user.click(await screen.findByRole('button', { name: 'Recevoir un lien' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Vérifiez votre boîte e-mail' })).toBeInTheDocument()
    expect(screen.getByText(/Si un compte existe pour/)).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/auth/reset-request')?.body).toEqual({ email: 'ami@example.test' })
  })

  it('sans envoi d’e-mails, la demande est transmise à la personne qui gère le site', async () => {
    const user = userEvent.setup()
    stub({ needed: false, byEmail: false })
    window.history.pushState({}, '', '/mot-de-passe-oublie')
    render(<App />)

    await user.type(await screen.findByLabelText('Adresse e-mail'), 'ami@example.test')
    await user.click(await screen.findByRole('button', { name: 'Envoyer la demande' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Demande enregistrée' })).toBeInTheDocument()
    expect(screen.getByText(/n’envoie pas d’e-mails/)).toBeInTheDocument()
  })
})
