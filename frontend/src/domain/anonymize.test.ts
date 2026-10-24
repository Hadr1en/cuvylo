import { describe, expect, it } from 'vitest'
import { sampleProfileV2 } from '@/ats/testing'
import { anonymizeProfile, cityOnly, initials } from './anonymize'
import { ProfileSchema } from './profile'

describe('initials', () => {
  it.each([
    ['Camille', 'C.'],
    ['Jean-Pierre', 'J.-P.'],
    ['de La Fontaine', 'L. F.'],
    ['Łukasz', 'Ł.'],
    ['van der Berg', 'B.'],
    ["d'Artagnan", 'A.'],
    ['  ', ''],
  ])('« %s » → « %s »', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })
})

describe('cityOnly', () => {
  it.each([
    ['Lille, France', 'Lille, France'],
    ['12 rue des Lilas, 59000 Lille, France', 'Lille, France'],
    ['Bâtiment B, 3 allée Verte, 75011 Paris', 'Paris'],
    ['Lyon (69)', 'Lyon'],
    ['Nantes 44000', 'Nantes'],
    ['', ''],
  ])('« %s » → « %s »', (loc, expected) => {
    expect(cityOnly(loc)).toBe(expected)
  })
})

describe('anonymizeProfile', () => {
  const source = (() => {
    const p = sampleProfileV2()
    p.identity.photo = 'data:image/png;base64,iVBORw0KGgo='
    p.identity.location = '12 rue des Lilas, 59000 Lille, France'
    p.summary = 'Camille Exemple, cheffe de projet. Contact : camille.exemple@example.test ou 06 00 00 00 00.'
    p.projects[0]!.url = 'https://camille.example.test/guide'
    p.publications[0]!.url = 'https://magazine.example.test/article'
    p.certifications[0]!.url = 'https://cert.example.test/123'
    p.customSections[0]!.entries[0]!.description = 'Ateliers animés par Camille.'
    return p
  })()
  const anon = anonymizeProfile(source)

  it('initiales seulement, sans coordonnées, liens, photo ni mentions personnelles', () => {
    expect(anon.identity).toEqual({
      firstName: 'C.',
      lastName: 'E.',
      headline: 'Cheffe de projet cybersécurité',
      email: '',
      phone: '',
      location: 'Lille, France',
      details: '',
      photo: '',
    })
    expect(anon.links).toEqual([])
    expect(anon.projects[0]!.url).toBe('')
    expect(anon.publications[0]!.url).toBe('')
    expect(anon.certifications[0]!.url).toBe('')
  })

  it('retire nom, e-mail et téléphone recopiés dans les textes libres', () => {
    expect(anon.summary).toBe('C. E., cheffe de projet. Contact : ou .')
    expect(anon.customSections[0]!.entries[0]!.description).toBe('Ateliers animés par C..')
    const all = JSON.stringify(anon)
    for (const s of ['Camille', 'Camille Exemple', 'camille.exemple', '06 00 00 00 00', '+33', 'iVBOR', 'rue des Lilas', '59000']) expect(all, s).not.toContain(s)
  })

  it('dans les intitulés, seul le nom complet est retiré (un nom peut être un mot ordinaire)', () => {
    // « Exemple » est aussi le nom de famille : l'intitulé « Association Numérique Exemple » reste intact.
    expect(anon.customSections[0]!.entries[0]!.subtitle).toBe('Association Numérique Exemple')
    const p = sampleProfileV2()
    p.customSections[0]!.entries[0]!.title = 'Blog de Camille Exemple'
    expect(anonymizeProfile(p).customSections[0]!.entries[0]!.title).toBe('Blog de C. E.')
  })

  it('conserve le parcours (postes, entreprises, clients, dates, compétences)', () => {
    expect(anon.experiences.map((e) => e.company)).toEqual(source.experiences.map((e) => e.company))
    expect(anon.experiences[1]!.missions.map((m) => [m.client, m.startDate, m.skills])).toEqual(source.experiences[1]!.missions.map((m) => [m.client, m.startDate, m.skills]))
  })

  it('ne modifie pas l’original et reste un profil valide', () => {
    expect(source.identity.firstName).toBe('Camille')
    expect(ProfileSchema.safeParse(anon).success).toBe(true)
  })
})
