import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { readDraft, useAutosave } from './useAutosave'

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('regroupe les modifications rapprochées en un seul envoi', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 500 }))

    act(() => result.current.touch('a'))
    act(() => result.current.touch('ab'))
    act(() => result.current.touch('abc'))
    expect(result.current.status).toBe('dirty')
    expect(save).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('abc')
    expect(result.current.status).toBe('saved')
  })

  it('renvoie la dernière valeur si l’utilisateur écrit pendant l’envoi', async () => {
    let release!: () => void
    const save = vi
      .fn<(v: string) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 100 }))

    act(() => result.current.touch('v1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(result.current.status).toBe('saving')

    act(() => result.current.touch('v2')) // pendant l'envoi de v1
    await act(async () => {
      release()
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(save.mock.calls.map((c) => c[0])).toEqual(['v1', 'v2'])
    expect(result.current.status).toBe('saved')
  })

  it('passe en erreur puis réessaie avec flush()', async () => {
    const save = vi.fn<(v: string) => Promise<void>>().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 50 }))

    act(() => result.current.touch('x'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(result.current.status).toBe('error')

    await act(async () => {
      await result.current.flush()
    })
    expect(save).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('saved')
  })

  it('flush() échoue (not_saved) si l’envoi échoue encore : l’action dépendante s’arrête', async () => {
    const save = vi.fn<(v: string) => Promise<void>>().mockRejectedValue(new Error('réseau'))
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 50 }))
    act(() => result.current.touch('x'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    let error: unknown = null
    await act(async () => {
      await result.current.flush().catch((e: unknown) => (error = e))
    })
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('not_saved')
    expect(save).toHaveBeenCalledTimes(2) // un seul nouvel essai, pas de boucle
  })

  it('flush() attend aussi la modification arrivée pendant l’envoi en cours', async () => {
    const releases: (() => void)[] = []
    const save = vi.fn<(v: string) => Promise<void>>().mockImplementation(() => new Promise<void>((r) => releases.push(r)))
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 100 }))

    act(() => result.current.touch('v1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    act(() => result.current.touch('v2')) // pendant l'envoi de v1

    let done = false
    let flushing!: Promise<void>
    act(() => {
      flushing = result.current.flush().then(() => {
        done = true
      })
    })
    await act(async () => {
      releases[0]!() // v1 enregistrée : v2 part, flush() ne doit pas rendre la main
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(save.mock.calls.map((c) => c[0])).toEqual(['v1', 'v2'])
    expect(done).toBe(false)

    await act(async () => {
      releases[1]!()
      await flushing
    })
    expect(done).toBe(true)
    expect(result.current.status).toBe('saved')
  })

  it('flush() échoue tant qu’un conflit n’est pas résolu', async () => {
    const save = vi.fn<(v: string) => Promise<void>>().mockRejectedValueOnce(new ApiError(409, 'conflict', 'x', {}, { revision: 2 }))
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 20 }))
    act(() => result.current.touch('a'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    await act(async () => {
      await expect(result.current.flush()).rejects.toMatchObject({ code: 'not_saved' })
    })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('n’envoie pas une valeur invalide, garde un brouillon local, puis reprend une fois corrigée', async () => {
    localStorage.clear()
    const save = vi.fn().mockResolvedValue(undefined)
    const validate = (v: string) => (v.includes('!') ? [{ path: 'title', message: 'Interdit.' }] : [])
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 50, validate, draftKey: 'k-test' }))

    act(() => result.current.touch('mauvais!'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(save).not.toHaveBeenCalled()
    expect(result.current.status).toBe('invalid')
    expect(result.current.issues).toEqual([{ path: 'title', message: 'Interdit.' }])
    expect(readDraft<string>('k-test')?.value).toBe('mauvais!')

    act(() => result.current.touch('correct'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(save).toHaveBeenCalledWith('correct')
    expect(result.current.status).toBe('saved')
    expect(result.current.issues).toEqual([])
    expect(readDraft('k-test')).toBeNull()
  })

  it('suspend l’envoi sur un conflit (409) jusqu’à décision, puis reprend', async () => {
    const save = vi
      .fn<(v: string) => Promise<void>>()
      .mockRejectedValueOnce(new ApiError(409, 'conflict', 'x', {}, { revision: 7 }))
      .mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 20 }))

    act(() => result.current.touch('a'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(result.current.status).toBe('conflict')
    expect(result.current.conflict).toEqual({ current: { revision: 7 } })

    act(() => result.current.touch('ab')) // la saisie continue sans renvoyer pendant le conflit
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(save).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.resume()
    })
    expect(save).toHaveBeenLastCalledWith('ab')
    expect(result.current.status).toBe('saved')
  })

  it('reset() abandonne la valeur en attente (document remplacé par une restauration)', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<string>({ save, delay: 100 }))
    act(() => result.current.touch('ancien'))
    act(() => result.current.reset())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(save).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('envoie une modification en attente quand l’écran est quitté', () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result, unmount } = renderHook(() => useAutosave<string>({ save, delay: 10_000 }))
    act(() => result.current.touch('dernier'))
    unmount()
    expect(save).toHaveBeenCalledWith('dernier')
  })
})
