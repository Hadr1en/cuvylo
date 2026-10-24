import { Font } from '@react-pdf/renderer'

/** Familles embarquées dans le PDF (texte réel, donc sélectionnable et extractible). */
export const FAMILY = {
  sans: 'Inter',
  serif: 'Newsreader',
  display: 'Bricolage Grotesque',
  mono: 'JetBrains Mono',
  plex: 'IBM Plex Sans',
  source: 'Source Sans 3',
  sourceSerif: 'Source Serif 4',
} as const

/**
 * Fichiers TTF générés par scripts/build-pdf-fonts.mjs (latin + latin étendu), dans src/pdf/fonts/.
 * Clé = nom du fichier sans extension.
 */
export const FONT_FILES = [
  'inter-400', 'inter-500', 'inter-600', 'inter-700',
  'newsreader-400', 'newsreader-400i', 'newsreader-600',
  'bricolage-700', 'bricolage-800',
  'mono-400', 'mono-700',
  'plex-400', 'plex-500', 'plex-600', 'plex-700',
  'source-400', 'source-600', 'source-700',
  'serif-400', 'serif-400i', 'serif-600',
] as const
export type FontFile = (typeof FONT_FILES)[number]
export type FontFiles = Record<FontFile, string>

let registered = false

/**
 * Enregistre les polices une seule fois. Séparé de la résolution des URLs
 * (Vite dans le navigateur, chemins disque dans les tests Node). react-pdf ne télécharge
 * un fichier que si un texte l'utilise.
 */
export function registerFonts(files: FontFiles): void {
  if (registered) return
  registered = true

  const w = (f: FontFile, fontWeight: number, fontStyle: 'normal' | 'italic' = 'normal') => ({ src: files[f], fontWeight, fontStyle })

  Font.register({ family: FAMILY.sans, fonts: [w('inter-400', 400), w('inter-500', 500), w('inter-600', 600), w('inter-700', 700)] })
  Font.register({ family: FAMILY.serif, fonts: [w('newsreader-400', 400), w('newsreader-400i', 400, 'italic'), w('newsreader-600', 600)] })
  Font.register({ family: FAMILY.display, fonts: [w('bricolage-700', 700), w('bricolage-800', 800)] })
  Font.register({ family: FAMILY.mono, fonts: [w('mono-400', 400), w('mono-700', 700)] })
  Font.register({ family: FAMILY.plex, fonts: [w('plex-400', 400), w('plex-500', 500), w('plex-600', 600), w('plex-700', 700)] })
  Font.register({ family: FAMILY.source, fonts: [w('source-400', 400), w('source-600', 600), w('source-700', 700)] })
  Font.register({ family: FAMILY.sourceSerif, fonts: [w('serif-400', 400), w('serif-400i', 400, 'italic'), w('serif-600', 600)] })

  // Pas de césure automatique : elle insère des coupures qui dégradent l'extraction du texte.
  Font.registerHyphenationCallback((word) => [word])
}
