import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { ProfileSchema, type ProfileData } from '@/domain/profile'
import { fakePdf, sampleProfileV2 } from '@/ats/testing'
import { clip, cleanUrl, parseLooseDate, sequentialIds } from './common'
import { csvRecords, parseCsv } from './csv'
import { fromJsonResume, toJsonResume } from './jsonresume'
import { importLinkedInFiles, importLinkedInZip, parseWebsites, splitDescription } from './linkedin'
import { DRAFT_SECTION_TITLE, scanPdf } from './pdfscan'

/** Caractères invisibles, écrits par leur code pour rester lisibles dans le source. */
const BOM = String.fromCodePoint(0xfeff)
const RLO = String.fromCodePoint(0x202e)
const REPLACEMENT = String.fromCodePoint(0xfffd)
/** Icônes Font Awesome (zone d'usage privé) : enveloppe et téléphone. */
const ICON_MAIL = String.fromCodePoint(0xf0e0)
const ICON_PHONE = String.fromCodePoint(0xf095)

const valid = (d: ProfileData) => {
  const r = ProfileSchema.safeParse(d)
  if (!r.success) throw new Error(JSON.stringify(r.error.issues.slice(0, 3)))
  return true
}

describe('CSV', () => {
  it('guillemets, guillemets doublés, retours à la ligne dans un champ, BOM, CRLF', () => {
    const csv = BOM + 'Name,Description\r\n"Dupont, Jean","Ligne 1\r\nLigne ""2"""\r\nSimple,\r\n\r\n'
    expect(parseCsv(csv)).toEqual([
      ['Name', 'Description'],
      ['Dupont, Jean', 'Ligne 1\r\nLigne "2"'],
      ['Simple', ''],
    ])
  })

  it('séparateur point-virgule détecté', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('en-tête trouvé après des lignes de notes', () => {
    const csv = 'Notes:\n"Exporté le 01/10/2026"\n\nFirst Name,Last Name\nCamille,Exemple'
    expect(csvRecords(csv, 'First Name')).toEqual([{ 'First Name': 'Camille', 'Last Name': 'Exemple' }])
    expect(csvRecords(csv, 'Absente')).toEqual([])
  })
})

describe('dates souples', () => {
  it.each([
    ['2021', '2021'],
    ['2021-03', '2021-03'],
    ['2021-03-15', '2021-03'],
    ['Mar 2021', '2021-03'],
    ['March 2021', '2021-03'],
    ['mars 2021', '2021-03'],
    ['janv. 2021', '2021-01'],
    ['févr. 2019', '2019-02'],
    ['Aug 2020', '2020-08'],
    ['août 2020', '2020-08'],
    ['03/2021', '2021-03'],
    ['15/03/2021', '2021-03'],
    ['Jan 15, 2020', '2020-01'],
    ['1er septembre 2018', '2018-09'],
    ['Été 2019', '2019'],
    ['', ''],
  ])('« %s » → « %s »', (input, value) => {
    expect(parseLooseDate(input).value).toBe(value)
  })

  it('« Present », « aujourd’hui », « en cours »', () => {
    for (const s of ['Present', 'présent', 'Aujourd’hui', 'en cours']) expect(parseLooseDate(s)).toEqual({ value: '', ongoing: true })
  })

  it('URL et texte nettoyés', () => {
    expect(cleanUrl('www.example.test/x')).toBe('https://www.example.test/x')
    expect(cleanUrl('javascript:alert(1)')).toBe('')
    expect(clip('a' + RLO + 'b\u0007 c  d')).toBe('ab c d')
    expect(clip('x'.repeat(300))).toHaveLength(200)
  })
})

describe('JSON Resume', () => {
  it('aller-retour sans perte (hors identifiants)', () => {
    const source = sampleProfileV2()
    const json = toJsonResume(source)
    const { data, notes } = fromJsonResume(JSON.parse(JSON.stringify(json)), { makeId: sequentialIds() })
    expect(notes).toEqual([])
    valid(data)
    const strip = (p: ProfileData) => JSON.parse(JSON.stringify(p, (k, v) => (k === 'id' ? undefined : v)))
    expect(strip(data)).toEqual(strip(source))
  })

  it('export conforme au schéma v1 : champs standard lisibles par les autres outils', () => {
    // Lecture libre du JSON produit (structure vérifiée champ par champ ci-dessous).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = toJsonResume(sampleProfileV2()) as Record<string, any>
    expect(json.basics).toMatchObject({ name: 'Camille Exemple', label: 'Cheffe de projet cybersécurité', email: 'camille.exemple@example.test', location: { city: 'Lille', region: 'France' } })
    expect(json.basics.profiles).toEqual([{ network: 'LinkedIn', url: 'https://www.linkedin.com/in/camille-exemple' }])
    expect(json.work[0]).toMatchObject({ name: 'Aéroport Fictif', position: 'Cheffe de projet sécurité', startDate: '2023-10', highlights: ['Pilotage de 12 homologations en 18 mois.', 'Création des indicateurs du comité de pilotage cyber.'] })
    expect(json.work[0].endDate).toBeUndefined()
    expect(json.work[1]['x-cuvylo'].missions).toHaveLength(2)
    expect(json.basics.image).toBeUndefined()
    expect(json.meta['x-cuvylo'].schemaVersion).toBe(2)
  })

  it('importe un JSON Resume tiers (sans extension)', () => {
    const { data, notes } = fromJsonResume(
      {
        basics: {
          name: 'Jean-Pierre de La Fontaine',
          label: 'Développeur web',
          email: 'jp@example.test',
          url: 'https://jp.example.test',
          location: { city: 'Nantes', countryCode: 'FR' },
          profiles: [{ network: 'GitHub', username: 'jpdlf' }, { network: 'Mastodon', username: 'jp' }],
          image: 'https://example.test/photo.jpg',
        },
        work: [{ name: 'Agence', position: 'Développeur', startDate: '2020-01-15', highlights: ['Refonte du site'] }],
        volunteer: [{ organization: 'Code Club', position: 'Animateur', startDate: '2018', endDate: '2019' }],
        education: [{ institution: 'IUT', studyType: 'DUT', area: 'Informatique', startDate: '2016', endDate: '2018', score: '14/20', courses: ['Réseaux'] }],
        skills: [{ name: 'Front', keywords: ['React', 'TypeScript'] }, { name: 'Docker' }],
        projects: [{ name: 'Outil', roles: ['Auteur'], highlights: ['500 utilisateurs'], keywords: ['Node.js'], url: 'notaurl' }],
        references: [{ name: 'X', reference: 'Y' }],
      },
      { makeId: sequentialIds() },
    )
    valid(data)
    expect(data.identity).toMatchObject({ firstName: 'Jean-Pierre', lastName: 'de La Fontaine', location: 'Nantes, FR', photo: '' })
    expect(data.links.map((l) => l.url)).toEqual(['https://jp.example.test', 'https://github.com/jpdlf'])
    expect(data.experiences[0]).toMatchObject({ company: 'Agence', startDate: '2020-01', current: true, endDate: null, parallel: false })
    expect(data.experiences[1]).toMatchObject({ company: 'Code Club', parallel: true, current: false, endDate: '2019' })
    expect(data.education[0]).toMatchObject({ degree: 'DUT Informatique', description: 'Résultat : 14/20\nCours : Réseaux' })
    expect(data.skills.map((s) => [s.category, s.items])).toEqual([
      ['Front', ['React', 'TypeScript']],
      ['', ['Docker']],
    ])
    expect(data.projects[0]).toMatchObject({ role: 'Auteur', url: '', description: '- 500 utilisateurs', skills: ['Node.js'] })
    expect(notes.join(' ')).toMatch(/Photo non reprise/)
    expect(notes.join(' ')).toMatch(/Mastodon/)
    expect(notes.join(' ')).toMatch(/1 référence/)
  })

  it('JSON illisible ou incohérent : profil vide valide et explication', () => {
    expect(fromJsonResume('{oops').notes[0]).toMatch(/JSON valide/)
    expect(fromJsonResume([1, 2]).notes[0]).toMatch(/objet/)
    const r = fromJsonResume({ work: [{ name: 'A', startDate: '2022', endDate: '2020' }], meta: { 'x-cuvylo': { sections: [{ key: 'bogus' }] } } })
    valid(r.data)
    expect(r.data.experiences[0]!.endDate).toBe('')
    expect(r.notes.join(' ')).toMatch(/fin précède le début/)
  })
})

// ── LinkedIn ─────────────────────────────────────────────────────────────────

const LINKEDIN: Record<string, string> = {
  'Profile.csv':
    BOM + 'First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers\n' +
    'Camille,Exemple,,,"Jan 1, 1990",Cheffe de projet cybersécurité,"Neuf ans entre conseil et grands comptes.\nPilotage d\'homologations.",Sécurité,,"Lille, Hauts-de-France, France",[camille_ex],"[PORTFOLIO:https://camille.example.test,BLOG:https://blog.example.test]",\n',
  'Positions.csv':
    'Company Name,Title,Description,Location,Started On,Finished On\n' +
    'Aéroport Fictif,Cheffe de projet sécurité,"Homologation des systèmes de sûreté.\n• Pilotage de 12 homologations en 18 mois.\n• Création des indicateurs cyber.","Lille, France",Oct 2023,\n' +
    'Indépendante,Rédactrice technologie,Articles et tests produits.,,2015,\n' +
    'Cabinet Imaginaire,Consultante cybersécurité,"Missions de conseil, ""grands comptes"".",Paris,janv. 2020,déc. 2023\n',
  'Education.csv': 'School Name,Start Date,End Date,Notes,Degree Name,Activities\nUniversité Fictive,2014,2015,,Licence professionnelle Réseaux et télécoms,BDE\n',
  'Skills.csv': 'Name\nEBIOS RM\nCyberArk\nQualys\nebios rm\n',
  'Languages.csv': 'Name,Proficiency\nAnglais,Full professional proficiency\nFrançais,Native or bilingual proficiency\n',
  'Certifications.csv': 'Name,Url,Authority,Started On,Finished On,License Number\nPRINCE2 Foundation,,PeopleCert,Mar 2021,,123\n',
  'Projects.csv': 'Title,Description,Url,Started On,Finished On\nGuide de sensibilisation,Diffusé à 3 000 collaborateurs.,https://guide.example.test,2021,2021\n',
  'Honors.csv': 'Title,Description,Issued On\nPrix du meilleur blog technologie,,2015\n',
  'Publications.csv': 'Name,Published On,Description,Publisher,Url\nLes rançongiciels expliqués,Mar 2022,,Magazine Fictif,\n',
  'Email Addresses.csv': 'Email Address,Confirmed,Primary,Updated On\nancienne@example.test,Yes,No,\ncamille.exemple@example.test,Yes,Yes,\n',
  'Connections.csv': 'Notes:\n"ignored"\nFirst Name,Last Name\nA,B\n',
}

function zip(files: Record<string, string>, folder = ''): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [`${folder}${k}`, strToU8(v)])))
}

