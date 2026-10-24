import { describe, expect, it } from 'vitest'
import { locateHeadings } from './rules/pdf'
import { ctxFor, fakePdf, runRule, sampleProfile } from './testing'

/** Texte « idéal » tel qu'un extracteur le rendrait pour le profil d'exemple (classic, 1 page). */
const GOOD_PAGE = [
  'Camille Exemple',
  'Cheffe de projet digital',
  'camille.exemple@example.test | +33 6 00 00 00 00 | Lille, France',
  'LinkedIn : linkedin.com/in/camille-exemple | Portfolio : camille.example.test',
  'Profil',
  "Cheffe de projet digital avec 8 ans d'expérience dans la conduite de refontes web et de programmes e-commerce. À l'aise entre équipes techniques et métiers, orientée résultats mesurables.",
  'Expérience professionnelle',
  'Cheffe de projet digital senior',
  'Société Fictive SA, Lille | mars 2021 – Présent',
  'Pilotage du portefeuille de projets web B2B pour 3 filiales européennes.',
  '• Refonte du site e-commerce : +18 % de taux de conversion en 6 mois.',
  "• Mise en place d'une gouvernance agile pour 4 équipes (22 personnes), délais de livraison réduits de 30 %.",
  'Chargée de projet web',
  'Agence Imaginaire, Paris | septembre 2017 – février 2021',
  "Gestion de projets de sites et d'applications pour des clients grands comptes.",
  '• Livraison de 25 projets dans les délais et le budget.',
  'Compétences',
  'Gestion de projet : Scrum, Kanban, Roadmapping, Budgétisation',
  'Outils : Jira, Figma, Google Analytics, SQL',
  'Savoir-être : Communication, Leadership, Négociation',
  'Formation',
  "Master Management de l'innovation",
  'Université Fictive, Lille | septembre 2015 – juin 2017',
  'Certifications',
  'Professional Scrum Master I | Scrum.org, mai 2022',
  'Langues',
  'Français (Langue maternelle) | Anglais (Courant (C1))',
].join('\n')

const ctx = (page = GOOD_PAGE) => ctxFor(sampleProfile(), { pdf: fakePdf([page]) })

