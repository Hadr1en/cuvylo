import {
  CASED_ONLY_KEYS,
  GENERIC_WORDS,
  HEADING_LEXICON,
  NON_SKILL_TERMS,
  PREFERRED_CUES,
  REQUIRED_CUES,
  REQUIRED_HEADING_CUES,
  SKILL_TERMS,
  STOPWORDS,
  aliasGroupOf,
  canonicalKey,
  casedRegexes,
  formsOf,
  normalizeJob,
  type Importance,
} from './dictionary'

export type { Importance } from './dictionary'

export interface JobKeyword {
  /** Forme normalisée canonique (clé de comparaison : alias et variantes ISO résolus). */
  key: string
  /** Forme affichée à l'utilisateur (telle qu'écrite dans l'offre). */
  term: string
  importance: Importance
  count: number
  inTitle: boolean
  weight: number
}

export interface ExtractedJob {
  title: string | null
  keywords: JobKeyword[]
}

const MAX_CHARS = 20_000
const MAX_KEYWORDS = 40
const RANK: Record<Importance, number> = { required: 2, preferred: 1, mentioned: 0 }

/** Bornes de mot Unicode : « SÉCURITÉ » ne contient jamais « CURIT ». */
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}])'
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}])'

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/**
 * Recherche d'un terme normalisé comme suite de mots entiers, bornes Unicode, pluriels simples tolérés
 * sur chaque mot (« analyses de risques » = « analyse de risques », « gestion des projets » = « gestion de projet »).
 */
export function termRegex(key: string): RegExp {
  const words = key.split(' ').map((w) => `${escapeRegExp(w)}(?:s|x|es)?`)
  return new RegExp(`${NOT_WORD_BEFORE}(${words.join(' ')})${NOT_WORD_AFTER}`, 'u')
}

/** Forme « criée » (tout en capitales, au moins 7 lettres) : on lui préfère une autre graphie. */
const shouting = (s: string) => s.replace(/[^\p{L}]/gu, '').length >= 7 && s === s.toUpperCase() && s !== s.toLowerCase()

/** Recherche d'une clé canonique (et de tous ses alias) dans un texte d'origine et sa forme normalisée. */
export interface TermMatcher {
  key: string
  /** Forme trouvée dans le texte d'origine, ou `null`. */
  find(raw: string, norm: string): string | null
}

const matcherCache = new Map<string, TermMatcher>()

export function termMatcher(key: string): TermMatcher {
  const cached = matcherCache.get(key)
  if (cached) return cached
  const group = aliasGroupOf(key)
  const normRes = CASED_ONLY_KEYS.has(canonicalKey(key)) ? [] : formsOf(key).map(termRegex)
  const casedRes = casedRegexes(key)
  const matcher: TermMatcher = {
    key,
    find(raw, norm) {
      for (const re of casedRes) {
        const m = re.exec(raw)
        if (m) return m[0]
      }
      for (const re of normRes) {
        const m = re.exec(norm)
        if (m) return originalSlice(raw, norm, m.index, m[0].length) ?? group?.label ?? m[1]!
      }
      return null
    },
  }
  matcherCache.set(key, matcher)
  return matcher
}

/**
 * Retrouve dans la ligne d'origine le passage correspondant à une plage de la forme normalisée,
 * quand la normalisation n'a pas changé la longueur (cas courant : accents et casse seulement).
 */
function originalSlice(raw: string, norm: string, index: number, length: number): string | null {
  const simple = raw.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (simple.length !== norm.length) {
    // Élisions retirées ou caractères invisibles : on cherche la forme sans tenir compte de la casse.
    const target = norm.slice(index, index + length)
    const re = new RegExp(escapeRegExp(target).replace(/[aeiouyc]/g, (c) => ACCENTED[c] ?? c), 'iu')
    return re.exec(simple)?.[0] ?? null
  }
  return simple.slice(index, index + length)
}

const ACCENTED: Record<string, string> = {
  a: '[aàâä]',
  e: '[eéèêë]',
  i: '[iîï]',
  o: '[oôö]',
  u: '[uùûü]',
  y: '[yÿ]',
  c: '[cç]',
}

const DICTIONARY = SKILL_TERMS.map((t) => ({ ...t, matcher: termMatcher(t.key) }))

interface Candidate {
  key: string
  display: string
  count: number
  importance: Importance
  inTitle: boolean
  dictionary: boolean
  acronym: boolean
}

const MONTHS = new Set('janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre'.split(' '))

function isNoise(key: string): boolean {
  if (NON_SKILL_TERMS.has(key)) return true
  const words = key.split(' ')
  return words.every((w) => STOPWORDS.has(w) || GENERIC_WORDS.has(w) || MONTHS.has(w) || /^\d+$/.test(w))
}

/** Puces, numéros, emoji et décorations en tête de ligne ; gras Markdown. */
function cleanLine(raw: string): string {
  return raw
    .replace(/\*\*|__/g, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[\s\-–—•·▪►*●○◦>✓✔→➢➤]+/u, '')
    .replace(/^\p{Extended_Pictographic}\p{Mn}?\s*/u, '')
    .replace(/^\d{1,2}[.)]\s+/, '')
    .trim()
}

