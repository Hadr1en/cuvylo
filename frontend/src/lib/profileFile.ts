import { ProfileSchema, migrateProfile, type ProfileData } from '@/domain/profile'

const FORMAT = 'cuvylo-profile'

export interface ProfileFile {
  format: typeof FORMAT
  version: 1
  exportedAt: string
  data: ProfileData
}

export function serializeProfile(data: ProfileData, now = new Date()): string {
  const file: ProfileFile = { format: FORMAT, version: 1, exportedAt: now.toISOString(), data }
  return JSON.stringify(file, null, 2)
}

export type ParseResult = { ok: true; data: ProfileData } | { ok: false; error: string }

/**
 * Lit un fichier de sauvegarde. Accepte l'enveloppe `{ format, version, data }`
 * ou un profil brut. Rien n'est repris sans passer le schéma strict.
 */
export function parseProfileFile(text: string): ParseResult {
  if (text.length > 500_000) return { ok: false, error: 'Fichier trop volumineux.' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Ce fichier n’est pas un JSON valide.' }
  }
  const candidate =
    raw && typeof raw === 'object' && 'format' in raw
      ? (raw as { format: unknown; version?: unknown; data?: unknown })
      : null
  if (candidate && (candidate.format !== FORMAT || candidate.version !== 1)) {
    return { ok: false, error: 'Format de fichier non reconnu.' }
  }
  // Les sauvegardes v1 (avant missions, projets…) sont migrées sans perte.
  const parsed = ProfileSchema.safeParse(migrateProfile(candidate ? candidate.data : raw))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: `Profil invalide (${issue?.path.join('.') || 'racine'} : ${issue?.message ?? 'valeur inattendue'}).` }
  }
  return { ok: true, data: parsed.data }
}
