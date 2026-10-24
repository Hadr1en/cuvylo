import { compact, extractionArtifacts, hasLetterSpacedText, normalize } from '@/ats/text'
import type { Severity } from '@/ats/types'
import { SECTION_LABELS, emptyProfile, type ProfileData, type SectionKey } from '@/domain/profile'
import type { ExtractedPdf } from '@/pdf/extract'
import { LIMITS, clip, cleanUrl, defaultIds, defaultSections, finalizeProfile, splitName, type IdFactory } from './common'

/**
 * « Passez votre CV actuel au scanner » : analyse le texte extrait (pdf.js) de N'IMPORTE QUEL CV PDF,
 * sans rien supposer de sa mise en page, et montre ce qu'un ATS lit réellement : ordre de lecture,
 * coordonnées retrouvées ou non, rubriques reconnues, anomalies d'extraction. Produit aussi un
 * BROUILLON de profil (identité, résumé, texte brut de chaque rubrique) à relire entièrement.
 * Heuristiques assumées : un autre extracteur peut lire différemment.
 */

export interface ScanFinding {
  id:
    | 'no-text'
    | 'name-missing'
    | 'name-late'
    | 'email-missing'
    | 'contact-late'
    | 'phone-missing'
    | 'no-headings'
    | 'sections-missing'
    | 'empty-sections'
    | 'letter-spaced'
    | 'replacement-glyphs'
    | 'private-use'
    | 'ligatures'
    | 'icon-orphans'
    | 'long'
  severity: Severity
  message: string
  fix?: string
  /** Lignes extraites illustrant le problème (≤ 3). */
  examples?: string[]
}

export interface ScanLine {
  page: number
  /** Position dans l'ordre de lecture (0 = première ligne extraite). */
  index: number
  text: string
}

export interface ScannedHeading {
  /** Texte tel qu'extrait. */
  text: string
  /** Rubrique standard reconnue, ou `null` (rubrique connue sans équivalent : références, bénévolat…). */
  key: SectionKey | null
  line: number
  page: number
}

export interface PdfScanReport {
  pages: number
  lines: ScanLine[]
  name: { value: string; line: number } | null
  email: { value: string; line: number } | null
  phone: { value: string; line: number } | null
  links: string[]
  headings: ScannedHeading[]
  /** Rubriques essentielles (expériences, formation, compétences) non retrouvées. */
  missingSections: SectionKey[]
  findings: ScanFinding[]
}

export interface PdfScanResult {
  report: PdfScanReport
  /** Brouillon de profil v2 : à relire et compléter, jamais à publier tel quel. */
  draft: ProfileData
  /** Avertissement à afficher avec le brouillon. */
  draftNotice: string
}

export const DRAFT_NOTICE =
  'Brouillon extrait automatiquement de votre PDF : identité et résumé sont proposés, le reste est conservé en texte brut dans la rubrique « Texte importé ». Relisez et répartissez chaque élément avant d’utiliser ce profil.'
export const DRAFT_SECTION_TITLE = 'Texte importé du PDF (à relire)'

/** Intitulés de rubriques (FR/EN), normalisés. */
const HEADINGS: [SectionKey | null, string[]][] = [
  ['summary', ['profil', 'profile', 'resume', 'summary', 'a propos', 'a propos de moi', 'about', 'about me', 'presentation', 'objectif', 'objective', 'synthese', 'profil professionnel', 'professional summary', 'career summary']],
  ['experiences', ['experience', 'experiences', 'experience professionnelle', 'experiences professionnelles', 'parcours', 'parcours professionnel', 'work experience', 'professional experience', 'employment', 'employment history', 'work history', 'emplois', 'carriere', 'experience pro', 'missions']],
  ['skills', ['competences', 'competence', 'competences techniques', 'competences cles', 'skills', 'technical skills', 'key skills', 'savoir-faire', 'outils', 'expertise', 'expertises', 'domaines de competences', 'stack technique', 'technologies', 'hard skills', 'soft skills', 'savoir-etre']],
  ['education', ['formation', 'formations', 'education', 'diplomes', 'diplome', 'etudes', 'cursus', 'academic background', 'formation academique', 'parcours academique']],
  ['certifications', ['certifications', 'certification', 'certificats', 'certificates', 'licences et certifications', 'licenses & certifications', 'licenses and certifications']],
  ['languages', ['langues', 'langue', 'languages', 'language', 'langues etrangeres']],
  ['projects', ['projets', 'projects', 'projets personnels', 'personal projects', 'realisations']],
  ['awards', ['distinctions', 'prix', 'recompenses', 'awards', 'honors', 'honours', 'honors & awards']],
  ['publications', ['publications', 'articles', 'interventions', 'medias', 'conferences', 'talks', 'publications et medias']],
  ['interests', ["centres d'interet", "centres d'interets", 'loisirs', 'hobbies', 'interests', 'passions', 'activites extra-professionnelles', 'interets']],
  [null, ['references', 'benevolat', 'volunteering', 'volunteer experience', 'associations', 'engagements', 'contact', 'coordonnees', 'informations personnelles', 'personal details', 'personal information', 'informations']],
]
const HEADING_MAP = new Map<string, SectionKey | null>()
for (const [key, list] of HEADINGS) for (const h of list) HEADING_MAP.set(h.replace(/\s+/g, ''), key)

