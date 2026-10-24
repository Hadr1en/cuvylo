import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import { resetCsrf, type InstanceInfo } from '@/api/client'
import { resetInstanceCache } from '@/hooks/useInstance'

function instance(over: Partial<InstanceInfo['legal']> = {}, registration: InstanceInfo['registration'] = { open: true, inviteRequired: true }): InstanceInfo {
  return {
    registration,
    legal: { publisher: null, contactEmail: null, host: null, securityEmail: null, policyVersion: '2026-10-24', ...over },
    retention: { sessionIdleMinutes: 10080, sessionMaxDays: 30, loginAttemptsHours: 24 },
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** API minimale : instance publique, pas de session, et (option) compte connecté pour la page Compte. */
function stubApi(info: InstanceInfo, opts: { loggedIn?: boolean; onDelete?: (body: unknown) => Response } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname
    if (path === '/api/instance') return json(info)
    if (path === '/api/csrf') return json({ csrfToken: 't' })
    if (path === '/api/auth/me') {
      return opts.loggedIn ? json({ user: { id: 'u1', email: 'camille@example.test', displayName: 'Camille', createdAt: '2026-10-24T08:00:00Z' } }) : json({ error: { code: 'unauthenticated', message: 'x' } }, 401)
    }
    // DELETE part en POST + X-HTTP-Method-Override (pare-feu des mutualisés).
    const deleting = init?.method === 'POST' && (init.headers as Record<string, string> | undefined)?.['X-HTTP-Method-Override'] === 'DELETE'
    if (path === '/api/account' && deleting) return opts.onDelete ? opts.onDelete(JSON.parse(String(init.body))) : new Response(null, { status: 204 })
    if (path === '/api/cvs') return json({ cvs: [] })
    return json({ error: { code: 'not_found', message: 'x' } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('pages légales', () => {
  beforeEach(() => {
    resetCsrf()
    resetInstanceCache()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('mentions légales : éditeur, contact et hébergeur viennent de la configuration', async () => {
    stubApi(instance({ publisher: 'Camille Exemple', contactEmail: 'contact@example.test', host: 'Hébergeur Exemple, 59000 Lille' }))
    window.history.pushState({}, '', '/mentions-legales')
    render(<App />)

    expect(await screen.findByText('Camille Exemple')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'contact@example.test' })).toHaveAttribute('href', 'mailto:contact@example.test')
    expect(screen.getByText('Hébergeur Exemple, 59000 Lille')).toBeInTheDocument()
    expect(screen.getByText(/l’inscription nécessite un code/)).toBeInTheDocument()
    expect(screen.queryByText(/Configuration incomplète/)).toBeNull()
  })

  it('éditeur anonyme (particulier) : renvoi à l’article 6-III-2 de la LCEN', async () => {
    stubApi(instance({ contactEmail: 'contact@example.test', host: 'Hébergeur' }))
    window.history.pushState({}, '', '/mentions-legales')
    render(<App />)
    expect(await screen.findByText(/article 6-III-2/)).toBeInTheDocument()
  })

  it('signale une configuration incomplète au lieu d’inventer des informations', async () => {
    stubApi(instance())
    window.history.pushState({}, '', '/mentions-legales')
    render(<App />)
    expect(await screen.findByText(/Configuration incomplète/)).toBeInTheDocument()
    expect(screen.getAllByText(/à renseigner par l’exploitant/).length).toBeGreaterThan(0)
  })

  it('confidentialité : durées réelles de l’instance, cookies et droits', async () => {
    stubApi(instance({ contactEmail: 'contact@example.test', host: 'H' }))
    window.history.pushState({}, '', '/confidentialite')
    render(<App />)

    const durees = (await screen.findByRole('heading', { name: 'Durées de conservation' })).closest('section')!
    expect(within(durees).getByText(/7 jours sans activité et au plus tard après 30 jours/)).toBeInTheDocument()
    expect(within(durees).getByText(/au-delà de 24 heures/)).toBeInTheDocument()
    expect(screen.getByText('cuvylo_session')).toBeInTheDocument()
    expect(screen.getByText(/Exporter toutes mes données/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'cnil.fr' })).toHaveAttribute('href', 'https://www.cnil.fr')
  })

  it('sécurité : contact dédié et lien security.txt', async () => {
    stubApi(instance({ contactEmail: 'contact@example.test', securityEmail: 'securite@example.test', host: 'H' }))
    window.history.pushState({}, '', '/securite')
    render(<App />)
    expect(await screen.findByRole('link', { name: 'securite@example.test' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'security.txt' })).toHaveAttribute('href', '/api/security-txt')
  })

  it('la page de connexion renvoie vers les trois pages légales', async () => {
    stubApi(instance())
    window.history.pushState({}, '', '/connexion')
    render(<App />)
    // Deux pieds de page (colonne de gauche sur grand écran, bas de page sur mobile) : CSS seulement.
    const [nav] = await screen.findAllByRole('navigation', { name: 'Informations légales' })
    for (const name of ['Mentions légales', 'Confidentialité', 'Sécurité']) expect(within(nav!).getByRole('link', { name })).toBeInTheDocument()
  })

  it('le champ d’invitation n’apparaît que si l’instance l’exige', async () => {
    stubApi(instance({}, { open: true, inviteRequired: false }))
    window.history.pushState({}, '', '/inscription')
    render(<App />)
    expect(await screen.findByText(/Politique de confidentialité/)).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.queryByLabelText('Code d’invitation')).toBeNull())
  })
})

describe('page Compte', () => {
  beforeEach(() => {
    resetCsrf()
    resetInstanceCache()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('la suppression exige le mot de passe et le mot SUPPRIMER, puis renvoie à la connexion', async () => {
    const user = userEvent.setup()
    const deletions: unknown[] = []
    stubApi(instance(), {
      loggedIn: true,
      onDelete: (body) => {
        deletions.push(body)
        return new Response(null, { status: 204 })
      },
    })
    window.history.pushState({}, '', '/compte')
    render(<App />)

    // Page chargée à la demande : on laisse le temps au module d'arriver quand la suite tourne en parallèle.
    const zone = await screen.findByRole('region', { name: 'Supprimer mon compte' }, { timeout: 5000 })
    const button = within(zone).getByRole('button', { name: /Supprimer définitivement/ })
    expect(button).toBeDisabled()
    await user.type(within(zone).getByLabelText('Mot de passe actuel'), 'mon mot de passe')
    expect(button).toBeDisabled()
    await user.type(within(zone).getByLabelText('Tapez SUPPRIMER pour confirmer'), 'SUPPRIMER')
    await user.click(button)

    expect(await screen.findByText('Votre compte et toutes ses données ont été supprimés.')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/connexion')
    expect(deletions).toEqual([{ password: 'mon mot de passe' }])
  })

  it('mot de passe incorrect : message sous le champ, compte conservé', async () => {
    const user = userEvent.setup()
    stubApi(instance(), {
      loggedIn: true,
      onDelete: () => json({ error: { code: 'validation_failed', message: 'x', fields: { password: 'invalid_password' } } }, 422),
    })
    window.history.pushState({}, '', '/compte')
    render(<App />)

    const zone = await screen.findByRole('region', { name: 'Supprimer mon compte' }, { timeout: 5000 })
    await user.type(within(zone).getByLabelText('Mot de passe actuel'), 'faux')
    await user.type(within(zone).getByLabelText('Tapez SUPPRIMER pour confirmer'), 'SUPPRIMER')
    await user.click(within(zone).getByRole('button', { name: /Supprimer définitivement/ }))

    expect(await screen.findByText('Mot de passe incorrect.')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/compte')
  })
})
