import { z } from 'zod'
import { SECTION_KEYS } from './profile'

export const TEMPLATES = [
  'classic',
  'modern',
  'compact',
  'editorial',
  'margin',
  'dossier',
  'banner',
  'timeline',
  'consultant',
  'executive',
  'media',
  'tech',
  'academic',
  'european',
  'swiss',
  'ink',
  'sidebar',
  'skills-dossier',
] as const
export type TemplateId = (typeof TEMPLATES)[number]

/** Familles pour ranger le choix de modèle. */
export const TEMPLATE_GROUPS: { label: string; templates: TemplateId[] }[] = [
  { label: 'Essentiels', templates: ['classic', 'modern', 'compact', 'ink'] },
  { label: 'Par métier', templates: ['consultant', 'executive', 'tech', 'media', 'academic', 'european'] },
  { label: 'Affirmés', templates: ['editorial', 'swiss', 'banner', 'timeline', 'dossier'] },
  { label: 'Deux colonnes', templates: ['margin', 'sidebar'] },
  { label: 'Dossier de compétences', templates: ['skills-dossier'] },
]

/**
 * `ats` : lisibilité attendue par un analyseur de CV.
 * - `high`   : une seule colonne, ordre de lecture = ordre visuel.
 * - `medium` : titres de rubriques dans une marge latérale (deux colonnes) ; lisible par la
 *              plupart des extracteurs, mais certains peuvent séparer titres et contenus.
 * Aucun modèle n'offre de garantie : chaque ATS a son propre extracteur.
 */
export const TEMPLATE_INFO: Record<TemplateId, { label: string; blurb: string; ats: 'high' | 'medium' }> = {
  classic: { label: 'Classique', blurb: 'Titres en empattement, filets fins. Intemporel.', ats: 'high' },
  modern: { label: 'Moderne', blurb: 'Sans-serif aéré, titres de couleur en capitales.', ats: 'high' },
  compact: { label: 'Compact', blurb: 'Densité maximale pour les parcours longs.', ats: 'high' },
  editorial: { label: 'Éditorial', blurb: 'Grand nom en serif, esprit magazine.', ats: 'high' },
  margin: { label: 'Marge', blurb: 'Titres dans la marge, contenu respirant à droite.', ats: 'medium' },
  dossier: { label: 'Dossier', blurb: 'Capitales grasses et chasse fixe, ton technique.', ats: 'high' },
  banner: { label: 'Bandeau', blurb: 'Bandeau de couleur en tête, corps sobre.', ats: 'high' },
  timeline: { label: 'Chronologie', blurb: 'Frise verticale pour suivre le parcours.', ats: 'high' },
  consultant: { label: 'Consultant', blurb: 'Missions clients en sous-blocs, environnement technique par mission.', ats: 'high' },
  executive: { label: 'Direction', blurb: 'Résultats clés en tête, parcours resserré.', ats: 'high' },
  media: { label: 'Médias', blurb: 'Publications et interventions mises en avant.', ats: 'high' },
  tech: { label: 'Ingénierie', blurb: 'Pile technique par expérience, compétences par domaine.', ats: 'high' },
  academic: { label: 'Académique', blurb: 'Formation et publications d’abord, ton sobre.', ats: 'high' },
  european: { label: 'Européen', blurb: 'Rubriques normalisées, inspiré du format européen.', ats: 'high' },
  swiss: { label: 'Grille', blurb: 'Typographie stricte sur une grille, une colonne.', ats: 'high' },
  ink: { label: 'Encre', blurb: 'Noir et blanc, sans aplat : pensé pour l’impression.', ats: 'high' },
  sidebar: { label: 'Barre latérale', blurb: 'Coordonnées et compétences en colonne ; export ATS linéarisé fourni.', ats: 'medium' },
  'skills-dossier': { label: 'Dossier de compétences', blurb: 'Matrice compétences × années, anonymisable : format conseil et ESN.', ats: 'high' },
}

/** Paires typographiques indépendantes du modèle (`template` = celle du modèle). */
export const FONT_PAIRS = ['template', 'inter', 'plex', 'source', 'serif'] as const
export type FontPair = (typeof FONT_PAIRS)[number]
export const FONT_PAIR_LABELS: Record<FontPair, string> = {
  template: 'Celle du modèle',
  inter: 'Inter',
  plex: 'IBM Plex Sans',
  source: 'Source Sans 3',
  serif: 'Source Serif 4 + Source Sans 3',
}

/** Couleurs d'accent proposées : toutes lisibles (contraste ≥ 4,5:1) sur fond blanc. */
export const ACCENT_PRESETS = [
  { label: 'Ardoise', value: '#1f3a5f' },
  { label: 'Terre cuite', value: '#a8431f' },
  { label: 'Sapin', value: '#1f5c47' },
  { label: 'Prune', value: '#6b2f5c' },
  { label: 'Rouge sécurité', value: '#b3261e' },
  { label: 'Bleu nuit', value: '#14213d' },
  { label: 'Graphite', value: '#2b2b2b' },
] as const

const sectionIdRe = new RegExp(`^(${SECTION_KEYS.join('|')}|custom:[A-Za-z0-9_-]{1,36})$`)

export const CvSettingsSchema = z.strictObject({
  template: z.enum(TEMPLATES),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  density: z.enum(['comfortable', 'compact']),
  pageBreakBefore: z.array(z.string().regex(sectionIdRe)).max(SECTION_KEYS.length + 10),
  keepEntriesTogether: z.boolean(),
  locale: z.enum(['fr', 'en']),
  fontPair: z.enum(FONT_PAIRS),
  showPhoto: z.boolean(),
  targetPages: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  anonymize: z.boolean(),
})
export type CvSettings = z.infer<typeof CvSettingsSchema>
export type CvLocale = CvSettings['locale']

export function defaultSettings(): CvSettings {
  return {
    template: 'classic',
    accent: ACCENT_PRESETS[0].value,
    density: 'comfortable',
    pageBreakBefore: [],
    keepEntriesTogether: true,
    locale: 'fr',
    fontPair: 'template',
    showPhoto: false,
    targetPages: 0,
    anonymize: false,
  }
}

/** Réglages v1 (champs v2 absents) → v2, avec les valeurs par défaut du contrat §2. */
export function normalizeSettings(raw: Partial<CvSettings> | Record<string, unknown>): CvSettings {
  return { ...defaultSettings(), ...(raw as Partial<CvSettings>) }
}

export type CvKind = 'base' | 'tailored'

/** Luminance relative WCAG d'une couleur #rrggbb. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

/** Rapport de contraste WCAG (1 à 21) entre deux couleurs #rrggbb. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
