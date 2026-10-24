import { MIN_SCALE } from '@/pdf/themes'

/**
 * Ajustement automatique « tenir en 1 / 2 pages » : recherche par dichotomie de la plus grande échelle
 * (≤ 1) pour laquelle le VRAI rendu tient dans le nombre de pages demandé. Le plancher de lisibilité
 * (`MIN_SCALE`, défini avec les thèmes) n'est jamais franchi : si le CV ne tient pas même au plancher,
 * le résultat le dit (`reached: false`) au lieu de rendre un texte illisible.
 */

export interface FitOptions {
  /** Plancher de lisibilité (défaut : `MIN_SCALE`). Jamais en dessous de 0,5. */
  floor?: number
  /** Nombre maximal de mesures (rendus), 7 au plus (défaut 7). */
  maxMeasurements?: number
  /** Écart d'échelle en dessous duquel on arrête de chercher (défaut 0,005). */
  tolerance?: number
  /** Pages déjà mesurées à l'échelle 1 (évite un rendu si l'appelant les connaît). */
  pagesAtMax?: number
}

export interface FitResult {
  /** Plus grande échelle trouvée qui tient (ou le plancher si rien ne tient). */
  scale: number
  /** Pages mesurées à cette échelle. */
  pages: number
  /** Vrai si le nombre de pages demandé est atteint. */
  reached: boolean
  /** Nombre de rendus effectués. */
  measurements: number
}

export const MAX_MEASUREMENTS = 7

const round3 = (n: number) => Math.round(n * 1000) / 1000

export async function findFitScale(measure: (scale: number) => Promise<number>, target: 1 | 2, opts: FitOptions = {}): Promise<FitResult> {
  const floor = round3(Math.min(1, Math.max(0.5, opts.floor ?? MIN_SCALE)))
  const budget = Math.max(2, Math.min(MAX_MEASUREMENTS, opts.maxMeasurements ?? MAX_MEASUREMENTS))
  const tolerance = opts.tolerance ?? 0.005
  let measurements = 0
  const cache = new Map<number, number>()

  const pagesAt = async (scale: number): Promise<number> => {
    const cached = cache.get(scale)
    if (cached !== undefined) return cached
    if (measurements >= budget) throw new Error('Budget de mesures dépassé')
    measurements++
    const pages = await measure(scale)
    if (!Number.isFinite(pages) || pages < 0) throw new Error(`Mesure invalide : ${pages}`)
    cache.set(scale, pages)
    return pages
  }

  if (opts.pagesAtMax !== undefined) cache.set(1, opts.pagesAtMax)
  const atMax = await pagesAt(1)
  if (atMax <= target) return { scale: 1, pages: atMax, reached: true, measurements }
  if (floor >= 1) return { scale: 1, pages: atMax, reached: false, measurements }

  const atFloor = await pagesAt(floor)
  if (atFloor > target) return { scale: floor, pages: atFloor, reached: false, measurements }

  let lo = floor
  let loPages = atFloor
  let hi = 1
  while (measurements < budget && hi - lo > tolerance) {
    const mid = round3((lo + hi) / 2)
    if (mid <= lo || mid >= hi) break
    const p = await pagesAt(mid)
    if (p <= target) {
      lo = mid
      loPages = p
    } else {
      hi = mid
    }
  }
  return { scale: lo, pages: loPages, reached: true, measurements }
}
