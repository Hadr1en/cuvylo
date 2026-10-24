import type { CvSettings, FontPair, TemplateId } from '@/domain/cv'
import { FAMILY } from './fonts'

/** En-tête : empilé, centré, bandeau de couleur, deux blocs (nom | contact), barre noire, grand nom sur filet. */
export type HeaderKind = 'stack' | 'center' | 'band' | 'split' | 'bar' | 'rule'
/** Titre de rubrique : filet complet, texte seul, filet court, pastille, marge latérale, filet épais au-dessus. */
export type TitleKind = 'rule' | 'plain' | 'short-rule' | 'marker' | 'gutter' | 'overline'
/** Organisation de la page : une colonne, titres en marge, ou barre latérale (contact, compétences…). */
export type LayoutKind = 'single' | 'gutter' | 'sidebar'

/** Réglages typographiques et structurels d'un modèle. Toutes les valeurs sont en points PDF. */
export interface Theme {
  layout: LayoutKind
  headingFont: string
  headingWeight: 400 | 600 | 700 | 800
  bodyFont: string
  /** Police des coordonnées et du titre professionnel. */
  metaFont: string
  headline: 'normal' | 'italic'
  headerKind: HeaderKind
  titleKind: TitleKind
  gutterWidth: number
  /** Largeur de la barre latérale (layout 'sidebar'). */
  sidebarWidth: number
  /** Frise verticale à gauche des expériences et formations. */
  timeline: boolean
  /** Dates dans une colonne à gauche de chaque entrée. */
  dateColumn: boolean
  /** Compétences : en lignes « catégorie : liste », ou en matrice compétence × durée (dossier). */
  skillsKind: 'lines' | 'matrix'
  /** Les compétences d'une expérience et l'environnement d'une mission sont affichés. */
  showEntrySkills: boolean
  /** Le résumé est mis en avant (corps plus grand, filet d'accent). */
  emphasizeSummary: boolean
  /** Couleur d'accent ignorée (impression noir et blanc). */
  monochrome: boolean
  nameSize: number
  nameWeight: 400 | 600 | 700 | 800
  nameCase: 'none' | 'uppercase'
  nameAlign: 'left' | 'center'
  headlineSize: number
  body: number
  small: number
  sectionTitleSize: number
  sectionTitleCase: 'none' | 'uppercase'
  sectionTitleTracking: number
  /** Le titre de rubrique prend la couleur d'accent. */
  accentTitles: boolean
  /** Le nom prend la couleur d'accent (hors bandeau, où il est blanc). */
  accentName: boolean
  sectionGap: number
  entryGap: number
  lineHeight: number
  padX: number
  padTop: number
  padBottom: number
}

const base: Theme = {
  layout: 'single',
  headingFont: FAMILY.sans,
  headingWeight: 700,
  bodyFont: FAMILY.sans,
  metaFont: FAMILY.sans,
  headline: 'normal',
  headerKind: 'stack',
  titleKind: 'rule',
  gutterWidth: 96,
  sidebarWidth: 168,
  timeline: false,
  dateColumn: false,
  skillsKind: 'lines',
  showEntrySkills: false,
  emphasizeSummary: false,
  monochrome: false,
  nameSize: 25,
  nameWeight: 700,
  nameCase: 'none',
  nameAlign: 'left',
  headlineSize: 11,
  body: 9.5,
  small: 8.5,
  sectionTitleSize: 9.5,
  sectionTitleCase: 'uppercase',
  sectionTitleTracking: 0.6,
  accentTitles: true,
  accentName: false,
  sectionGap: 16,
  entryGap: 9,
  lineHeight: 1.45,
  padX: 48,
  padTop: 46,
  padBottom: 44,
}