/** Libellé d'un titre de rubrique (normalisé, sans « : » final ni ponctuation décorative). */
function headingText(line: string): string {
  return normalizeJob(line.replace(/[:：]\s*$/, '').replace(/[!?.]+$/, '').replace(/^[-–—=\s]+|[-–—=\s]+$/g, ''))
}

export interface HeaderInfo {
  /** Importance fixée pour les lignes suivantes, jusqu'au prochain titre. */
  level: Importance
}

/**
 * Une ligne est un titre de rubrique si elle finit par « : » (et reste courte), ou si elle correspond
 * exactement au lexique des titres d'annonce. Rien d'autre : une ligne courte ordinaire (« Anglais courant »)
 * n'est jamais un titre, et ne peut donc pas imposer son importance aux lignes suivantes.
 */
export function headerOf(line: string): HeaderInfo | null {
  const head = headingText(line)
  if (!head) return null
  const known = HEADING_LEXICON.get(head)
  if (known) return { level: known }
  if (/[:：]\s*$/.test(line) && line.length <= 80) {
    if (PREFERRED_CUES.test(head)) return { level: 'preferred' }
    if (REQUIRED_HEADING_CUES.test(head)) return { level: 'required' }
    return { level: 'mentioned' }
  }
  return null
}

/** « Libellé : contenu » : un libellé connu (« Un plus : … ») fixe l'importance de toute la ligne, et d'elle seule. */
function labelLevel(line: string): Importance | null {
  const label = /^([^:：]{2,40})[:：]\s*\S/.exec(line)
  if (!label) return null
  const h = HEADING_LEXICON.get(headingText(label[1]!))
  if (h) return h
  const n = normalizeJob(label[1]!)
  if (PREFERRED_CUES.test(n)) return 'preferred'
  if (REQUIRED_CUES.test(n)) return 'required'
  return null
}

/**
 * Importance de chaque proposition d'une ligne : un indice (« indispensable », « serait un plus »)
 * ne vaut que pour sa proposition ; les autres gardent l'importance de la rubrique.
 */
function clauseLevels(line: string, fallback: Importance): { text: string; level: Importance }[] {
  return line.split(/[;,.]\s+|\s[-–]\s/).map((text) => {
    const n = normalizeJob(text)
    const level = PREFERRED_CUES.test(n) ? 'preferred' : REQUIRED_CUES.test(n) ? 'required' : fallback
    return { text, level }
  })
}

