import type { CvLocale } from './cv'

const MONTHS: Record<CvLocale, string[]> = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}

export const PRESENT_LABEL: Record<CvLocale, string> = { fr: 'Présent', en: 'Present' }

/** "2021-03" → "mars 2021", "2021" → "2021". Valeur vide ou invalide → "". */
export function formatMonth(value: string | null | undefined, locale: CvLocale = 'fr'): string {
  if (!value) return ''
  const m = /^(\d{4})(?:-(0[1-9]|1[0-2]))?$/.exec(value)
  if (!m) return ''
  return m[2] ? `${MONTHS[locale][Number(m[2]) - 1]} ${m[1]}` : m[1]!
}

/**
 * Période affichée sur le CV : "mars 2021 – Présent", "2017 – 2021".
 * `current` (ou une fin `null`) affiche « Présent ».
 */
export function formatPeriod(start: string, end: string | null, current: boolean, locale: CvLocale = 'fr'): string {
  const s = formatMonth(start, locale)
  const e = current || end === null ? (s ? PRESENT_LABEL[locale] : '') : formatMonth(end, locale)
  if (s && e) return s === e ? s : `${s} – ${e}`
  return s || e
}

/** Index de mois d'un "YYYY-MM" (les années seules ne sont pas acceptées ici). */
export function monthIndex(value: string): number | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value)
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null
}