const BASE: Record<TemplateId, Theme> = {
  classic: {
    ...base,
    headingFont: FAMILY.serif,
    headingWeight: 600,
    nameSize: 26,
    nameWeight: 600,
    headlineSize: 11.5,
    titleKind: 'rule',
    sectionTitleSize: 13,
    sectionTitleCase: 'none',
    sectionTitleTracking: 0,
    accentTitles: false,
    sectionGap: 15,
    lineHeight: 1.42,
    padTop: 44,
  },
  modern: { ...base, titleKind: 'plain', accentName: true, nameSize: 25 },
  compact: {
    ...base,
    titleKind: 'rule',
    nameSize: 20,
    headlineSize: 10,
    body: 8.8,
    small: 8,
    sectionTitleTracking: 0.5,
    sectionGap: 11,
    entryGap: 6,
    lineHeight: 1.34,
    padX: 38,
    padTop: 34,
    padBottom: 34,
  },
  editorial: {
    ...base,
    headingFont: FAMILY.serif,
    headingWeight: 400,
    headline: 'italic',
    titleKind: 'short-rule',
    nameSize: 38,
    nameWeight: 400,
    headlineSize: 14,
    sectionTitleSize: 16,
    sectionTitleCase: 'none',
    sectionTitleTracking: 0,
    sectionGap: 18,
    lineHeight: 1.5,
    padX: 54,
    padTop: 52,
  },
  margin: {
    ...base,
    layout: 'gutter',
    titleKind: 'gutter',
    gutterWidth: 140,
    nameSize: 27,
    sectionTitleCase: 'none',
    sectionTitleTracking: 0,
    padX: 44,
  },
  dossier: {
    ...base,
    headingFont: FAMILY.display,
    headingWeight: 800,
    metaFont: FAMILY.mono,
    headerKind: 'bar',
    titleKind: 'marker',
    nameSize: 28,
    nameWeight: 800,
    nameCase: 'uppercase',
    headlineSize: 9.5,
    sectionGap: 17,
    padX: 46,
  },
  banner: {
    ...base,
    headingFont: FAMILY.display,
    headerKind: 'band',
    titleKind: 'plain',
    nameSize: 30,
    headlineSize: 12,
    sectionTitleSize: 13,
    sectionTitleCase: 'none',
    sectionTitleTracking: 0,
  },
  timeline: {
    ...base,
    headerKind: 'split',
    titleKind: 'plain',
    timeline: true,
    nameSize: 26,
    entryGap: 11,
  },
  // ── v2 ──
  consultant: {
    ...base,
    headingFont: FAMILY.plex,
    bodyFont: FAMILY.plex,
    metaFont: FAMILY.plex,
    headerKind: 'split',
    titleKind: 'rule',
    showEntrySkills: true,
    nameSize: 23,
    headlineSize: 11,
    sectionTitleSize: 9.5,
    body: 9.2,
    small: 8.3,
    entryGap: 10,
    padX: 44,
  },
  executive: {
    ...base,
    headingFont: FAMILY.sourceSerif,
    headingWeight: 600,
    bodyFont: FAMILY.source,
    metaFont: FAMILY.source,
    headerKind: 'rule',
    titleKind: 'plain',
    emphasizeSummary: true,
    nameSize: 30,
    nameWeight: 600,
    headlineSize: 12.5,
    body: 10,
    small: 8.8,
    sectionTitleSize: 9.5,
    sectionGap: 17,
    padX: 52,
  },
  media: {
    ...base,
    headingFont: FAMILY.serif,
    headingWeight: 600,
    headline: 'italic',
    headerKind: 'stack',
    titleKind: 'overline',
    nameSize: 32,
    nameWeight: 600,
    headlineSize: 13,
    sectionTitleSize: 12,
    sectionTitleCase: 'none',
    sectionTitleTracking: 0,
    accentName: true,
    sectionGap: 17,
  },
  tech: {
    ...base,
    headingFont: FAMILY.plex,
    bodyFont: FAMILY.plex,
    metaFont: FAMILY.mono,
    headerKind: 'stack',
    titleKind: 'marker',
    showEntrySkills: true,
    nameSize: 24,
    headlineSize: 9.5,
    body: 9.2,
    small: 8.2,
    entryGap: 9,
    padX: 44,
  },
  academic: {
    ...base,
    headingFont: FAMILY.sourceSerif,
    headingWeight: 600,
    bodyFont: FAMILY.sourceSerif,
    metaFont: FAMILY.sourceSerif,
    headerKind: 'center',
    titleKind: 'rule',
    nameAlign: 'center',
    nameSize: 22,
    nameWeight: 600,
    headlineSize: 11,
    sectionTitleSize: 10,
    accentTitles: false,
    body: 9.6,
    lineHeight: 1.42,
    padX: 54,
  },
  european: {
    ...base,
    headingFont: FAMILY.source,
    bodyFont: FAMILY.source,
    metaFont: FAMILY.source,
    headerKind: 'center',
    titleKind: 'rule',
    nameAlign: 'center',
    nameSize: 24,
    headlineSize: 11.5,
    sectionTitleSize: 10,
    body: 9.8,
    small: 8.8,
  },
  swiss: {
    ...base,
    headingFont: FAMILY.plex,
    bodyFont: FAMILY.plex,
    metaFont: FAMILY.plex,
    headerKind: 'rule',
    titleKind: 'overline',
    dateColumn: true,
    nameSize: 34,
    nameWeight: 700,
    headlineSize: 12,
    sectionTitleSize: 10,
    sectionTitleCase: 'none',
    sectionTitleTracking: 0,
    accentTitles: false,
    sectionGap: 18,
    body: 9.2,
    padX: 46,
  },
  ink: {
    ...base,
    headingFont: FAMILY.sourceSerif,
    headingWeight: 600,
    bodyFont: FAMILY.sourceSerif,
    metaFont: FAMILY.source,
    headerKind: 'stack',
    titleKind: 'rule',
    monochrome: true,
    accentTitles: false,
    nameSize: 27,
    nameWeight: 600,
    sectionTitleSize: 12,
    sectionTitleCase: 'none',
    sectionTitleTracking: 0,
    body: 9.8,
  },
  sidebar: {
    ...base,
    layout: 'sidebar',
    headingFont: FAMILY.source,
    bodyFont: FAMILY.source,
    metaFont: FAMILY.source,
    headerKind: 'stack',
    titleKind: 'plain',
    sidebarWidth: 170,
    nameSize: 26,
    body: 9.6,
    small: 8.6,
    padX: 36,
  },
  'skills-dossier': {
    ...base,
    headingFont: FAMILY.plex,
    bodyFont: FAMILY.plex,
    metaFont: FAMILY.plex,
    headerKind: 'split',
    titleKind: 'rule',
    skillsKind: 'matrix',
    showEntrySkills: true,
    nameSize: 20,
    headlineSize: 11.5,
    body: 9.1,
    small: 8.2,
    sectionTitleSize: 9.5,
    padX: 44,
  },
}

