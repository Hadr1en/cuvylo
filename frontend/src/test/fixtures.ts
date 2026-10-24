import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { migrateProfile, type ProfileData } from '@/domain/profile'

/**
 * Profil fictif partagé avec les tests PHP (shared/fixtures/sample-profile.json, format v1),
 * migré en v2 comme le ferait l'application. Vitest s'exécute depuis frontend/.
 */
export function sampleProfile(): ProfileData {
  const file = resolve(process.cwd(), '../shared/fixtures/sample-profile.json')
  return migrateProfile(JSON.parse(readFileSync(file, 'utf8'))) as ProfileData
}

/** Profil v2 complet : missions, activité parallèle, projets, publications, rubrique libre. */
export function sampleProfileV2(): ProfileData {
  const file = resolve(process.cwd(), '../shared/fixtures/sample-profile-v2.json')
  return JSON.parse(readFileSync(file, 'utf8')) as ProfileData
}
