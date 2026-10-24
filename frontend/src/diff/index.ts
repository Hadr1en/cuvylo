import { PUBLICATION_KIND_LABELS, SECTION_LABELS, sectionId, sectionLabel, type ProfileData, type SectionId } from '@/domain/profile'

/**
 * Comparaison de deux versions d'un CV : changements structurés (rubrique, élément, champ, avant, après)
 * et différence ligne à ligne d'un texte (plus longue sous-suite commune). Fonctions pures, libellés en français.
 */

export type ChangeKind = 'added' | 'removed' | 'changed' | 'moved'

export interface CvChange {
  kind: ChangeKind
  /** Libellé de rubrique (« Identité », « Expériences », titre d'une rubrique libre…). */
  section: string
  /** Identifiant technique de la rubrique (`identity`, `links`, `sections` ou un `SectionId`). */
  sectionId: SectionId | 'identity' | 'links' | 'sections'
  /** Élément concerné (« Cheffe de projet · Société », « Mission Banque Fictive »…), vide pour un champ unique. */
  item: string
  /** Champ modifié (« Intitulé », « Dates »…), vide pour un ajout ou une suppression d'élément. */
  field: string
  before: string
  after: string
}

const FIELD_LABELS: Record<string, string> = {
  firstName: 'Prénom',
  lastName: 'Nom',
  headline: 'Titre',
  email: 'E-mail',
  phone: 'Téléphone',
  location: 'Localisation',
  details: 'Mentions',
  photo: 'Photo',
  label: 'Libellé',
  url: 'Adresse',
  title: 'Intitulé',
  company: 'Entreprise',
  client: 'Client',
  role: 'Rôle',
  startDate: 'Début',
  endDate: 'Fin',
  current: 'Poste actuel',
  parallel: 'En parallèle',
  description: 'Description',
  achievements: 'Réalisations',
  skills: 'Compétences',
  category: 'Catégorie',
  kind: 'Type',
  items: 'Éléments',
  degree: 'Diplôme',
  school: 'Établissement',
  name: 'Nom',
  issuer: 'Organisme',
  date: 'Date',
  level: 'Niveau',
  outlet: 'Média',
  text: 'Texte',
  subtitle: 'Sous-titre',
}

type Entity = { id: string } & Record<string, unknown>

const show = (v: unknown, field: string): string => {
  if (field === 'photo') return v ? '(photo)' : ''
  if (v === null) return field === 'endDate' ? 'en cours' : ''
  if (typeof v === 'boolean') return v ? 'oui' : 'non'
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x && 'text' in x ? String((x as { text: string }).text) : String(x))).join(' · ')
  if (field === 'kind' && typeof v === 'string' && v in PUBLICATION_KIND_LABELS) return PUBLICATION_KIND_LABELS[v as keyof typeof PUBLICATION_KIND_LABELS]
  if (field === 'kind' && (v === 'technical' || v === 'soft')) return v === 'technical' ? 'Techniques' : 'Savoir-être'
  return String(v ?? '')
}

const join = (...parts: unknown[]) =>
  parts
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' · ')

/** Compare les champs simples de deux objets (les sous-listes `missions` sont traitées à part). */
function fieldChanges(a: Entity, b: Entity, base: Omit<CvChange, 'kind' | 'field' | 'before' | 'after'>, skip: string[] = []): CvChange[] {
  const out: CvChange[] = []
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== 'id' && !skip.includes(k))
  for (const k of keys) {
    if (k === 'achievements') continue
    const before = show(a[k], k)
    const after = show(b[k], k)
    if (before !== after) out.push({ ...base, kind: 'changed', field: FIELD_LABELS[k] ?? k, before, after })
  }
  if ('achievements' in a || 'achievements' in b) out.push(...listChanges((a.achievements ?? []) as Entity[], (b.achievements ?? []) as Entity[], { ...base, field: FIELD_LABELS.achievements! }))
  return out
}

