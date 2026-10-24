import type { ProfileData } from '@/domain/profile'

/**
 * Relecteur de style français pour le contenu d'un CV. Déterministe, sans IA, sans réseau.
 * Il SIGNALE, il ne réécrit jamais : les conseils proposent une tournure, jamais un contenu
 * (aucun chiffre, aucun fait inventé). Heuristiques assumées : un signalement est une invitation
 * à relire, pas une faute certaine.
 */

export type LintSeverity = 'suggestion' | 'info'

export interface LintFinding {
  /** Identifiant de la règle (stable, sert aux filtres et aux tests). */
  id: LintRuleId
  severity: LintSeverity
  /** Chemin du champ dans le profil, ex. `experiences.1.achievements.0.text` ou `experiences.0.achievements` (liste). */
  path: string
  /** Extrait concerné (≤ 80 caractères). */
  excerpt: string
  message: string
  hint: string
}

export type LintRuleId =
  | 'weak-opening'
  | 'first-person'
  | 'tense-mix'
  | 'nominalisation'
  | 'no-figure'
  | 'punctuation-mix'
  | 'filler-words'
  | 'long-bullet'
  | 'duplicate-word'
  | 'all-caps'

export const LINT_RULE_LABELS: Record<LintRuleId, string> = {
  'weak-opening': 'Entrée en matière faible',
  'first-person': 'Première personne',
  'tense-mix': 'Temps mélangés dans une liste',
  nominalisation: 'Nominalisation',
  'no-figure': 'Réalisations sans chiffre',
  'punctuation-mix': 'Ponctuation finale irrégulière',
  'filler-words': 'Mots vagues',
  'long-bullet': 'Puce très longue',
  'duplicate-word': 'Mot répété',
  'all-caps': 'Mot en capitales',
}

/** Au-delà, une puce se lit comme un paragraphe. */
export const LONG_BULLET = 220

// ── Unités de texte ──────────────────────────────────────────────────────────

/** Un texte du profil : prose (résumé, description) ou puce d'une liste de réalisations. */
interface Unit {
  path: string
  text: string
  kind: 'prose' | 'bullet'
}

/** Une liste de puces (réalisations d'une expérience ou d'une mission). */
interface BulletList {
  path: string
  items: Unit[]
}

function collect(data: ProfileData): { units: Unit[]; lists: BulletList[] } {
  const units: Unit[] = []
  const lists: BulletList[] = []
  const prose = (path: string, text: string) => {
    if (text.trim()) units.push({ path, text, kind: 'prose' })
  }
  const bullets = (path: string, items: { text: string }[]) => {
    const list: BulletList = { path, items: [] }
    items.forEach((a, i) => {
      if (!a.text.trim()) return
      const u: Unit = { path: `${path}.${i}.text`, text: a.text, kind: 'bullet' }
      units.push(u)
      list.items.push(u)
    })
    if (list.items.length) lists.push(list)
  }

  prose('summary', data.summary)
  data.experiences.forEach((e, i) => {
    prose(`experiences.${i}.description`, e.description)
    bullets(`experiences.${i}.achievements`, e.achievements)
    e.missions.forEach((m, j) => {
      prose(`experiences.${i}.missions.${j}.description`, m.description)
      bullets(`experiences.${i}.missions.${j}.achievements`, m.achievements)
    })
  })
  data.education.forEach((e, i) => prose(`education.${i}.description`, e.description))
  data.projects.forEach((p, i) => prose(`projects.${i}.description`, p.description))
  data.awards.forEach((a, i) => prose(`awards.${i}.description`, a.description))
  data.publications.forEach((p, i) => prose(`publications.${i}.description`, p.description))
  data.customSections.forEach((c, i) => c.entries.forEach((e, j) => prose(`customSections.${i}.entries.${j}.description`, e.description)))
  return { units, lists }
}

/** Lignes et phrases d'un texte : chacune peut « ouvrir » une idée. */
function openings(text: string): string[] {
  return text
    .split(/\n|(?<=[.!?])\s+(?=\p{Lu})/u)
    .map((s) => s.replace(/^[\s\-–—•·▪►*✓]+/u, '').trim())
    .filter(Boolean)
}

const L = '\\p{L}\\p{N}'
const word = (src: string, flags = 'iu') => new RegExp(`(?<![${L}])(?:${src})(?![${L}])`, flags)

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 25)
  const end = Math.min(text.length, index + length + 35)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
}

const firstWords = (text: string, n = 10) => {
  const words = text.trim().split(/\s+/)
  return words.slice(0, n).join(' ') + (words.length > n ? '…' : '')
}

