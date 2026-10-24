import { describe, expect, it } from 'vitest'
import { MIN_SCALE } from '@/pdf/themes'
import { findFitScale, MAX_MEASUREMENTS } from './index'

/** Faux moteur de rendu : le contenu occupe `height` pages à l'échelle 1, proportionnellement à l'échelle² (texte et interlignes). */
function fakeMeasure(height: number) {
  const calls: number[] = []
  const measure = async (scale: number) => {
    calls.push(scale)
    return Math.ceil(height * scale * scale - 1e-9)
  }
  return { measure, calls }
}

describe('findFitScale', () => {
  it('rien à faire si le CV tient déjà : une seule mesure, échelle 1', async () => {
    const { measure, calls } = fakeMeasure(0.9)
    expect(await findFitScale(measure, 1)).toEqual({ scale: 1, pages: 1, reached: true, measurements: 1 })
    expect(calls).toEqual([1])
  })

  it('trouve la plus grande échelle qui tient, en 7 mesures au plus', async () => {
    const { measure, calls } = fakeMeasure(1.2) // tient sous √(1/1,2) ≈ 0,913
    const r = await findFitScale(measure, 1)
    expect(r.reached).toBe(true)
    expect(r.pages).toBe(1)
    expect(r.scale).toBeLessThanOrEqual(0.9129)
    expect(r.scale).toBeGreaterThan(0.9129 - 0.01)
    expect(calls.length).toBeLessThanOrEqual(MAX_MEASUREMENTS)
    expect(r.measurements).toBe(calls.length)
    expect(new Set(calls).size).toBe(calls.length) // jamais deux fois la même échelle
  })

  it('respecte le plancher de lisibilité partagé avec les thèmes', async () => {
    expect(MIN_SCALE).toBe(0.84)
    const { measure, calls } = fakeMeasure(1.6) // il faudrait 0,79
    const r = await findFitScale(measure, 1)
    expect(r).toEqual({ scale: MIN_SCALE, pages: 2, reached: false, measurements: 2 })
    expect(Math.min(...calls)).toBe(MIN_SCALE)
  })

  it('cible 2 pages', async () => {
    const { measure } = fakeMeasure(2.3)
    const r = await findFitScale(measure, 2)
    expect(r.reached).toBe(true)
    expect(r.pages).toBe(2)
    expect(r.scale).toBeGreaterThan(0.92)
    expect(r.scale).toBeLessThanOrEqual(Math.sqrt(2 / 2.3))
  })

  it('cas limite : tient exactement au plancher', async () => {
    const { measure } = fakeMeasure(1 / (0.84 * 0.84))
    const r = await findFitScale(measure, 1)
    expect(r.reached).toBe(true)
    expect(r.scale).toBeGreaterThanOrEqual(0.84)
  })

  it('pages déjà connues à l’échelle 1 : pas de rendu à 1, la mesure économisée affine la recherche', async () => {
    const { measure, calls } = fakeMeasure(1.2)
    const r = await findFitScale(measure, 1, { pagesAtMax: 2 })
    expect(calls).not.toContain(1)
    expect(r.reached).toBe(true)
    expect(calls.length).toBeLessThanOrEqual(MAX_MEASUREMENTS)
    expect(r.scale).toBeGreaterThan(0.9129 - 0.006)
    // Déjà dans la cible : aucun rendu.
    const fits = fakeMeasure(0.8)
    expect(await findFitScale(fits.measure, 1, { pagesAtMax: 1 })).toMatchObject({ scale: 1, measurements: 0 })
  })

  it('budget et plancher personnalisés', async () => {
    const { measure, calls } = fakeMeasure(1.2)
    const r = await findFitScale(measure, 1, { maxMeasurements: 4, floor: 0.9 })
    expect(calls.length).toBeLessThanOrEqual(4)
    expect(calls).toContain(0.9)
    expect(r.scale).toBeGreaterThanOrEqual(0.9)
    // Le budget ne dépasse jamais 7, même si on le demande.
    const big = fakeMeasure(1.2)
    await findFitScale(big.measure, 1, { maxMeasurements: 50, tolerance: 0 })
    expect(big.calls.length).toBeLessThanOrEqual(7)
  })

  it('propage une erreur ou une annulation du rendu, refuse une mesure invalide', async () => {
    await expect(findFitScale(async () => Promise.reject(new Error('annulé')), 1)).rejects.toThrow('annulé')
    await expect(findFitScale(async () => Number.NaN, 1)).rejects.toThrow('Mesure invalide')
  })
})
