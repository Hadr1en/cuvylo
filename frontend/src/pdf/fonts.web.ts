import { FONT_FILES, registerFonts, type FontFiles } from './fonts'

// Vite fournit l'URL publique (hachée) de chaque fichier de police.
const urls = import.meta.glob('./fonts/*.ttf', { query: '?url', import: 'default', eager: true }) as Record<string, string>

/** Enregistre les polices avec les URLs fournies par Vite (navigateur). */
export function registerWebFonts(): void {
  const files = Object.fromEntries(FONT_FILES.map((f) => [f, urls[`./fonts/${f}.ttf`]!])) as FontFiles
  registerFonts(files)
}