const PUA = /[\u{E000}-\u{F8FF}]|[\u{F0000}-\u{FFFFD}]/u
const PUA_G = new RegExp(PUA.source, 'gu')
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/u
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(0\)[\s.-]?)?\d(?:[\s.-]?\d){7,13}/
const LINK =/(?:https?:\/\/|www\.)[^\s|,;]+|(?<![\p{L}\p{N}@.])(?:[a-z0-9-]+\.)?(?:linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com|medium\.com|malt\.fr)\/[^\s|,;]*/giu

/** Mots d'intitulés de poste : une ligne qui en contient n'est pas un nom de personne. */
const TITLE_WORDS =
  /\b(chef|cheffe|consultant|consultante|developpeur|developpeuse|developer|engineer|ingenieur|ingenieure|manager|responsable|directeur|directrice|analyste|analyst|project|projet|charge|chargee|assistant|assistante|technicien|technicienne|architecte|architect|designer|lead|head|officer|stagiaire|alternant|alternante|curriculum|vitae|resume|cv)\b/

/** Libellé d'une ligne de titre : sans icônes, puces ni « : », espacement de lettres résorbé. */
function headingKey(line: string): { key: SectionKey | null } | null {
  const cleaned = line.replace(PUA_G, '').replace(/^[\s\p{S}\p{P}]+|[\s:：.\p{S}]+$/gu, '')
  if (!cleaned || cleaned.length > 50 || /\d{3}/.test(cleaned)) return null
  const c = compact(cleaned).replace(/[’]/g, "'")
  return HEADING_MAP.has(c) ? { key: HEADING_MAP.get(c)! } : null
}

function phoneIn(line: string): string | null {
  // Des années (« 2019 – 2021 2022 ») ne font pas un numéro : elles sont écartées avant la recherche.
  const masked = line.replace(/(?<![\d+])(19|20)\d{2}(?!\d)/g, (y) => ' '.repeat(y.length)).replace(/\s[-–]\s/g, '   ')
  for (const m of masked.matchAll(new RegExp(PHONE.source, 'g'))) {
    const digits = m[0].replace(/\D/g, '')
    if (digits.length >= 9 && digits.length <= 15) return m[0].trim()
  }
  return null
}

const isNameToken = (t: string) => /^(\p{Lu}[\p{L}'’.-]*|de|du|des|la|le|van|von|der|da|di|d['’]\p{Lu}[\p{L}-]*)$/u.test(t)

function nameCandidate(line: string): boolean {
  const t = line.trim()
  if (t.length < 4 || t.length > 45 || /[\d@|,;:/()]/.test(t) || PUA.test(t)) return false
  const tokens = t.split(/\s+/)
  if (tokens.length < 2 || tokens.length > 4) return false
  if (!tokens.every(isNameToken)) return false
  if (TITLE_WORDS.test(normalize(t))) return false
  return headingKey(t) === null
}