/** Paire typographique choisie indépendamment du modèle. */
const FONT_OVERRIDES: Record<Exclude<FontPair, 'template'>, Pick<Theme, 'headingFont' | 'bodyFont' | 'metaFont'>> = {
  inter: { headingFont: FAMILY.sans, bodyFont: FAMILY.sans, metaFont: FAMILY.sans },
  plex: { headingFont: FAMILY.plex, bodyFont: FAMILY.plex, metaFont: FAMILY.plex },
  source: { headingFont: FAMILY.source, bodyFont: FAMILY.source, metaFont: FAMILY.source },
  serif: { headingFont: FAMILY.sourceSerif, bodyFont: FAMILY.source, metaFont: FAMILY.source },
}

/** Poids disponibles par famille (les autres seraient synthétisés ou refusés par react-pdf). */
const WEIGHTS: Record<string, number[]> = {
  [FAMILY.sans]: [400, 500, 600, 700],
  [FAMILY.serif]: [400, 600],
  [FAMILY.display]: [700, 800],
  [FAMILY.mono]: [400, 700],
  [FAMILY.plex]: [400, 500, 600, 700],
  [FAMILY.source]: [400, 600, 700],
  [FAMILY.sourceSerif]: [400, 600],
}

/** Poids le plus proche réellement embarqué pour cette famille. */
export function weightFor(family: string, wanted: number): 400 | 600 | 700 | 800 {
  const list = WEIGHTS[family] ?? [400, 700]
  return list.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), list[0]!) as 400 | 600 | 700 | 800
}

/** Plancher de lisibilité de l'ajustement automatique (voir src/fit). */
export const MIN_SCALE = 0.84

export function themeFor(settings: CvSettings, scale = 1): Theme {
  const t = { ...BASE[settings.template] }
  if (settings.fontPair && settings.fontPair !== 'template') {
    Object.assign(t, FONT_OVERRIDES[settings.fontPair])
  }
  t.headingWeight = weightFor(t.headingFont, t.headingWeight)
  t.nameWeight = weightFor(t.headingFont, t.nameWeight)
  if (settings.density === 'compact') {
    t.body = +(t.body - 0.4).toFixed(2)
    t.small = +(t.small - 0.3).toFixed(2)
    t.sectionGap = Math.round(t.sectionGap * 0.78)
    t.entryGap = Math.round(t.entryGap * 0.75)
    t.lineHeight = +(t.lineHeight - 0.06).toFixed(2)
    t.padTop = Math.round(t.padTop * 0.85)
    t.padBottom = Math.round(t.padBottom * 0.85)
  }
  const s = Math.max(MIN_SCALE, Math.min(1, scale))
  if (s < 1) {
    const k = (n: number) => +(n * s).toFixed(2)
    t.body = k(t.body)
    t.small = k(t.small)
    t.nameSize = k(t.nameSize)
    t.headlineSize = k(t.headlineSize)
    t.sectionTitleSize = k(t.sectionTitleSize)
    t.sectionTitleTracking = k(t.sectionTitleTracking)
    t.sectionGap = k(t.sectionGap)
    t.entryGap = k(t.entryGap)
    t.padTop = k(t.padTop)
    t.padBottom = k(t.padBottom)
    t.lineHeight = +(t.lineHeight - (1 - s) * 0.4).toFixed(3)
  }
  return t
}
