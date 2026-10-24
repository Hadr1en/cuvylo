import type { Issue } from '@/hooks/useAutosave'
import { ProfileSchema, SECTION_LABELS, type ProfileData, type SectionKey } from './profile'

const FIELD_LABELS: Record<string, string> = {
  firstName: 'Prénom',
  lastName: 'Nom',
  headline: 'Titre',
  email: 'E-mail',
  phone: 'Téléphone',
  location: 'Lieu',
  details: 'Informations complémentaires',
  photo: 'Photo',
  url: 'Adresse',
  startDate: 'Début',
  endDate: 'Fin',
  date: 'Date',
  title: 'Intitulé',
  company: 'Entreprise',
  client: 'Client',
  role: 'Rôle',
  description: 'Description',
  text: 'Texte',
  name: 'Nom',
  label: 'Libellé',
  sections: 'Ordre des rubriques',
}

const DATE_FIELDS = new Set(['startDate', 'endDate', 'date'])

function message(code: string, last: string, fallback: string, max?: number): string {
  if (code === 'too_big') return max ? `Trop long (${max} caractères au plus).` : 'Trop d’éléments.'
  if (DATE_FIELDS.has(last) && (code === 'invalid_union' || code === 'invalid_format')) return 'Date invalide : AAAA ou AAAA-MM.'
  return fallback.endsWith('.') ? fallback : `${fallback}.`
}

/**
 * Validation locale d'un profil ou d'un CV, avec des messages lisibles. Les chemins suivent
 * la structure des données (« experiences.0.endDate ») pour pouvoir s'afficher sous le bon champ.
 */
export function validateProfile(p: ProfileData): Issue[] {
  const r = ProfileSchema.safeParse(p)
  if (r.success) return []
  return r.error.issues.slice(0, 20).map((i) => {
    const path = i.path.map(String).join('.')
    const last = String(i.path[i.path.length - 1] ?? '')
    const max = 'maximum' in i && typeof i.maximum === 'number' ? i.maximum : undefined
    return { path, message: message(i.code, last, i.message, max) }
  })
}

/** « experiences.0.endDate » → « Expériences › Cheffe de projet › Fin ». */
export function describeIssuePath(p: ProfileData, path: string): string {
  const parts = path.split('.')
  const out: string[] = []
  const [root, index, ...rest] = parts
  if (!root) return ''
  if (root === 'identity') out.push('Identité')
  else if (root === 'links') out.push('Liens')
  else if (root === 'customSections') out.push(p.customSections[Number(index)]?.title || 'Rubrique libre')
  else if (root in SECTION_LABELS) out.push(SECTION_LABELS[root as SectionKey])
  else out.push(FIELD_LABELS[root] ?? root)

  if (index !== undefined && /^\d+$/.test(index) && root !== 'customSections') {
    const item = (p as unknown as Record<string, unknown[]>)[root]?.[Number(index)] as Record<string, unknown> | undefined
    const name = item && (item.title || item.name || item.degree || item.label || item.category || item.text)
    out.push(typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : `élément ${Number(index) + 1}`)
  } else if (index !== undefined && root === 'identity') {
    out.push(FIELD_LABELS[index] ?? index)
  }
  const field = rest.filter((x) => !/^\d+$/.test(x)).pop()
  if (field && root !== 'identity') out.push(FIELD_LABELS[field] ?? field)
  return out.join(' › ')
}
