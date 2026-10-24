import { createElement } from 'react'
import type { CvSettings } from '@/domain/cv'
import type { ProfileData } from '@/domain/profile'
import { enqueue, loadEngines, openPdf } from './engine'

const CACHE_MAX = 48
const cache = new Map<string, string>()

/** Empreinte rapide (djb2) du contenu : clé de cache, pas une fonction de sécurité. */
function fingerprint(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** Seule la page 1 est montrée : on allège le contenu pour que la miniature se génère vite. */
export function trimForThumb(data: ProfileData): ProfileData {
  return {
    ...data,
    experiences: data.experiences.slice(0, 3).map((e) => ({ ...e, missions: e.missions.slice(0, 2) })),
    education: data.education.slice(0, 2),
    certifications: data.certifications.slice(0, 3),
    skills: data.skills.slice(0, 5),
    projects: data.projects.slice(0, 2),
    publications: data.publications.slice(0, 2),
  }
}

export function thumbKey(data: ProfileData, settings: CvSettings): string {
  // Les sauts de page ne changent pas la première page de la miniature (ils sont ignorés au rendu).
  return [JSON.stringify({ ...settings, pageBreakBefore: [] }), fingerprint(JSON.stringify(trimForThumb(data)))].join('|')
}

/**
 * Première page d'un CV, rendue avec le VRAI moteur PDF dans le modèle demandé, en miniature.
 * Chaque modèle est donc montré avec le contenu réel de l'utilisateur, pas une illustration.
 * `signal` : la miniature n'est plus utile (panneau fermé, modèle changé) → elle n'est pas générée.
 */
export function renderThumb(data: ProfileData, settings: CvSettings, width = 260, signal?: AbortSignal): Promise<string> {
  const key = thumbKey(data, settings)
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)

  return enqueue(async () => {
    const again = cache.get(key)
    if (again) return again
    const { pdf, CvDocument } = await loadEngines()
    const blob = await pdf(createElement(CvDocument, { data: trimForThumb(data), settings: { ...settings, pageBreakBefore: [], targetPages: 0 } })).toBlob()
    const open = await openPdf(new Uint8Array(await blob.arrayBuffer()))
    try {
      const page = await open.doc.getPage(1)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: (width / base.width) * dpr })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      await page.render({ canvas, viewport }).promise
      const url = canvas.toDataURL('image/jpeg', 0.88)
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
      cache.set(key, url)
      return url
    } finally {
      await open.close()
    }
  }, signal)
}