describe('LinkedIn', () => {
  it('sites web et descriptions à puces', () => {
    expect(parseWebsites('[PORTFOLIO:https://a.example.test,OTHER:https://b.example.test/x,y]')).toEqual([
      { label: 'Portfolio', url: 'https://a.example.test' },
      { label: 'Site web', url: 'https://b.example.test/x,y' },
    ])
    expect(parseWebsites('[https://c.example.test]')).toEqual([{ label: 'Site web', url: 'https://c.example.test' }])
    expect(splitDescription('Intro.\n- Un\n• Deux\n\nSuite.')).toEqual({ description: 'Intro.\nSuite.', achievements: ['Un', 'Deux'] })
  })

  it('archive officielle → profil v2 valide', async () => {
    const { data, notes } = await importLinkedInZip(zip(LINKEDIN, 'Basic_LinkedInDataExport_10-01-2026/'), { makeId: sequentialIds() })
    valid(data)
    expect(data.identity).toMatchObject({ firstName: 'Camille', lastName: 'Exemple', headline: 'Cheffe de projet cybersécurité', email: 'camille.exemple@example.test', location: 'Lille, Hauts-de-France, France' })
    expect(data.summary).toBe("Neuf ans entre conseil et grands comptes.\nPilotage d'homologations.")
    expect(data.links.map((l) => [l.label, l.url])).toEqual([
      ['Portfolio', 'https://camille.example.test'],
      ['Blog', 'https://blog.example.test'],
      ['X (Twitter)', 'https://x.com/camille_ex'],
    ])
    expect(data.experiences.map((e) => [e.company, e.startDate, e.endDate, e.current])).toEqual([
      ['Aéroport Fictif', '2023-10', null, true],
      ['Cabinet Imaginaire', '2020-01', '2023-12', false],
      ['Indépendante', '2015', null, true],
    ])
    expect(data.experiences[0]).toMatchObject({ description: 'Homologation des systèmes de sûreté.', achievements: [{ text: 'Pilotage de 12 homologations en 18 mois.' }, { text: 'Création des indicateurs cyber.' }] })
    expect(data.experiences[1]!.description).toBe('Missions de conseil, "grands comptes".')
    expect(data.skills).toEqual([{ id: expect.any(String), category: 'Compétences', kind: 'technical', items: ['EBIOS RM', 'CyberArk', 'Qualys'] }])
    expect(data.languages.map((l) => l.level)).toEqual(['Courant (professionnel complet)', 'Langue maternelle ou bilingue'])
    expect(data.certifications[0]).toMatchObject({ name: 'PRINCE2 Foundation', issuer: 'PeopleCert', date: '2021-03' })
    expect(data.projects[0]).toMatchObject({ startDate: '2021', endDate: '2021', url: 'https://guide.example.test' })
    expect(data.awards[0]).toMatchObject({ title: 'Prix du meilleur blog technologie', date: '2015' })
    expect(data.publications[0]).toMatchObject({ outlet: 'Magazine Fictif', date: '2022-03', kind: 'article' })
    expect(notes[0]).toContain('Profile.csv')
    expect(notes.join(' ')).toMatch(/2 postes en cours/)
  })

  it('archive partielle, ZIP illisible, archive sans fichier reconnu', async () => {
    const partial = importLinkedInFiles({ Skills: 'Name\nPython\n' })
    valid(partial.data)
    expect(partial.notes.join(' ')).toMatch(/Absents.*Profile\.csv/)
    expect((await importLinkedInZip(new Uint8Array([1, 2, 3]))).notes[0]).toMatch(/illisible/)
    expect((await importLinkedInZip(zip({ 'autre.txt': 'x' }))).notes[0]).toMatch(/Aucun fichier LinkedIn/)
  })

  it('beaucoup de compétences : groupes de 40 au plus', () => {
    const skills = `Name\n${Array.from({ length: 95 }, (_, i) => `Compétence ${i}`).join('\n')}\n`
    const { data } = importLinkedInFiles({ Skills: skills })
    expect(data.skills.map((s) => s.items.length)).toEqual([40])
    valid(data)
  })
})