/** Ajouts, suppressions et modifications des réalisations (identifiées par `id`). */
function listChanges(a: Entity[], b: Entity[], base: Omit<CvChange, 'kind' | 'before' | 'after'>): CvChange[] {
  const out: CvChange[] = []
  const after = new Map(b.map((x) => [x.id, x]))
  const before = new Map(a.map((x) => [x.id, x]))
  for (const x of a) if (!after.has(x.id)) out.push({ ...base, kind: 'removed', before: String(x.text ?? ''), after: '' })
  for (const y of b) {
    const x = before.get(y.id)
    if (!x) out.push({ ...base, kind: 'added', before: '', after: String(y.text ?? '') })
    else if (x.text !== y.text) out.push({ ...base, kind: 'changed', before: String(x.text ?? ''), after: String(y.text ?? '') })
  }
  if (orderChanged(a, b)) out.push({ ...base, kind: 'moved', before: '', after: '' })
  return out
}

function orderChanged(a: { id: string }[], b: { id: string }[]): boolean {
  const ids = new Set(b.map((x) => x.id))
  const common = a.map((x) => x.id).filter((id) => ids.has(id))
  const kept = new Set(common)
  const commonB = b.map((x) => x.id).filter((id) => kept.has(id))
  return common.some((id, i) => commonB[i] !== id)
}

/** Compare une rubrique d'entités identifiées par `id`. */
function entityChanges<T extends { id: string }>(
  a: T[],
  b: T[],
  section: string,
  sid: CvChange['sectionId'],
  labelOf: (x: T) => string,
  nested?: (x: T, y: T, item: string) => CvChange[],
  skip: string[] = [],
): CvChange[] {
  const out: CvChange[] = []
  const after = new Map(b.map((x) => [x.id, x]))
  const before = new Map(a.map((x) => [x.id, x]))
  for (const x of a) if (!after.has(x.id)) out.push({ kind: 'removed', section, sectionId: sid, item: labelOf(x), field: '', before: labelOf(x), after: '' })
  for (const y of b) {
    const x = before.get(y.id)
    if (!x) {
      out.push({ kind: 'added', section, sectionId: sid, item: labelOf(y), field: '', before: '', after: labelOf(y) })
      continue
    }
    const item = labelOf(y) || labelOf(x)
    out.push(...fieldChanges(x as unknown as Entity, y as unknown as Entity, { section, sectionId: sid, item }, skip))
    if (nested) out.push(...nested(x, y, item))
  }
  if (orderChanged(a, b)) out.push({ kind: 'moved', section, sectionId: sid, item: '', field: 'Ordre', before: a.map(labelOf).join(' / '), after: b.map(labelOf).join(' / ') })
  return out
}

/**
 * Changements entre deux versions d'un profil, dans l'ordre du document : identité, liens, résumé,
 * puis chaque rubrique (missions comprises), enfin l'ordre et la visibilité des rubriques.
 */
