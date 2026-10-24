import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defaultSettings, type CvSettings } from '@/domain/cv'
import { migrateProfile, newExperience, type Experience, type ProfileData } from '@/domain/profile'
import type { ExtractedPdf } from '@/pdf/extract'
import { analyzeCv, buildContext, RULES } from './index'
import type { AnalysisContext, Issue } from './types'

/**
 * Aides de test partagées par les modules logiques (ats, jobs, lint, import, export, skills, diff).
 * Réservé aux tests : lit les fixtures sur disque (Vitest s'exécute depuis frontend/).
 */

/** Date de référence des tests : 24 octobre 2026. */
export const NOW = new Date(2026, 9, 24)

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), '../shared/fixtures', name), 'utf8'))
}

/** Profil d'exemple v1 (shared/fixtures/sample-profile.json), migré en v2 comme à la lecture. */
export function sampleProfile(): ProfileData {
  return migrateProfile(readFixture('sample-profile.json')) as ProfileData
}

/** Profil d'exemple v2 : missions, activité parallèle, dates à l'année, rubrique libre. */
export function sampleProfileV2(): ProfileData {
  return readFixture('sample-profile-v2.json') as ProfileData
}

export function ctxFor(data: ProfileData = sampleProfile(), opts: { settings?: Partial<CvSettings>; pdf?: ExtractedPdf | null } = {}): AnalysisContext {
  return buildContext(data, { ...defaultSettings(), ...opts.settings }, opts.pdf ?? null, NOW)
}

/** Issues d'une seule règle. */
export function runRule(id: string, ctx: AnalysisContext): Issue[] {
  const rule = RULES.find((r) => r.id === id)
  if (!rule) throw new Error(`Règle inconnue : ${id}`)
  return rule.run(ctx)
}

export function reportFor(ctx: AnalysisContext) {
  return analyzeCv(ctx)
}

export function exp(id: string, startDate: string, endDate: string | null, extra: Partial<Experience> = {}): Experience {
  return { ...newExperience(), id, title: `Poste ${id}`, company: `Société ${id}`, startDate, endDate: endDate ?? '', current: endDate === null, ...extra }
}

export function withExperiences(list: Experience[]): ProfileData {
  return { ...sampleProfile(), experiences: list }
}

export function fakePdf(pages: string[]): ExtractedPdf {
  return { pages: pages.length, pageTexts: pages, text: pages.join('\n\n') }
}
