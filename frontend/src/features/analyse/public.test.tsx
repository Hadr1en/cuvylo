import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import { resetCsrf } from '@/api/client'
import { resetInstanceCache } from '@/hooks/useInstance'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Instance installée, visiteur sans session. */
function stub(opts: { registrationOpen: boolean }) {
  const paths: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api/, '')
      paths.push(path)
      if (path === '/setup') return json({ needed: false, configured: false })
      if (path === '/auth/me') return json({ error: { code: 'unauthenticated', message: 'x' } }, 401)
      if (path === '/instance')
        return json({
          registration: { open: opts.registrationOpen, inviteRequired: false },
          legal: { publisher: null, contactEmail: 'c@example.test', host: 'H', securityEmail: null, policyVersion: '2026-10-24' },
          retention: { sessionIdleMinutes: 10080, sessionMaxDays: 30, loginAttemptsHours: 24 },
        })
      return json({ error: { code: 'not_found', message: 'x' } }, 404)
    }),
  )
  return paths
}

describe('analyse ATS sans compte', () => {
  beforeEach(() => {
    resetCsrf()
    resetInstanceCache()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('l’accueil d’un visiteur sans compte est l’analyse publique, gratuite et sans collecte', async () => {
    const paths = stub({ registrationOpen: false })
    window.history.pushState({}, '', '/')
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: /bien lu par les logiciels de recrutement/ })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/analyser')
    const promises = screen.getByRole('list', { name: 'Engagements' })
    expect(within(promises).getByText('Gratuit')).toBeInTheDocument()
    expect(within(promises).getByText('Sans compte')).toBeInTheDocument()
    expect(within(promises).getByText('Aucune publicité, aucun e-mail collecté')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choisir un fichier' })).toBeInTheDocument()

    // Inscriptions sur invitation : pas de bouton « Créer un compte », une explication à la place.
    expect(await screen.findByText(/créés sur invitation/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Créer un compte' })).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Se connecter' }).length).toBeGreaterThan(0)
    // Aucune route réservée aux comptes n'est appelée.
    expect(paths.filter((p) => !['/setup', '/auth/me', '/instance'].includes(p))).toEqual([])
  })

  it('inscriptions ouvertes : la page propose de créer un compte', async () => {
    stub({ registrationOpen: true })
    window.history.pushState({}, '', '/analyser')
    render(<App />)
    expect((await screen.findAllByRole('link', { name: 'Créer un compte' })).length).toBeGreaterThan(0)
  })

  it('la connexion propose l’analyse sans compte', async () => {
    stub({ registrationOpen: false })
    window.history.pushState({}, '', '/connexion')
    render(<App />)
    expect(await screen.findByRole('link', { name: 'Analyser un PDF sans compte' })).toHaveAttribute('href', '/analyser')
  })
})