export function diffCv(before: ProfileData, after: ProfileData): CvChange[] {
  const out: CvChange[] = []
  const L = SECTION_LABELS

  out.push(...fieldChanges(before.identity as unknown as Entity, after.identity as unknown as Entity, { section: 'Identité', sectionId: 'identity', item: '' }))
  out.push(...entityChanges(before.links, after.links, 'Liens', 'links', (l) => l.label || l.url))
  if (before.summary !== after.summary) out.push({ kind: 'changed', section: L.summary, sectionId: 'summary', item: '', field: 'Texte', before: before.summary, after: after.summary })

  out.push(
    ...entityChanges(before.experiences, after.experiences, L.experiences, 'experiences', (e) => join(e.title, e.company), (x, y, item) =>
      entityChanges(x.missions, y.missions, L.experiences, 'experiences', (m) => `${item} › ${join(m.client, m.role) || 'mission'}`),
      ['missions'],
    ),
  )
  out.push(...entityChanges(before.skills, after.skills, L.skills, 'skills', (s) => s.category || 'Compétences'))
  out.push(...entityChanges(before.education, after.education, L.education, 'education', (e) => join(e.degree, e.school)))
  out.push(...entityChanges(before.certifications, after.certifications, L.certifications, 'certifications', (c) => c.name))
  out.push(...entityChanges(before.languages, after.languages, L.languages, 'languages', (l) => l.name))
  out.push(...entityChanges(before.projects, after.projects, L.projects, 'projects', (p) => p.name))
  out.push(...entityChanges(before.awards, after.awards, L.awards, 'awards', (a) => a.title))
  out.push(...entityChanges(before.publications, after.publications, L.publications, 'publications', (p) => p.title))
  out.push(...entityChanges(before.interests, after.interests, L.interests, 'interests', (i) => i.text))

  // Rubriques libres : une rubrique = un bloc ; ses entrées sont comparées sous son titre.
  const customAfter = new Map(after.customSections.map((c) => [c.id, c]))
  const customBefore = new Map(before.customSections.map((c) => [c.id, c]))
  for (const c of before.customSections) {
    if (!customAfter.has(c.id)) out.push({ kind: 'removed', section: c.title || 'Rubrique libre', sectionId: `custom:${c.id}`, item: '', field: '', before: c.title, after: '' })
  }
  for (const c of after.customSections) {
    const sid: SectionId = `custom:${c.id}`
    const prev = customBefore.get(c.id)
    const name = c.title || prev?.title || 'Rubrique libre'
    if (!prev) {
      out.push({ kind: 'added', section: name, sectionId: sid, item: '', field: '', before: '', after: c.title })
      continue
    }
    if (prev.title !== c.title) out.push({ kind: 'changed', section: name, sectionId: sid, item: '', field: 'Titre de la rubrique', before: prev.title, after: c.title })
    out.push(...entityChanges(prev.entries, c.entries, name, sid, (e) => e.title))
  }

  // Ordre et visibilité des rubriques
  const visBefore = new Map(before.sections.map((s) => [sectionId(s), s.visible]))
  for (const s of after.sections) {
    const sid = sectionId(s)
    const was = visBefore.get(sid)
    if (was !== undefined && was !== s.visible) {
      out.push({ kind: 'changed', section: 'Rubriques', sectionId: 'sections', item: sectionLabel(after, sid), field: 'Visible', before: was ? 'oui' : 'non', after: s.visible ? 'oui' : 'non' })
    }
  }
  const order = (p: ProfileData) => p.sections.map((s) => ({ id: sectionId(s) }))
  if (orderChanged(order(before), order(after))) {
    out.push({
      kind: 'moved',
      section: 'Rubriques',
      sectionId: 'sections',
      item: '',
      field: 'Ordre',
      before: before.sections.map((s) => sectionLabel(before, sectionId(s))).join(' / '),
      after: after.sections.map((s) => sectionLabel(after, sectionId(s))).join(' / '),
    })
  }
  return out
}

// ── Différence de texte ──────────────────────────────────────────────────────

export interface DiffLine {
  op: 'equal' | 'add' | 'del'
  text: string
}

/** Au-delà, la table LCS deviendrait trop lourde : on compare en bloc. */
const MAX_CELLS = 4_000_000

/**
 * Différence ligne à ligne (plus longue sous-suite commune), préfixe et suffixe communs mis de côté.
 * Les suppressions précèdent les ajouts dans un bloc modifié.
 */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a === '' ? [] : a.split(/\r?\n/)
  const B = b === '' ? [] : b.split(/\r?\n/)
  let start = 0
  while (start < A.length && start < B.length && A[start] === B[start]) start++
  let endA = A.length
  let endB = B.length
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--
    endB--
  }
  const head: DiffLine[] = A.slice(0, start).map((text) => ({ op: 'equal', text }))
  const tail: DiffLine[] = A.slice(endA).map((text) => ({ op: 'equal', text }))
  const x = A.slice(start, endA)
  const y = B.slice(start, endB)
  const n = x.length
  const m = y.length

  if (n * m > MAX_CELLS) {
    return [...head, ...x.map((text): DiffLine => ({ op: 'del', text })), ...y.map((text): DiffLine => ({ op: 'add', text })), ...tail]
  }

  // lcs[i][j] = longueur de la LCS de x[i..] et y[j..], en tableau plat.
  const w = m + 1
  const lcs = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!)
    }
  }
  const middle: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      middle.push({ op: 'equal', text: x[i]! })
      i++
      j++
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      middle.push({ op: 'del', text: x[i]! })
      i++
    } else {
      middle.push({ op: 'add', text: y[j]! })
      j++
    }
  }
  while (i < n) middle.push({ op: 'del', text: x[i++]! })
  while (j < m) middle.push({ op: 'add', text: y[j++]! })
  return [...head, ...middle, ...tail]
}

/** Nombre de lignes ajoutées et supprimées. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return { added: lines.filter((l) => l.op === 'add').length, removed: lines.filter((l) => l.op === 'del').length }
}