// ── Scanner de PDF ───────────────────────────────────────────────────────────

/** CV « deux colonnes » typique : la colonne latérale (nom, contact) est lue APRÈS le contenu. */
const SIDEBAR_CV = [
  ' EXPÉRIENCE PROFESSIONNELLE',
  'Cheffe de projet sécurité — Aéroport Fictif',
  '2023 – aujourd’hui',
  'Pilotage de 12 homologations.',
  'F O R M A T I O N',
  'Licence pro Réseaux — Université Fictive',
  'COMPÉTENCES',
  'LANGUES',
  'Anglais courant',
  'Camille EXEMPLE',
  'Cheffe de projet cybersécurité',
  ICON_MAIL + ' camille.exemple@example.test', // icône d'enveloppe (Font Awesome) en zone d'usage privé
  ICON_PHONE + ' 06 12 34 56 78',
  ':',
  'Lille, France',
  ' linkedin.com/in/camille-exemple',
  'Co' + REPLACEMENT + 't maîtrisé',
].join('\n')

const CLEAN_CV = [
  'Jean Martin',
  'Développeur web full stack',
  'jean.martin@example.test | +33 6 11 22 33 44 | Nantes, France | github.com/jmartin',
  'Profil',
  'Développeur web depuis 6 ans, React et Node.js.',
  'Expérience professionnelle',
  'Développeur — Agence Exemple (2020 – 2026)',
  '• Refonte de 12 sites clients.',
  'Formation',
  'DUT Informatique — IUT de Nantes (2016 – 2018)',
  'Compétences',
  'React, TypeScript, Node.js, PostgreSQL',
].join('\n')

