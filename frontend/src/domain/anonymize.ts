import type { ProfileData } from './profile'

/**
 * Anonymisation d'un profil pour un dossier de compétences ou un partage (réglage `anonymize`).
 * - nom et prénom réduits aux initiales (« Jean-Pierre » → « J.-P. ») ;
 * - e-mail, téléphone, photo, mentions personnelles (`details`) et tous les liens supprimés
 *   (liens de profil, mais aussi adresses de projets, publications et certifications) ;
 * - localisation ramenée à la ville (rue, numéro et code postal retirés) ;
 * - nom, prénom, e-mail et téléphone retirés aussi des textes libres où ils seraient recopiés.
 * Le parcours (postes, entreprises, clients, dates) est conservé : c'est l'objet du dossier.
 * Ne modifie pas l'objet reçu.
 */
export function anonymizeProfile(data: ProfileData): ProfileData {
  const doc = structuredClone(data)
  const { firstName, lastName, email, phone } = data.identity
  // Textes rédigés : nom complet, prénom ou nom seuls (avec majuscule), e-mail, téléphone.
  const scrub = makeScrubber(firstName, lastName, email, phone, true)
  // Intitulés (où un nom seul peut être un mot ordinaire, « Livre Blanc ») : nom complet seulement.
  const scrubFull = makeScrubber(firstName, lastName, email, phone, false)

  doc.identity = {
    firstName: initials(firstName),
    lastName: initials(lastName),
    headline: scrub(data.identity.headline),
    email: '',
    phone: '',
    location: cityOnly(data.identity.location),
    details: '',
    photo: '',
  }
  doc.links = []
  doc.summary = scrub(doc.summary)
  for (const e of doc.experiences) {
    e.description = scrub(e.description)
    for (const a of e.achievements) a.text = scrub(a.text)
    for (const m of e.missions) {
      m.description = scrub(m.description)
      for (const a of m.achievements) a.text = scrub(a.text)
    }
  }
  for (const e of doc.education) e.description = scrub(e.description)
  for (const c of doc.certifications) c.url = ''
  for (const p of doc.projects) {
    p.url = ''
    p.description = scrub(p.description)
  }
  for (const a of doc.awards) a.description = scrub(a.description)
  for (const p of doc.publications) {
    p.url = ''
    p.description = scrub(p.description)
  }
  for (const i of doc.interests) i.text = scrub(i.text)
  for (const c of doc.customSections) {
    for (const e of c.entries) {
      e.title = scrubFull(e.title)
      e.subtitle = scrubFull(e.subtitle)
      e.description = scrub(e.description)
    }
  }
  return doc
}

const PARTICLES = new Set(['de', 'du', 'des', 'la', 'le', 'van', 'von', 'der', 'den', 'da', 'di', 'del', 'dos', 'das', 'y', 'e', 'af', 'zu', 'ten', 'ter'])

/** « Jean-Pierre » → « J.-P. » ; « de La Fontaine » → « L. F. » ; « O’Neil » → « O. ». */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    // Les particules ne comptent qu'en minuscules : « de La Fontaine » → « L. F. ».
    .filter((w) => w && !PARTICLES.has(w.replace(/['’]$/, '')) && !/^d['’]$/.test(w))
    .map((w) =>
      w
        .split('-')
        .map((part) => {
          const letter = /\p{L}/u.exec(part.replace(/^(?:d|l)['’](?=\p{L})/iu, ''))?.[0]
          return letter ? `${letter.toUpperCase()}.` : ''
        })
        .filter(Boolean)
        .join('-'),
    )
    .filter(Boolean)
    .join(' ')
}

const STREET = /\b(rue|avenue|av\.|bd|boulevard|chemin|all[ée]e|place|impasse|quai|route|cours|square|r[ée]sidence|lieu-dit|lotissement|b[âa]t(iment)?|appt?|appartement|cedex|bp)\b/iu

/**
 * Localisation au niveau de la ville : « 12 rue des Lilas, 59000 Lille, France » → « Lille, France ».
 * Les segments portant une rue ou un numéro sont retirés ; un code postal collé à la ville est ôté.
 */
export function cityOnly(location: string): string {
  return location
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !STREET.test(s))
    .map((s) => s.replace(/^\d{4,5}\s+/, '').replace(/\s+\d{4,5}$/, '').replace(/\s*\(\d{2,3}\)\s*$/, '').trim())
    .filter((s) => s && !/\d/.test(s))
    .join(', ')
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** Retire des textes libres les éléments identifiants recopiés (nom, prénom, e-mail, téléphone). */
function makeScrubber(firstName: string, lastName: string, email: string, phone: string, singleNames: boolean): (text: string) => string {
  const replacements: [RegExp, string][] = []
  if (email.trim()) replacements.push([new RegExp(escapeRe(email.trim()), 'giu'), ''])
  const digits = phone.replace(/\D/g, '')
  if (digits.length >= 8) {
    // Même numéro quel que soit le séparateur (« 06 12 34 56 78 », « +33 6 12… », « 06.12… »).
    const tail = digits.slice(-9)
    replacements.push([new RegExp(`(?:\\+\\d{1,3}[\\s.-]?)?(?:\\(0\\)[\\s.-]?)?0?${tail.split('').join('[\\s.-]?')}`, 'g'), ''])
  }
  const full = [firstName, lastName].map((s) => s.trim()).filter(Boolean)
  if (full.length === 2) replacements.push([new RegExp(`(?<![\\p{L}])${escapeRe(full.join(' '))}(?![\\p{L}])`, 'giu'), `${initials(firstName)} ${initials(lastName)}`])
  for (const n of singleNames ? full : []) {
    if (n.length >= 3) replacements.push([new RegExp(`(?<![\\p{L}])${escapeRe(n)}(?![\\p{L}])`, 'gu'), initials(n)])
  }
  return (text) => {
    let out = text
    for (const [re, by] of replacements) out = out.replace(re, by)
    return out.replace(/[ \t]{2,}/g, ' ')
  }
}
