import { strFromU8, unzipSync } from 'fflate'
import { dateIndex, emptyProfile, type Experience, type ProfileData } from '@/domain/profile'
import { csvRecords } from './csv'
import { LIMITS, clip, cleanUrl, defaultIds, finalizeProfile, parseLooseDate, skillList, type IdFactory } from './common'

/**
 * Import de l'export officiel des données LinkedIn (« Obtenir une copie de vos données », archive ZIP),
 * lu entièrement dans le navigateur : ni scraping, ni API, ni réseau. Fichiers reconnus :
 * Profile, Positions, Education, Skills, Languages, Certifications, Projects, Honors, Publications
 * (+ Email Addresses et PhoneNumbers s'ils sont présents).
 */

export const LINKEDIN_FILES = ['Profile', 'Positions', 'Education', 'Skills', 'Languages', 'Certifications', 'Projects', 'Honors', 'Publications', 'Email Addresses', 'PhoneNumbers'] as const
export type LinkedInFile = (typeof LINKEDIN_FILES)[number]

export interface LinkedInImport {
  data: ProfileData
  /** Fichiers lus, éléments écartés, points à vérifier. */
  notes: string[]
}

const BULLET = /^\s*[•·▪►✓*–—-]\s*/u

const LEVELS: [RegExp, string][] = [
  [/native|bilingual|maternelle|bilingue/i, 'Langue maternelle ou bilingue'],
  [/full professional|complète|complet/i, 'Courant (professionnel complet)'],
  [/professional working|professionnelle|professionnel/i, 'Professionnel'],
  [/limited working|limitée|limité/i, 'Intermédiaire'],
  [/elementary|notions|élémentaire/i, 'Notions'],
]

const WEBSITE_LABELS: Record<string, string> = { PERSONAL: 'Site personnel', COMPANY: 'Entreprise', BLOG: 'Blog', PORTFOLIO: 'Portfolio', RSS: 'Flux RSS', OTHER: 'Site web' }

/** « [PORTFOLIO:https://a.fr,BLOG:https://b.fr] » → liens libellés. */
export function parseWebsites(value: string): { label: string; url: string }[] {
  const inner = value.trim().replace(/^\[|\]$/g, '')
  if (!inner) return []
  return inner
    .split(/,(?=\s*(?:[A-Z]+:)?https?:)/)
    .map((part) => {
      const m = /^\s*(?:([A-Z]+):)?(.+)$/.exec(part)
      return { label: WEBSITE_LABELS[m?.[1] ?? 'OTHER'] ?? 'Site web', url: cleanUrl(m?.[2]) }
    })
    .filter((l) => l.url)
}

/** Description LinkedIn → description + réalisations (les lignes à puce deviennent des réalisations). */
export function splitDescription(text: string): { description: string; achievements: string[] } {
  const desc: string[] = []
  const achievements: string[] = []
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) continue
    if (BULLET.test(line)) achievements.push(line.replace(BULLET, '').trim())
    else desc.push(line.trim())
  }
  return { description: desc.join('\n'), achievements }
}

/** Contenu texte des fichiers CSV par nom (sans extension ni dossier). */
export function readLinkedInZip(bytes: Uint8Array): Partial<Record<LinkedInFile, string>> {
  const wanted = new Map(LINKEDIN_FILES.map((f) => [`${f.toLowerCase()}.csv`, f]))
  const files = unzipSync(bytes, { filter: (f) => wanted.has(f.name.split('/').pop()!.toLowerCase()) })
  const out: Partial<Record<LinkedInFile, string>> = {}
  for (const [name, content] of Object.entries(files)) {
    const key = wanted.get(name.split('/').pop()!.toLowerCase())
    if (key && out[key] === undefined) out[key] = strFromU8(content)
  }
  return out
}

/** Archive ZIP de l'export LinkedIn → profil v2 (brouillon à relire). */
export async function importLinkedInZip(bytes: Uint8Array, opts: { makeId?: IdFactory } = {}): Promise<LinkedInImport> {
  let files: Partial<Record<LinkedInFile, string>>
  try {
    files = readLinkedInZip(bytes)
  } catch {
    return { data: emptyProfile(), notes: ['Archive illisible : déposez le fichier ZIP tel que LinkedIn l’a fourni.'] }
  }
  return importLinkedInFiles(files, opts)
}