describe('scanPdf', () => {
  it('CV propre : coordonnées et rubriques retrouvées, aucun avertissement', () => {
    const { report, draft, draftNotice } = scanPdf(fakePdf([CLEAN_CV]), { makeId: sequentialIds() })
    expect(report.name).toEqual({ value: 'Jean Martin', line: 0 })
    expect(report.email?.value).toBe('jean.martin@example.test')
    expect(report.phone?.value).toBe('+33 6 11 22 33 44')
    expect(report.links).toEqual(['github.com/jmartin'])
    expect(report.headings.map((h) => h.key)).toEqual(['summary', 'experiences', 'education', 'skills'])
    expect(report.findings.filter((f) => f.severity !== 'info')).toEqual([])
    expect(draftNotice).toMatch(/Brouillon/)
    valid(draft)
    expect(draft.identity).toMatchObject({ firstName: 'Jean', lastName: 'Martin', headline: 'Développeur web full stack', email: 'jean.martin@example.test', phone: '+33 6 11 22 33 44', location: 'Nantes, France' })
    expect(draft.links).toEqual([{ id: expect.any(String), label: 'GitHub', url: 'https://github.com/jmartin' }])
    expect(draft.summary).toBe('Développeur web depuis 6 ans, React et Node.js.')
    expect(draft.customSections[0]!.title).toBe(DRAFT_SECTION_TITLE)
    expect(draft.customSections[0]!.entries.map((e) => e.title)).toEqual(['Expérience professionnelle', 'Formation', 'Compétences'])
    expect(draft.customSections[0]!.entries[0]!.description).toBe('Développeur — Agence Exemple (2020 – 2026)\n• Refonte de 12 sites clients.')
    expect(draft.experiences).toEqual([]) // rien n'est inventé : le texte reste brut
  })

  it('CV à colonne latérale : nom et contact lus après les rubriques, problèmes d’extraction', () => {
    const { report, draft } = scanPdf(fakePdf([SIDEBAR_CV]), { makeId: sequentialIds() })
    const ids = report.findings.map((f) => f.id)
    expect(report.name?.value).toBe('Camille EXEMPLE')
    expect(ids).toEqual(expect.arrayContaining(['name-late', 'contact-late', 'empty-sections', 'letter-spaced', 'replacement-glyphs', 'private-use', 'icon-orphans']))
    expect(report.findings.find((f) => f.id === 'name-late')?.message).toContain('EXPÉRIENCE PROFESSIONNELLE')
    expect(report.findings.find((f) => f.id === 'empty-sections')?.examples).toEqual(['COMPÉTENCES'])
    // « F O R M A T I O N » est quand même reconnu comme titre.
    expect(report.headings.map((h) => h.key)).toEqual(['experiences', 'education', 'skills', 'languages'])
    expect(report.missingSections).toEqual([])
    valid(draft)
    expect(draft.identity).toMatchObject({ firstName: 'Camille', lastName: 'Exemple', email: 'camille.exemple@example.test', phone: '06 12 34 56 78' })
    expect(draft.links[0]!.url).toBe('https://linkedin.com/in/camille-exemple')
  })

  it('PDF image : erreur, brouillon vide mais valide', () => {
    const { report, draft } = scanPdf(fakePdf(['', '']))
    expect(report.findings).toEqual([expect.objectContaining({ id: 'no-text', severity: 'error' })])
    valid(draft)
  })

  it('sans titres ni e-mail : avertissements explicites', () => {
    const { report } = scanPdf(fakePdf(['Sophie Durand\nGraphiste\nJ’aime créer des identités visuelles pour les marques et les associations locales.']))
    const ids = report.findings.map((f) => f.id)
    expect(ids).toEqual(expect.arrayContaining(['no-headings', 'email-missing', 'phone-missing']))
    expect(report.name?.value).toBe('Sophie Durand')
  })

  it('n’imagine pas un téléphone dans une suite d’années ni un nom dans un intitulé', () => {
    const { report } = scanPdf(fakePdf(['Chef De Projet\nExpérience\n2019 2020 2021 2022\nPierre Leroy\npierre.leroy@example.test']))
    expect(report.phone).toBeNull()
    expect(report.name?.value).toBe('Pierre Leroy') // retrouvé grâce à l'e-mail, même tardif
    expect(report.findings.map((f) => f.id)).toContain('name-late')
  })

  it('CV de 3 pages : information', () => {
    expect(scanPdf(fakePdf([CLEAN_CV, 'Suite du parcours détaillé avec beaucoup de texte.', 'Annexes et références diverses.'])).report.findings.map((f) => f.id)).toContain('long')
  })
})
