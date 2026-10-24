import type { ProfileData } from '@/domain/profile'
import type { ParseResult } from '@/lib/profileFile'

/** Sauvegarde Cuvylo ou JSON Resume (.json), export de données LinkedIn (.zip). */
export const IMPORT_ACCEPT = 'application/json,.json,application/zip,.zip'

export type ImportResult = { ok: true; data: ProfileData; source: string; notes: string[] } | { ok: false; error: string }

/**
 * Choisit l'importeur d'après le fichier : sauvegarde Cuvylo, JSON Resume ou archive
 * « Obtenir une copie de vos données » de LinkedIn. Tout se passe dans le navigateur.
 * Les importeurs lourds (décompression) ne sont chargés qu'à l'usage.
 */
export async function importFile(file: File, parseProfileFile: (text: string) => ParseResult): Promise<ImportResult> {
  if (file.size > 20 * 1024 * 1024) return { ok: false, error: 'Fichier trop volumineux (20 Mo au plus).' }

  if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
    try {
      const { importLinkedInZip } = await import('@/import/linkedin')
      const r = await importLinkedInZip(new Uint8Array(await file.arrayBuffer()))
      return { ok: true, data: r.data, source: 'l’export LinkedIn', notes: r.notes }
    } catch (e) {
      return { ok: false, error: e instanceof Error && e.message ? e.message : 'Archive LinkedIn illisible.' }
    }
  }

  const text = await file.text()
  const own = parseProfileFile(text)
  if (own.ok) return { ok: true, data: own.data, source: 'une sauvegarde Cuvylo', notes: [] }

  // Pas une sauvegarde Cuvylo : peut-être un JSON Resume (format ouvert).
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return own
  }
  if (json && typeof json === 'object' && ('basics' in json || 'work' in json)) {
    try {
      const { fromJsonResume } = await import('@/import/jsonresume')
      const r = fromJsonResume(json)
      return { ok: true, data: r.data, source: 'un fichier JSON Resume', notes: r.notes }
    } catch (e) {
      return { ok: false, error: e instanceof Error && e.message ? e.message : 'Fichier JSON Resume illisible.' }
    }
  }
  return own
}