export function importLinkedInFiles(files: Partial<Record<LinkedInFile, string>>, opts: { makeId?: IdFactory } = {}): LinkedInImport {
  const makeId = opts.makeId ?? defaultIds
  const notes: string[] = []
  const data = emptyProfile()
  const read = (f: LinkedInFile, required: string) => (files[f] ? csvRecords(files[f]!, required) : [])

  const found = LINKEDIN_FILES.filter((f) => files[f] !== undefined)
  if (found.length === 0) return { data, notes: ['Aucun fichier LinkedIn reconnu dans l’archive (Profile.csv, Positions.csv…).'] }
  notes.push(`Fichiers lus : ${found.map((f) => `${f}.csv`).join(', ')}.`)
  const missing = (['Profile', 'Positions', 'Education', 'Skills'] as const).filter((f) => files[f] === undefined)
  if (missing.length) notes.push(`Absents de l’archive : ${missing.map((f) => `${f}.csv`).join(', ')} (export partiel ?).`)

  // Identité
  const profile = read('Profile', 'First Name')[0]
  if (profile) {
    data.identity.firstName = clip(profile['First Name'])
    data.identity.lastName = clip(profile['Last Name'])
    data.identity.headline = clip(profile['Headline'])
    data.identity.location = clip(profile['Geo Location'] || profile['Address'])
    data.summary = clip(profile['Summary'], LIMITS.long)
    for (const l of parseWebsites(profile['Websites'] ?? '')) data.links.push({ id: makeId(), ...l })
    const twitter = clip(profile['Twitter Handles']).replace(/^\[|\]$/g, '').split(',')[0]?.trim().replace(/^@/, '')
    if (twitter) data.links.push({ id: makeId(), label: 'X (Twitter)', url: `https://x.com/${twitter}` })
  }
  const emails = read('Email Addresses', 'Email Address')
  data.identity.email = clip((emails.find((e) => /^(yes|oui)$/i.test(e['Primary'] ?? '')) ?? emails[0])?.['Email Address'])
  data.identity.phone = clip(read('PhoneNumbers', 'Number')[0]?.['Number'])

  // Expériences : plus récente d'abord
  const experiences: Experience[] = read('Positions', 'Company Name').map((p) => {
    const start = parseLooseDate(p['Started On'])
    const end = parseLooseDate(p['Finished On'])
    const current = end.ongoing || (!end.value && !!start.value)
    const { description, achievements } = splitDescription(p['Description'] ?? '')
    return {
      id: makeId(),
      title: clip(p['Title']),
      company: clip(p['Company Name']),
      location: clip(p['Location']),
      startDate: start.value,
      endDate: current ? null : end.value,
      current,
      description: clip(description, LIMITS.long),
      achievements: achievements.map((text) => ({ id: makeId(), text: clip(text, LIMITS.long) })),
      parallel: false,
      skills: [],
      missions: [],
    }
  })
  const startOf = (e: Experience) => dateIndex(e.startDate, 'start') ?? -1
  data.experiences = experiences.sort((a, b) => startOf(b) - startOf(a))
  const currents = data.experiences.filter((e) => e.current)
  if (currents.length > 1) notes.push(`${currents.length} postes en cours : cochez « en parallèle » pour les activités menées en même temps (freelance, bénévolat…).`)

  data.education = read('Education', 'School Name').map((e) => ({
    id: makeId(),
    degree: clip(e['Degree Name']),
    school: clip(e['School Name']),
    location: '',
    startDate: parseLooseDate(e['Start Date']).value,
    endDate: parseLooseDate(e['End Date']).value,
    description: clip([e['Notes'], e['Activities']].filter((s) => s?.trim()).join('\n'), LIMITS.long),
  }))

  const skills = skillList(read('Skills', 'Name').map((s) => s['Name']))
  for (let i = 0; i < skills.length; i += LIMITS.skills) {
    data.skills.push({ id: makeId(), category: i === 0 ? 'Compétences' : 'Compétences (suite)', kind: 'technical', items: skills.slice(i, i + LIMITS.skills) })
  }
  if (skills.length) notes.push('Compétences importées en un seul groupe : classez-les (techniques, savoir-être) et retirez celles qui ne sont plus d’actualité.')

  data.languages = read('Languages', 'Name').map((l) => ({
    id: makeId(),
    name: clip(l['Name']),
    level: clip(LEVELS.find(([re]) => re.test(l['Proficiency'] ?? ''))?.[1] ?? l['Proficiency']),
  }))
  data.certifications = read('Certifications', 'Name').map((c) => ({ id: makeId(), name: clip(c['Name']), issuer: clip(c['Authority']), date: parseLooseDate(c['Started On']).value, url: cleanUrl(c['Url']) }))
  data.projects = read('Projects', 'Title').map((p) => ({
    id: makeId(),
    name: clip(p['Title']),
    role: '',
    startDate: parseLooseDate(p['Started On']).value,
    endDate: parseLooseDate(p['Finished On']).value,
    url: cleanUrl(p['Url']),
    description: clip(p['Description'], LIMITS.long),
    skills: [],
  }))
  data.awards = read('Honors', 'Title').map((h) => ({ id: makeId(), title: clip(h['Title']), issuer: clip(h['Issuer'] ?? h['Associated With'] ?? ''), date: parseLooseDate(h['Issued On']).value, description: clip(h['Description'], LIMITS.long) }))
  data.publications = read('Publications', 'Name').map((p) => ({
    id: makeId(),
    title: clip(p['Name']),
    outlet: clip(p['Publisher']),
    date: parseLooseDate(p['Published On']).value,
    url: cleanUrl(p['Url']),
    kind: 'article' as const,
    description: clip(p['Description'], LIMITS.long),
  }))

  notes.push('Brouillon importé : relisez chaque rubrique (LinkedIn n’exporte ni missions clients, ni compétences par poste, ni photo).')
  return { data: finalizeProfile(data, notes), notes }
}
