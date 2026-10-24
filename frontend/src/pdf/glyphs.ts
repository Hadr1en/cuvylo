import { PDF_GLYPH_RANGES } from './glyphs.generated'

/**
 * Vrai si toutes les polices embarquées dans les PDF savent dessiner ce caractère.
 * La table est calculée depuis les fichiers de police eux-mêmes (scripts/build-pdf-fonts.mjs) :
 * elle ne peut pas diverger de ce qui est réellement imprimé.
 */
export function canRender(ch: string): boolean {
  const cp = ch.codePointAt(0)
  if (cp === undefined) return false
  if (cp === 0x0a || cp === 0x09) return true
  let lo = 0
  let hi = PDF_GLYPH_RANGES.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [a, b] = PDF_GLYPH_RANGES[mid]!
    if (cp < a) hi = mid - 1
    else if (cp > b) lo = mid + 1
    else return true
  }
  return false
}