function excerpt(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export function scanPdf(extracted: ExtractedPdf, opts: { makeId?: IdFactory } = {}): PdfScanResult {
  const makeId = opts.makeId ?? defaultIds
  const lines: ScanLine[] = []
  extracted.pageTexts.forEach((t, page) => {
    for (const raw of t.split('\n')) {
      const text = raw.replace(/\s+/g, ' ').trim()
      if (text) lines.push({ page, index: lines.length, text })
    }
  })
  const findings: ScanFinding[] = []
  const report: PdfScanReport = { pages: extracted.pages, lines, name: null, email: null, phone: null, links: [], headings: [], missingSections: [], findings }
  const draft = emptyProfile()

  if (compact(extracted.text).length < 40) {
    findings.push({
      id: 'no-text',
      severity: 'error',
      message: 'Presque aucun texte n’a pu être extrait de ce PDF.',
      fix: 'C’est probablement une image (scan, export « en image ») : un ATS n’y lira rien. Exportez votre CV depuis son logiciel d’origine en PDF texte.',
    })
    return { report, draft: finalizeProfile(draft, []), draftNotice: DRAFT_NOTICE }
  }

  // Rubriques
  for (const l of lines) {
    const h = headingKey(l.text)
    if (h) report.headings.push({ text: l.text, key: h.key, line: l.index, page: l.page })
  }
  const firstHeading = report.headings[0]?.line ?? Infinity
  const firstHeadingText = report.headings[0]?.text ?? ''

  // Coordonnées
  for (const l of lines) {
    if (!report.email) {
      const m = EMAIL.exec(l.text)
      if (m) report.email = { value: m[0], line: l.index }
    }
    if (!report.phone) {
      const p = phoneIn(l.text.replace(EMAIL, ''))
      if (p) report.phone = { value: p, line: l.index }
    }
    for (const m of l.text.matchAll(LINK)) {
      const u = m[0].replace(/[).,;:]+$/, '')
      if (!report.links.includes(u)) report.links.push(u)
    }
  }

  // Nom : de préférence celui qui correspond à l'e-mail, sinon le premier candidat en tête de document.
  const local = report.email ? normalize(report.email.value.split('@')[0]!).replace(/[^a-z]/g, ' ') : ''
  const candidates = lines.filter((l) => nameCandidate(l.text))
  const byEmail = candidates.find((l) =>
    normalize(l.text)
      .split(/[\s'-]+/)
      .filter((t) => t.length >= 3)
      .some((t) => local.includes(t)),
  )
  const name = byEmail ?? candidates.find((l) => l.index < Math.min(8, firstHeading))
  if (name) report.name = { value: name.text, line: name.index }

  // Constats
  if (!report.name) {
    findings.push({ id: 'name-missing', severity: 'warning', message: 'Aucun nom de personne n’a été reconnu dans le texte extrait.', fix: 'Le nom est peut-être dans une image ou un logo : écrivez-le en texte, en tête de page.' })
  } else if (report.name.line > firstHeading) {
    findings.push({
      id: 'name-late',
      severity: 'warning',
      message: `Le nom n’arrive qu’en ligne ${report.name.line + 1}, après la rubrique « ${firstHeadingText} ».`,
      fix: 'Il est probablement dans une colonne ou un bloc flottant lu après le reste. Un ATS risque de ne pas l’associer au CV : placez-le en tête, dans le flux principal.',
      examples: [excerpt(report.name.value)],
    })
  }
  if (!report.email) {
    findings.push({ id: 'email-missing', severity: 'warning', message: 'Aucune adresse e-mail retrouvée dans le texte extrait.', fix: 'Une adresse cachée derrière une icône ou un lien n’est pas lue : écrivez-la en clair.' })
  } else if (report.email.line > firstHeading) {
    findings.push({
      id: 'contact-late',
      severity: 'warning',
      message: `Les coordonnées sont lues après la rubrique « ${firstHeadingText} » (ligne ${report.email.line + 1}).`,
      fix: 'Typique d’une colonne latérale : certains ATS ne rattachent alors pas l’e-mail au candidat. Mettez nom et coordonnées en tête, sur une seule colonne.',
    })
  }
  if (!report.phone) findings.push({ id: 'phone-missing', severity: 'info', message: 'Aucun numéro de téléphone retrouvé.', fix: 'Si votre CV en contient un, il est peut-être dans une image ou découpé par la mise en page.' })

  const keys = new Set(report.headings.map((h) => h.key).filter((k): k is SectionKey => k !== null))
  if (report.headings.length === 0) {
    findings.push({ id: 'no-headings', severity: 'warning', message: 'Aucun titre de rubrique standard n’a été reconnu.', fix: 'Utilisez des intitulés usuels (« Expérience professionnelle », « Formation », « Compétences ») en texte, sans les remplacer par des icônes.' })
  } else {
    report.missingSections = (['experiences', 'education', 'skills'] as const).filter((k) => !keys.has(k))
    if (report.missingSections.length) {
      findings.push({
        id: 'sections-missing',
        severity: 'info',
        message: `Rubriques non retrouvées : ${report.missingSections.map((k) => SECTION_LABELS[k]).join(', ')}.`,
        fix: 'Si elles existent, leur titre n’est pas un intitulé standard ou n’est pas extrait comme texte.',
      })
    }
  }
  const empty = report.headings.filter((h, i) => report.headings[i + 1]?.line === h.line + 1)
  if (empty.length) {
    findings.push({
      id: 'empty-sections',
      severity: 'info',
      message: `${empty.length} titre${empty.length > 1 ? 's' : ''} de rubrique suivi${empty.length > 1 ? 's' : ''} directement d’un autre titre.`,
      fix: 'Les titres sont lus séparément de leur contenu : signe d’une mise en page en colonnes ou en blocs. Un ATS peut mal répartir le contenu.',
      examples: empty.slice(0, 3).map((h) => h.text),
    })
  }
  const spaced = lines.filter((l) => hasLetterSpacedText(l.text))
  if (spaced.length) {
    findings.push({ id: 'letter-spaced', severity: 'warning', message: `${spaced.length} ligne${spaced.length > 1 ? 's' : ''} extraite${spaced.length > 1 ? 's' : ''} lettre par lettre.`, fix: 'Un espacement de lettres décoratif casse les mots à l’extraction (« E X P É R I E N C E ») : supprimez-le.', examples: spaced.slice(0, 3).map((l) => excerpt(l.text)) })
  }
  const withFffd = lines.filter((l) => l.text.includes(String.fromCodePoint(0xfffd)))
  if (withFffd.length) {
    findings.push({ id: 'replacement-glyphs', severity: 'warning', message: `${withFffd.length} ligne${withFffd.length > 1 ? 's' : ''} contien${withFffd.length > 1 ? 'nent' : 't'} des caractères illisibles (« � »).`, fix: 'La police du PDF n’indique pas quels caractères elle dessine : un ATS lira des mots tronqués. Réexportez avec une police standard.', examples: withFffd.slice(0, 3).map((l) => excerpt(l.text)) })
  }
  const pua = lines.filter((l) => PUA.test(l.text))
  if (pua.length) {
    findings.push({ id: 'private-use', severity: 'warning', message: `${pua.length} ligne${pua.length > 1 ? 's' : ''} contien${pua.length > 1 ? 'nent' : 't'} des icônes extraites en caractères privés.`, fix: 'Icônes de police (téléphone, e-mail, LinkedIn…) : sans valeur pour un ATS, elles peuvent coller ou couper les mots voisins. Remplacez-les par des libellés texte.', examples: pua.slice(0, 3).map((l) => excerpt(l.text)) })
  }
  if (extractionArtifacts(extracted.text).some((c) => /[ﬀ-ﬆ]/.test(c))) {
    findings.push({ id: 'ligatures', severity: 'info', message: 'Des ligatures (« ﬁ », « ﬂ ») ne sont pas décomposées.', fix: 'Certains ATS lisent alors « ﬁnance » au lieu de « finance » : désactivez les ligatures ou changez de police.' })
  }
  const orphans = lines.filter((l) => !/[\p{L}\p{N}]/u.test(l.text))
  if (orphans.length) {
    findings.push({ id: 'icon-orphans', severity: 'info', message: `${orphans.length} ligne${orphans.length > 1 ? 's' : ''} sans aucun mot (icône, séparateur, « : » isolé).`, fix: 'Restes d’icônes ou de décorations : ils n’apportent rien à un ATS et peuvent séparer une étiquette de sa valeur.', examples: orphans.slice(0, 3).map((l) => l.text) })
  }
  if (extracted.pages > 2) findings.push({ id: 'long', severity: 'info', message: `Le CV fait ${extracted.pages} pages.`, fix: 'Au-delà de 2 pages, l’essentiel se dilue.' })

  // ── Brouillon ──────────────────────────────────────────────────────────────
  const notes: string[] = []
  if (report.name) {
    const { firstName, lastName } = splitName(report.name.value)
    draft.identity.firstName = firstName
    // NOM en capitales → Nom (le PDF l'écrivait pour l'effet, pas pour le sens).
    draft.identity.lastName = lastName === lastName.toUpperCase() ? lastName.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()) : lastName
  }
  draft.identity.email = clip(report.email?.value)
  draft.identity.phone = clip(report.phone?.value)
  const used = new Set([report.name?.line, report.email?.line, report.phone?.line].filter((n): n is number => n !== undefined))
  // Titre : première ligne courte qui suit le nom, avant la première rubrique.
  if (report.name) {
    const next = lines.find((l) => l.index > report.name!.line && l.index < firstHeading && !used.has(l.index) && l.text.length <= 90 && /\p{L}/u.test(l.text) && !EMAIL.test(l.text) && !phoneIn(l.text) && !l.text.match(LINK))
    if (next) {
      draft.identity.headline = clip(next.text)
      used.add(next.index)
    }
  }
  // Localisation : segment « Ville, Pays » d'une ligne de contact en tête.
  for (const l of lines.filter((x) => x.index < Math.min(firstHeading, 15))) {
    const part = l.text
      .split(/\s*[|•·▪]\s*/)
      .map((p) => p.replace(PUA_G, '').trim())
      .find((p) => /^\p{Lu}[\p{L}' -]+(,\s*\p{Lu}[\p{L}' -]+)?$/u.test(p) && p.length <= 40 && !nameCandidate(p) && headingKey(p) === null && p !== draft.identity.headline)
    if (part && (l.text.includes(',') || /[|•·▪]/.test(l.text))) {
      draft.identity.location = clip(part)
      break
    }
  }
  const seenUrl = new Set<string>()
  for (const raw of report.links) {
    const url = cleanUrl(raw)
    if (!url || seenUrl.has(url)) continue
    seenUrl.add(url)
    const label = /linkedin\./i.test(url) ? 'LinkedIn' : /github\./i.test(url) ? 'GitHub' : /gitlab\./i.test(url) ? 'GitLab' : 'Site web'
    draft.links.push({ id: makeId(), label, url })
  }

  // Texte brut de chaque rubrique, dans l'ordre de lecture.
  const blocks: { title: string; key: SectionKey | null; text: string[] }[] = []
  const head: string[] = []
  const headingLines = new Set(report.headings.map((h) => h.line))
  for (const l of lines) {
    if (headingLines.has(l.index)) {
      const h = report.headings.find((x) => x.line === l.index)!
      blocks.push({ title: h.text.replace(PUA_G, '').replace(/[\s:：]+$/, '').trim(), key: h.key, text: [] })
    } else if (blocks.length) {
      blocks[blocks.length - 1]!.text.push(l.text)
    } else if (!used.has(l.index) && /[\p{L}\p{N}]/u.test(l.text)) {
      head.push(l.text)
    }
  }
  const summaryBlock = blocks.find((b) => b.key === 'summary' && b.text.length)
  if (summaryBlock) draft.summary = clip(summaryBlock.text.join('\n'), LIMITS.long)

  const entries = [
    ...(head.length ? [{ title: 'Début du document', text: head }] : []),
    ...blocks.filter((b) => b !== summaryBlock && b.text.length),
  ].map((b) => ({ id: makeId(), title: clip(b.title), subtitle: '', date: '', description: clip(b.text.join('\n'), LIMITS.long) }))
  if (entries.length) {
    draft.customSections = [{ id: makeId(), title: DRAFT_SECTION_TITLE, entries: entries.slice(0, LIMITS.entries) }]
    if (entries.length > LIMITS.entries) notes.push(`${entries.length - LIMITS.entries} bloc(s) de texte au-delà de ${LIMITS.entries} non repris.`)
  }
  draft.sections = defaultSections(draft)

  return { report, draft: finalizeProfile(draft, notes), draftNotice: DRAFT_NOTICE }
}
