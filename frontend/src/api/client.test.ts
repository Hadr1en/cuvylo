import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, resetCsrf } from './client'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('client API', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    resetCsrf()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('n’envoie pas de jeton CSRF sur une lecture', async () => {
    fetchMock.mockResolvedValueOnce(json({ cvs: [] }))
    await api.listCvs()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]![1]!
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBeUndefined()
  })

  it('récupère le jeton CSRF puis l’envoie sur une écriture', async () => {
    fetchMock.mockResolvedValueOnce(json({ csrfToken: 'tok1' })).mockResolvedValueOnce(json({ version: { id: 'v1', label: 'x', createdAt: '' } }, 201))
    await api.createVersion('cv1', 'x')
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/csrf')
    const init = fetchMock.mock.calls[1]![1]!
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok1')
    expect(init.credentials).toBe('same-origin')
  })

  it('envoie PUT et DELETE en POST avec X-HTTP-Method-Override (pare-feu des mutualisés)', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ csrfToken: 'tok' }))
      .mockResolvedValueOnce(json({ data: {}, updatedAt: '' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await api.putProfile({} as never)
    await api.deleteCv('cv1')
    const put = fetchMock.mock.calls[1]![1]!
    expect(put.method).toBe('POST')
    expect((put.headers as Record<string, string>)['X-HTTP-Method-Override']).toBe('PUT')
    const del = fetchMock.mock.calls[2]![1]!
    expect(del.method).toBe('POST')
    expect((del.headers as Record<string, string>)['X-HTTP-Method-Override']).toBe('DELETE')
  })

  it('un 403 non JSON est un blocage du pare-feu de l’hébergeur, sans nouvel essai', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ csrfToken: 'tok' }))
      .mockResolvedValueOnce(new Response('<html><h1>Forbidden</h1></html>', { status: 403, headers: { 'Content-Type': 'text/html' } }))
    await expect(api.putProfile({} as never)).rejects.toMatchObject({ status: 403, code: 'blocked' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('renouvelle le jeton et rejoue une fois sur un 403 « forbidden »', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ csrfToken: 'old' }))
      .mockResolvedValueOnce(json({ error: { code: 'forbidden', message: 'csrf' } }, 403))
      .mockResolvedValueOnce(json({ csrfToken: 'fresh' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await api.deleteCv('cv1')
    const last = fetchMock.mock.calls[3]![1]!
    expect((last.headers as Record<string, string>)['X-CSRF-Token']).toBe('fresh')
  })

  it('ne boucle pas : un second 403 remonte en erreur', async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(String(input).endsWith('/csrf') ? json({ csrfToken: 't' }) : json({ error: { code: 'forbidden', message: 'non' } }, 403)),
    )
    await expect(api.deleteCv('cv1')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })

  it('transforme une erreur de validation en ApiError avec ses champs', async () => {
    fetchMock.mockResolvedValueOnce(json({ csrfToken: 't' })).mockResolvedValueOnce(
      json({ error: { code: 'validation_failed', message: 'invalide', fields: { 'identity.email': 'invalid_email' } } }, 422),
    )
    const err = await api.login({ email: 'x', password: 'y' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).fields).toEqual({ 'identity.email': 'invalid_email' })
  })

  it('signale une panne réseau sans détail technique', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(api.listCvs()).rejects.toMatchObject({ code: 'network', status: 0 })
  })

  it('adopte le jeton CSRF renvoyé par la connexion (il tourne avec la session)', async () => {
    const user = { id: 'u', email: 'e', displayName: null, createdAt: '' }
    fetchMock
      .mockResolvedValueOnce(json({ csrfToken: 'a' }))
      .mockResolvedValueOnce(json({ user, csrfToken: 'b' }))
      .mockResolvedValueOnce(json({ version: { id: 'v', label: 'l', createdAt: '' } }, 201))
    await api.login({ email: 'e', password: 'p' })
    await api.createVersion('cv', 'l')
    expect(fetchMock).toHaveBeenCalledTimes(3) // pas de GET /csrf supplémentaire
    const last = fetchMock.mock.calls[2]![1]!
    expect((last.headers as Record<string, string>)['X-CSRF-Token']).toBe('b')
  })

  it('relit le jeton CSRF après connexion si la réponse n’en porte pas', async () => {
    const user = { id: 'u', email: 'e', displayName: null, createdAt: '' }
    fetchMock
      .mockResolvedValueOnce(json({ csrfToken: 'a' }))
      .mockResolvedValueOnce(json({ user }))
      .mockResolvedValueOnce(json({ csrfToken: 'c' }))
      .mockResolvedValueOnce(json({ version: { id: 'v', label: 'l', createdAt: '' } }, 201))
    await api.login({ email: 'e', password: 'p' })
    await api.createVersion('cv', 'l')
    const last = fetchMock.mock.calls[3]![1]!
    expect((last.headers as Record<string, string>)['X-CSRF-Token']).toBe('c')
  })

  it('encode l’identifiant de ressource dans l’URL', async () => {
    fetchMock.mockResolvedValueOnce(json({ cv: {} }))
    await api.getCv('../admin')
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/cvs/..%2Fadmin')
  })
})
