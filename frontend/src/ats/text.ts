/** Utilitaires de texte partagés par les règles ATS. Fonctions pures. */
import { canRender } from '@/pdf/glyphs'

/** Minuscules, sans accents, sans caractères invisibles, espaces normalisés. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // accents (marques combinantes après NFD)
    .replace(/\p{Cf}/gu, '') // invisibles : espaces de largeur nulle, joiners, BOM, trait d'union conditionnel
    .replace(/[\p{Pi}\p{Pf}]/gu, (q) => (q === '‘' || q === '’' ? "'" : q))
    .replace(/\p{Pd}/gu, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Comme `normalize`, sans aucune espace : robuste aux retours à la ligne et espacements d'extraction. */
export function compact(text: string): string {
  return normalize(text).replace(/\s+/g, '')
}

/**
 * Vrai si toutes les polices embarquées dans les PDF savent dessiner ce caractère.
 * Délègue à `canRender`, table calculée depuis les fichiers de police eux-mêmes :
 * « Łukasz Dvořák » passe, emoji, flèches et coches sont signalés.
 * Le retour chariot (fin de ligne Windows collée) n'est jamais imprimé : il est toléré.
 */
export function isSupportedChar(ch: string): boolean {
  return ch === '\r' || canRender(ch)
}

/** Caractères non pris en charge, dédoublonnés, dans l'ordre d'apparition. */
export function unsupportedChars(text: string): string[] {
  const seen = new Set<string>()
  for (const ch of text) if (!isSupportedChar(ch)) seen.add(ch)
  return [...seen]
}

/** Représentation lisible d'un caractère exotique pour un message ("✓" reste "✓", invisibles → U+200B). */
export function describeChar(ch: string): string {
  const c = ch.codePointAt(0) ?? 0
  const hex = `U+${c.toString(16).toUpperCase().padStart(4, '0')}`
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(ch) ? `« ${ch} » (${hex})` : hex
}

/**
 * Anomalies typiques d'une extraction de texte dégradée :
 * ligatures non décomposées, caractère de remplacement, zone d'usage privé,
 * caractères de largeur nulle.
 */
export function extractionArtifacts(text: string): string[] {
  const found = new Set<string>()
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if ((c >= 0xfb00 && c <= 0xfb06) || c === 0xfffd || (c >= 0xe000 && c <= 0xf8ff) || (c >= 0x200b && c <= 0x200d) || c === 0xfeff) {
      found.add(ch)
    }
  }
  return [...found]
}

/** Détecte du texte « espacé lettre par lettre » ("E X P É R I E N C E"), signe d'une extraction cassée. */
export function hasLetterSpacedText(text: string): boolean {
  return /(?:^|\s)(?:\p{L}\s){5,}\p{L}(?:\s|$)/u.test(text)
}

/** Part de lettres majuscules parmi les lettres (0 si aucune). */
export function upperRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? []
  if (letters.length === 0) return 0
  const upper = letters.filter((l) => l === l.toUpperCase() && l !== l.toLowerCase())
  return upper.length / letters.length
}

export function wordCount(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length
}

/** "https://www.example.com/in/x/" → "example.com/in/x" : forme affichée dans le PDF (voir CvDocument). */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
}

/** Chiffres seuls d'une chaîne (comparaison de numéros de téléphone). */
export function digitsOnly(text: string): string {
  return text.replace(/\D/g, '')
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Téléphone plausible : 8 à 15 chiffres, séparateurs usuels uniquement. */
export function isPlausiblePhone(value: string): boolean {
  if (!/^[+()\d\s.\-/]+$/.test(value)) return false
  const digits = value.replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15
}