describe('texte extrait du PDF (extraction simulée)', () => {
  it('le texte idéal ne produit aucun signalement PDF', async () => {
    const { analyzeCv } = await import('./index')
    const report = analyzeCv(ctx())
    expect(report.issues).toEqual([])
    expect(report.skipped).toBe(0)
  })

  it('erreur quand le PDF n’a pas de texte (PDF image)', () => {
    const [i] = runRule('pdf-text-present', ctx(''))
    expect(i?.severity).toBe('error')
  })

  it('n’exige pas de texte pour un CV sans rubrique', () => {
    const c = ctxFor({ ...sampleProfile(), sections: sampleProfile().sections.map((s) => ({ ...s, visible: false })) }, { pdf: fakePdf(['']) })
    expect(runRule('pdf-text-present', c)).toEqual([])
  })

  it('erreur si nom ou e-mail manquent, avertissement pour le téléphone', () => {
    const page = GOOD_PAGE.replace('Camille Exemple', 'C a m i l l').replace('camille.exemple@example.test', '').replace('+33 6 00 00 00 00', '')
    const issues = runRule('pdf-key-info', ctx(page))
    expect(issues.map((i) => i.severity).sort()).toEqual(['error', 'error', 'warning'])
  })

  it('compare le téléphone sur les chiffres seuls', () => {
    const page = GOOD_PAGE.replace('+33 6 00 00 00 00', '+33600000000')
    expect(runRule('pdf-key-info', ctx(page))).toEqual([])
  })

  it('avertit pour un titre de rubrique introuvable', () => {
    const page = GOOD_PAGE.replace('Compétences\n', '')
    const [i] = runRule('pdf-headings', ctx(page))
    expect(i?.severity).toBe('warning')
    expect(i?.message).toContain('Compétences')
  })

  it('avertit quand les rubriques sont extraites dans un autre ordre', () => {
    const lines = GOOD_PAGE.split('\n')
    const headings = ['Profil', 'Expérience professionnelle', 'Compétences', 'Formation', 'Certifications', 'Langues']
    const swapped = lines.map((l) => (l === 'Profil' ? 'Langues' : l === 'Langues' ? 'Profil' : l)).join('\n')
    const c = ctx(swapped)
    const located = locateHeadings(c)
    expect(located.map((h) => h.title)).toEqual(headings)
    expect(located.some((h) => h.status === 'misordered')).toBe(true)
    const [i] = runRule('pdf-heading-order', c)
    expect(i?.severity).toBe('warning')
    expect(runRule('pdf-headings', c)).toEqual([]) // mal ordonné ≠ introuvable
  })

  it('retrouve un titre accolé au texte qui suit (repli « commence par »)', () => {
    const page = GOOD_PAGE.replace('Formation\nMaster', 'Formation Master')
    expect(locateHeadings(ctx(page)).find((h) => h.title === 'Formation')?.status).toBe('ok')
  })

  it('reconnaît les titres en majuscules (modèles « modern »)', () => {
    const page = GOOD_PAGE.replace('Expérience professionnelle', 'EXPÉRIENCE PROFESSIONNELLE').replace('Langues\n', 'LANGUES\n')
    expect(locateHeadings(ctx(page)).every((h) => h.status === 'ok')).toBe(true)
  })

  it('signale un poste dont l’intitulé n’est pas retrouvé', () => {
    const page = GOOD_PAGE.replace('Chargée de projet web', 'Charg')
    expect(runRule('pdf-entries', ctx(page))).toHaveLength(1)
  })

  it('détecte ligatures, caractère de remplacement et lettres espacées', () => {
    expect(runRule('pdf-artifacts', ctx(`${GOOD_PAGE}\nﬁnancement`))).toHaveLength(1)
    expect(runRule('pdf-artifacts', ctx(`${GOOD_PAGE}\nco�t`))).toHaveLength(1)
    expect(runRule('pdf-artifacts', ctx(`${GOOD_PAGE}\nE X P É R I E N C E`))).toHaveLength(1)
    expect(runRule('pdf-artifacts', ctx())).toEqual([])
  })

  it('signale un lien dont l’adresse n’est pas en clair', () => {
    const page = GOOD_PAGE.replace('linkedin.com/in/camille-exemple', 'LinkedIn')
    const [i] = runRule('pdf-links', ctx(page))
    expect(i?.severity).toBe('info')
  })

  it('calcule la couverture des mots et avertit sous 90 %', () => {
    const half = GOOD_PAGE.split('\n').slice(0, 14).join('\n')
    const [i] = runRule('pdf-coverage', ctx(half))
    expect(i?.severity).toBe('warning')
    expect(i?.message).toMatch(/\d+ %/)
    expect(runRule('pdf-coverage', ctx())).toEqual([])
  })

  it('ignore les rubriques masquées dans le calcul de couverture', () => {
    const d = sampleProfile()
    d.sections = d.sections.map((s) => (s.key === 'certifications' ? { ...s, visible: false } : s))
    const page = GOOD_PAGE.replace(/Certifications\n.*\n/, '')
    expect(runRule('pdf-coverage', ctxFor(d, { pdf: fakePdf([page]) }))).toEqual([])
  })

  it('avertit au-delà de 2 pages et pour une page presque vide', () => {
    const c3 = ctxFor(sampleProfile(), { pdf: fakePdf([GOOD_PAGE, GOOD_PAGE, GOOD_PAGE]) })
    expect(runRule('pdf-length', c3)).toHaveLength(1)
    expect(runRule('pdf-length', ctxFor(sampleProfile(), { pdf: fakePdf([GOOD_PAGE, GOOD_PAGE]) }))).toEqual([])
    const sparse = ctxFor(sampleProfile(), { pdf: fakePdf([GOOD_PAGE, 'Formation\nMaster']) })
    const [i] = runRule('pdf-sparse-pages', sparse)
    expect(i?.message).toContain('page 2')
  })
})