/** Sigles (ASCII, ≤ 6 lettres ou avec chiffre), noms à capitale interne (CyberArk) et normes. */
function acronymsIn(line: string): string[] {
  const out: string[] = []
  const re = /(?<![\p{L}\p{N}])(\p{Lu}[\p{Lu}\p{N}&+/#]*(?:-[\p{Lu}\p{N}]+)*)(?![\p{L}\p{N}])/gu
  for (const m of line.matchAll(re)) {
    const token = m[1]!.replace(/[/&-]+$/, '')
    if (!/^[A-Z0-9&+/#-]+$/.test(token)) continue // lettres accentuées : un mot en capitales, pas un sigle
    const letters = token.replace(/[^A-Z]/g, '').length
    const digits = /\d/.test(token)
    if (letters === 0 || token.length < 2 || token.length > 12) continue
    if (!digits && letters > 6) continue // « SECURITE », « IMPORTANT » : un mot crié, pas un sigle
    out.push(token)
  }
  for (const m of line.matchAll(/(?<![\p{L}\p{N}])([A-Z][a-z]+(?:[A-Z][a-z0-9]*)+|[a-z]+[A-Z][A-Za-z]*|[A-Z][a-z]+\d+)(?![\p{L}\p{N}])/gu)) out.push(m[1]!)
  for (const m of line.matchAll(/(?<![\p{L}\p{N}])((?:ISO|NIST|PCI)(?:\s*\/\s*IEC|[ -]IEC)?[ -]?(?:DSS|SP)?[ -]?\d{3,5}(?:-\d+)?)(?![\p{L}\p{N}])/gu)) out.push(m[1]!)
  return out
}

export function extractKeywords(posting: string): ExtractedJob {
  const text = posting.slice(0, MAX_CHARS)
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean)
  if (lines.length === 0) return { title: null, keywords: [] }

  const titleLine = lines.find((l, i) => l.length >= 3 && l.length <= 100 && (i === 0 || !headerOf(l))) ?? null
  const title = titleLine ? titleLine.replace(/^(poste|intitul[ée] du poste|job title|titre)\s*[:\-–]\s*/i, '').trim() : null

  const found = new Map<string, Candidate>()
  let lineSeen = new Set<string>()
  const add = (rawKey: string, display: string, importance: Importance, inTitle: boolean, flags: { dictionary?: boolean; acronym?: boolean } = {}) => {
    const key = canonicalKey(rawKey)
    if (key.length < 2 || isNoise(key) || lineSeen.has(key)) return
    lineSeen.add(key)
    const prev = found.get(key)
    if (prev) {
      prev.count++
      prev.inTitle ||= inTitle
      if (RANK[importance] > RANK[prev.importance]) prev.importance = importance
      prev.dictionary ||= !!flags.dictionary
      prev.acronym ||= !!flags.acronym
      if (shouting(prev.display) && !shouting(display)) prev.display = display
    } else {
      found.set(key, { key, display, count: 1, importance, inTitle, dictionary: !!flags.dictionary, acronym: !!flags.acronym })
    }
  }

  let level: Importance = 'mentioned'

  lines.forEach((line, idx) => {
    const header = idx > 0 ? headerOf(line) : null
    if (header) {
      level = header.level
      return // un titre de rubrique ne contient pas de compétence ; il fixe l'importance de la suite
    }
    const inTitle = line === titleLine
    lineSeen = new Set<string>()
    const own = labelLevel(line)
    const n0 = normalizeJob(line)
    const parts = own !== null ? [{ text: line, level: own }] : clauseLevels(line, level)

    for (const part of parts) {
      const n = normalizeJob(part.text)
      // 1. Dictionnaire de compétences (alias et casse exacte compris)
      for (const { key, label, matcher } of DICTIONARY) {
        const hit = matcher.find(part.text, n)
        if (hit) add(key, CASED_ONLY_KEYS.has(key) || shouting(hit) ? label : hit, part.level, inTitle, { dictionary: true })
      }
      // 2. Sigles, normes et marques (casse d'origine)
      for (const token of acronymsIn(part.text)) {
        const key = normalizeJob(token).replace(/\s*\/\s*/g, '/')
        if (CASED_ONLY_KEYS.has(canonicalKey(key)) && !casedRegexes(key).some((re) => re.test(token))) continue
        add(key, token, part.level, inTitle, { acronym: true })
      }
    }

    // 3. Expressions répétées (retenues plus bas seulement si elles reviennent)
    const tokens = (n0.match(/[\p{L}\p{N}][\p{L}\p{N}'+#&./-]*/gu) ?? []).map((t) => t.replace(/[.'/-]+$/, ''))
    for (const phrase of phrases(tokens)) {
      const key = canonicalKey(phrase)
      if (lineSeen.has(key) || CASED_ONLY_KEYS.has(key) || isNoise(key)) continue
      lineSeen.add(key)
      const prev = found.get(key)
      const re = termRegex(key)
      const lineLevel = parts.find((p) => re.test(normalizeJob(p.text)))?.level ?? own ?? level
      if (prev) {
        if (!prev.dictionary && !prev.acronym) {
          prev.count++
          if (RANK[lineLevel] > RANK[prev.importance]) prev.importance = lineLevel
          if (shouting(prev.display)) prev.display = termMatcher(key).find(line, n0) ?? prev.display
        }
      } else {
        found.set(key, { key, display: termMatcher(key).find(line, n0) ?? phrase, count: 1, importance: lineLevel, inTitle, dictionary: false, acronym: false })
      }
    }
  })

  // Seuils de répétition : expressions ≥ 2, mots seuls ≥ 3, sauf termes de dictionnaire et sigles.
  const kept = [...found.values()].filter((c) => {
    if (c.dictionary || c.acronym) return true
    const words = c.key.split(' ').length
    return words > 1 ? c.count >= 2 : c.count >= 3
  })

  // Écarte les termes contenus dans une expression plus longue au moins aussi fréquente.
  kept.sort((a, b) => b.key.length - a.key.length || a.key.localeCompare(b.key))
  const finalList: Candidate[] = []
  for (const c of kept) {
    const covered = finalList.some((l) => l.key !== c.key && termRegex(c.key).test(l.key) && c.count <= l.count)
    if (!covered) finalList.push(c)
  }

  const keywords = finalList
    .map<JobKeyword>((c) => ({
      key: c.key,
      term: c.display,
      importance: c.importance,
      count: c.count,
      inTitle: c.inTitle,
      weight: (c.inTitle ? 3 : 0) + RANK[c.importance] * 1.5 + Math.min(c.count, 4) * 0.5 + (c.dictionary ? 1 : 0) + (c.acronym ? 0.5 : 0),
    }))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, MAX_KEYWORDS)

  return { title, keywords }
}

/** Mots seuls (non génériques) et expressions de 2 à 3 mots sans mot vide aux extrémités. */
function phrases(tokens: string[]): string[] {
  const out: string[] = []
  const edgeOk = (t: string) => t.length >= 3 && !STOPWORDS.has(t) && !GENERIC_WORDS.has(t) && !NON_SKILL_TERMS.has(t) && !/^\d+$/.test(t)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (edgeOk(t) && t.length >= 4) out.push(t)
    for (const len of [2, 3]) {
      const slice = tokens.slice(i, i + len)
      if (slice.length < len) continue
      if (edgeOk(slice[0]!) && edgeOk(slice[len - 1]!)) out.push(slice.join(' '))
    }
  }
  return out
}