// ── Lexiques ────────────────────────────────────────────────────────────────

const WEAK_OPENINGS: { re: RegExp; label: string }[] = [
  { re: /^en charge (de|du|des|d['’])/iu, label: 'En charge de' },
  { re: /^charg[ée]e?s? (de|du|des|d['’])/iu, label: 'Chargé de' },
  { re: /^responsables? (de|du|des|d['’])/iu, label: 'Responsable de' },
  { re: /^participation (à|au|aux)/iu, label: 'Participation à' },
  { re: /^(j['’]ai )?particip[ée]e?s? (à|au|aux)/iu, label: 'Participé à' },
  { re: /^aide (à|au|aux)/iu, label: 'Aide à' },
  { re: /^(j['’]ai )?aid[ée]e? (à|au|aux)/iu, label: 'Aidé à' },
  { re: /^contribution (à|au|aux)/iu, label: 'Contribution à' },
  { re: /^implication dans/iu, label: 'Implication dans' },
  { re: /^travail (sur|dans)/iu, label: 'Travail sur' },
]

/** « de », « du », « des » (mots entiers) ou « d’ » élidé. */
const DE = `(?:d(?:e|u|es)(?![${L}])|d['’])`
const nominal = (head: string) => new RegExp(`(?<![${L}])${head} ${DE}`, 'iu')

const NOMINALISATIONS: { re: RegExp; verbs: string }[] = [
  { re: nominal('mise en place'), verbs: '« mettre en place », « déployer », « instaurer »' },
  { re: nominal('mise en (?:œ|oe)uvre'), verbs: '« mettre en œuvre », « déployer »' },
  { re: nominal('gestion'), verbs: '« gérer », « piloter », « administrer »' },
  { re: nominal('réalisation'), verbs: '« réaliser », « mener », « livrer »' },
  { re: nominal('prise en charge'), verbs: '« prendre en charge », « traiter »' },
  { re: nominal('élaboration'), verbs: '« élaborer », « concevoir »' },
]

/**
 * Mots vagues. « différents » n'est signalé qu'en déterminant (« les différents projets »),
 * jamais en adjectif (« trois sites différents »).
 */
const FILLERS = new RegExp(
  `(?<![${L}])(?:divers|diverses|variés|variées|multiples tâches|etc\\.?|et cetera)(?![${L}])` +
    `|(?:^|(?<=(?:^|\\s)(?:les|des|de|aux|sur|dans|à|pour|avec|entre)\\s))différent(?:e)?s(?=\\s+\\p{L})` +
    `|\\.\\.\\.\\s*$|…\\s*$`,
  'iu',
)

const FIRST_PERSON = /(?<![\p{L}\p{N}])(?:je(?![\p{L}\p{N}'’])|j['’](?=\p{L})|nous(?![\p{L}\p{N}]))/iu

/** Mots en capitales de 6 lettres ou plus, sans chiffre, admis (sigles longs, noms d'organismes). */
const LONG_ACRONYMS = new Set(['INSEAD', 'INSERM', 'UNICEF', 'UNESCO', 'NASDAQ', 'SECNUMCLOUD', 'EUROPASS', 'CNRS', 'TOGAF', 'AFNOR', 'OPENAI', 'PRINCE', 'ERASMUS'])

const SPELLED_NUMBERS = word(
  'deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarante|cinquante|soixante|cent|cents|mille|millions?|milliards?|dizaines?|centaines?|milliers?|moitié|double|triple|tiers|quart',
)

// ── Temps et style d'ouverture d'une puce ────────────────────────────────────

export type BulletStyle = 'nominal' | 'participle' | 'passe-compose' | 'imperfect' | 'infinitive'

const STYLE_LABELS: Record<BulletStyle, string> = {
  nominal: 'style nominal (« Pilotage de… »)',
  participle: 'participe passé (« Piloté… »)',
  'passe-compose': 'passé composé (« J’ai piloté… »)',
  imperfect: 'imparfait (« Pilotais… »)',
  infinitive: 'infinitif (« Piloter… »)',
}

/** Mots en -ais/-ait qui ne sont pas des imparfaits. */
const NOT_IMPERFECT = new Set(
  'mais jamais desormais anglais francais japonais portugais irlandais ecossais neerlandais polonais palais frais relais souhait attrait extrait portrait retrait trait parfait abstrait lait bienfait forfait fait refait parfait'.split(' '),
)
/** Participes passés irréguliers fréquents en ouverture de puce. */
const IRREGULAR_PARTICIPLES = new Set(
  'concu mis pris reduit construit produit ecrit obtenu conduit introduit fait ouvert permis elu soumis defini etabli choisi fourni reussi accompli rempli traduit acquis repris compris promu'.split(' '),
)
/** Noms d'action fréquents en ouverture de puce, hors suffixes réguliers. */
const NOMINAL_WORDS = new Set(
  'gestion suivi audit refonte conduite mise prise analyse veille encadrement support appui aide responsable maintenance assistance surveillance expertise recette revue'.split(' '),
)

const strip = (w: string) => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Style d'ouverture d'une puce, ou `null` si indéterminé. Heuristique sur le premier mot. */
export function bulletStyle(text: string): BulletStyle | null {
  const t = text.replace(/^[\s\-–—•·▪►*✓]+/u, '').trim()
  if (/^(j['’]ai|ai|avons|nous avons)\s+\p{L}/iu.test(t)) return 'passe-compose'
  const raw = /^(?:j['’]|je\s+|nous\s+)?([\p{L}-]+)/iu.exec(t)?.[1]
  if (!raw) return null
  const w = strip(raw)
  if (w.length < 3) return null
  if (/(ais|ait|aient)$/.test(w) && w.length > 4 && !NOT_IMPERFECT.has(w)) return 'imperfect'
  if (NOMINAL_WORDS.has(w) || /(tion|sion|ment|age)$/.test(w)) return 'nominal'
  if (IRREGULAR_PARTICIPLES.has(w) || /é(e|s|es)?$/iu.test(raw)) return 'participle'
  if (/(er|ir)$/.test(w) && w.length > 4) return 'infinitive'
  return null
}

// ── Règles ──────────────────────────────────────────────────────────────────

function unitFindings(u: Unit): LintFinding[] {
  const out: LintFinding[] = []
  const text = u.text

  // Entrée en matière faible : au début d'une puce, d'une ligne ou d'une phrase.
  for (const o of openings(text)) {
    const weak = WEAK_OPENINGS.find((w) => w.re.test(o))
    if (weak) {
      out.push({
        id: 'weak-opening',
        severity: 'suggestion',
        path: u.path,
        excerpt: firstWords(o),
        message: `« ${weak.label} » décrit un périmètre, pas une action.`,
        hint: 'Ouvrez par un verbe qui dit ce que vous avez fait (piloté, conçu, déployé, négocié…), sans changer les faits.',
      })
      break
    }
  }

  const fp = FIRST_PERSON.exec(text)
  if (fp) {
    out.push({
      id: 'first-person',
      severity: u.kind === 'prose' && u.path === 'summary' ? 'info' : 'suggestion',
      path: u.path,
      excerpt: excerptAround(text, fp.index, fp[0].length),
      message: `Première personne (« ${fp[0].trim()} ») : l’usage d’un CV est le style impersonnel.`,
      hint: 'Supprimez le pronom et commencez par le verbe ou le nom d’action (« J’ai piloté » → « Piloté »).',
    })
  }

  for (const n of NOMINALISATIONS) {
    const m = n.re.exec(text)
    if (m) {
      out.push({
        id: 'nominalisation',
        severity: 'suggestion',
        path: u.path,
        excerpt: excerptAround(text, m.index, m[0].length),
        message: `« ${m[0].replace(/\s+\S+$/, '')} » alourdit la phrase.`,
        hint: `Un verbe est plus direct : ${n.verbs}. Gardez exactement le même contenu.`,
      })
      break
    }
  }

  const f = FILLERS.exec(text)
  if (f) {
    out.push({
      id: 'filler-words',
      severity: 'suggestion',
      path: u.path,
      excerpt: excerptAround(text, f.index, f[0].length),
      message: `« ${f[0].trim()} » reste vague.`,
      hint: 'Nommez les éléments concernés si vous les connaissez, ou retirez le mot.',
    })
  }

  if (u.kind === 'bullet' && text.trim().length > LONG_BULLET) {
    out.push({
      id: 'long-bullet',
      severity: 'suggestion',
      path: u.path,
      excerpt: firstWords(text),
      message: `Puce de ${text.trim().length} caractères (au-delà de ${LONG_BULLET}, elle se lit comme un paragraphe).`,
      hint: 'Une puce, une idée : scindez-la ou resserrez-la autour de l’action et du résultat.',
    })
  }

  const dup = /(?<![\p{L}\p{N}])([\p{L}\p{N}]+)\s+\1(?![\p{L}\p{N}])/iu.exec(text)
  if (dup && !/^(nous|vous|\d+)$/i.test(dup[1]!)) {
    out.push({
      id: 'duplicate-word',
      severity: 'suggestion',
      path: u.path,
      excerpt: excerptAround(text, dup.index, dup[0].length),
      message: `Mot répété : « ${dup[0]} ».`,
      hint: 'Probable faute de frappe : supprimez le doublon.',
    })
  }

  for (const m of text.matchAll(/(?<![\p{L}\p{N}])\p{Lu}{6,}(?![\p{L}\p{N}])/gu)) {
    if (LONG_ACRONYMS.has(m[0])) continue
    out.push({
      id: 'all-caps',
      severity: 'suggestion',
      path: u.path,
      excerpt: excerptAround(text, m.index, m[0].length),
      message: `« ${m[0]} » est écrit en capitales.`,
      hint: 'Réservez les capitales aux sigles : en casse normale, le mot se lit mieux et reste reconnu par les analyseurs.',
    })
    break
  }

  return out
}

/** Classe de ponctuation finale d'une puce (parenthèses et guillemets fermants ignorés). */
function finalPunctuation(text: string): string {
  const t = text.trim().replace(/[)\]»"'’\s]+$/u, '')
  const last = t.slice(-1)
  if (last === '…') return '.'
  return /[.;,!?:]/.test(last) ? last : 'aucune'
}

function listFindings(list: BulletList): LintFinding[] {
  const out: LintFinding[] = []
  const { items } = list
  if (items.length >= 2) {
    // Temps mélangés
    const styles = new Map<BulletStyle, string>()
    for (const it of items) {
      const s = bulletStyle(it.text)
      if (s && !styles.has(s)) styles.set(s, firstWords(it.text, 3))
    }
    if (styles.size >= 2) {
      const desc = [...styles.entries()].map(([s, ex]) => `${STYLE_LABELS[s]} : « ${ex} »`)
      out.push({
        id: 'tense-mix',
        severity: 'suggestion',
        path: list.path,
        excerpt: [...styles.values()].join(' / '),
        message: `Les puces de cette entrée mélangent ${desc.join(' ; ')}.`,
        hint: 'Choisissez une seule forme pour toute la liste (nominal ou participe passé sont les plus courants en français).',
      })
    }

    // Ponctuation finale
    const classes = new Map<string, number>()
    for (const it of items) classes.set(finalPunctuation(it.text), (classes.get(finalPunctuation(it.text)) ?? 0) + 1)
    if (classes.size >= 2) {
      const parts = [...classes.entries()].map(([c, n]) => `${n} ${c === 'aucune' ? 'sans ponctuation' : `avec « ${c} »`}`)
      out.push({
        id: 'punctuation-mix',
        severity: 'suggestion',
        path: list.path,
        excerpt: items.map((i) => i.text.trim().slice(-12)).join(' | '),
        message: `Ponctuation finale irrégulière : ${parts.join(', ')}.`,
        hint: 'Terminez toutes les puces de la même façon (toutes par un point, ou aucune).',
      })
    }
  }

  // Aucun chiffre dans toute la liste (information douce, jamais une exigence)
  if (items.length >= 1 && !items.some((i) => /\d/.test(i.text) || SPELLED_NUMBERS.test(i.text))) {
    out.push({
      id: 'no-figure',
      severity: 'info',
      path: list.path,
      excerpt: firstWords(items[0]!.text),
      message: `Aucune de ces ${items.length > 1 ? `${items.length} réalisations` : 'réalisations'} ne contient de chiffre.`,
      hint: 'Si vous disposez de chiffres exacts (volume, délai, budget, taille d’équipe, résultat), ils rendent la réalisation concrète. N’en inventez aucun.',
    })
  }
  return out
}

/**
 * Relit tout le contenu rédigé d'un profil (résumé, descriptions, réalisations, missions, projets,
 * distinctions, publications, rubriques libres). Résultats dans l'ordre du profil.
 */
export function lintProfile(data: ProfileData): LintFinding[] {
  const { units, lists } = collect(data)
  const findings: LintFinding[] = []
  const listByPath = new Map(lists.map((l) => [l.path, l]))
  const emitted = new Set<string>()
  for (const u of units) {
    // Constats de liste : émis juste avant la première puce de la liste.
    const listPath = u.kind === 'bullet' ? u.path.replace(/\.\d+\.text$/, '') : null
    if (listPath && !emitted.has(listPath)) {
      emitted.add(listPath)
      findings.push(...listFindings(listByPath.get(listPath)!))
    }
    findings.push(...unitFindings(u))
  }
  return findings
}

/** Relecture d'un texte isolé (champ en cours de saisie), sans les règles de liste. */
export function lintText(text: string, path = '', kind: 'prose' | 'bullet' = 'prose'): LintFinding[] {
  return text.trim() ? unitFindings({ path, text, kind }) : []
}
