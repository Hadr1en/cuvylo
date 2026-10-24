import { describe, expect, it } from 'vitest'
import { newMission, type ProfileData } from '@/domain/profile'
import { canRender } from '@/pdf/glyphs'
import { analyzeCv } from './index'
import { contentTexts } from './rules/content'
import { PARALLEL_BY_NATURE, isParallel, months } from './rules/dates'
import { locateHeadings } from './rules/pdf'
import { ctxFor, exp, fakePdf, runRule, sampleProfileV2, withExperiences } from './testing'
import { isSupportedChar, normalize, unsupportedChars } from './text'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('profil v2 d’exemple (missions, activité parallèle, années seules, rubrique libre)', () => {
  it('ne produit ni erreur ni avertissement hors PDF', () => {
    const report = analyzeCv(ctxFor(sampleProfileV2()))
    expect(report.issues.filter((i) => i.severity !== 'info')).toEqual([])
    expect(report.issues).toEqual([])
  })

  it('le texte des missions, projets, distinctions, publications et rubriques libres est analysé', () => {
    const texts = contentTexts(sampleProfileV2())
    const fields = new Set(texts.map((t) => t.field))
    for (const f of ['client de mission', 'réalisation de mission', 'projet', 'distinction', 'publication', 'centre d’intérêt', 'description (Bénévolat)', 'identité (details)']) {
      expect(fields.has(f), f).toBe(true)
    }
    expect(texts.find((t) => t.field === 'description (Bénévolat)')?.section).toBe('custom:cus1')
    expect(texts.find((t) => t.field === 'compétence de mission')?.printed).toBe(false)
  })

  it('la photo (image encodée) n’est jamais traitée comme du texte', () => {
    const d = sampleProfileV2()
    d.identity.photo = PNG
    expect(contentTexts(d).some((t) => t.text.startsWith('data:'))).toBe(false)
  })
})

describe('caractères imprimables', () => {
  it('délègue à la table calculée depuis les polices', () => {
    for (const ch of ['A', 'é', 'Ł', 'ř', 'ș', 'ğ', 'ő', '€', '’', '…', '→', '✓', '😀', 'Ж']) {
      expect(isSupportedChar(ch), ch).toBe(canRender(ch))
    }
  })

  it('« Łukasz Dvořák », « Ștefan », « Gökhan Öztürk » ne déclenchent plus rien', () => {
    const d = sampleProfileV2()
    d.identity.firstName = 'Łukasz'
    d.identity.lastName = 'Dvořák'
    d.experiences[0]!.achievements[0]!.text = 'Formation de Ștefan Bălan et Gökhan Öztürk, équipe de Kraków.'
    expect(runRule('unsupported-glyphs', ctxFor(d))).toEqual([])
  })

  it('signale emoji, coche, flèche et espace fine insécable', () => {
    expect(unsupportedChars('Réduit ✓ → 😀')).toEqual(['✓', '→', '😀'])
    const d = sampleProfileV2()
    d.experiences[1]!.missions[0]!.achievements[0]!.text = 'Bastion déployé ✓ → 4 pays'
    const [issue] = runRule('unsupported-glyphs', ctxFor(d))
    expect(issue?.severity).toBe('warning')
    expect(issue?.message).toContain('réalisation de mission')
    expect(issue?.message).toContain('✓')
    expect(issue?.fix).toContain('quel que soit le modèle')
  })

  it('tolère les fins de ligne Windows', () => {
    expect(unsupportedChars('ligne 1\r\nligne 2')).toEqual([])
  })

  it('signale un caractère non imprimable dans une rubrique libre, avec son identifiant', () => {
    const d = sampleProfileV2()
    d.customSections[0]!.entries[0]!.description = 'Ateliers ★ pour seniors'
    const [issue] = runRule('unsupported-glyphs', ctxFor(d))
    expect(issue?.section).toBe('custom:cus1')
  })
})

describe('pdf-key-info : pas de conseil de modèle pour un problème de caractères', () => {
  const page = 'Camille Exemple\ncamille.exemple@example.test | +33 6 00 00 00 00'

  it('nom avec un caractère non imprimable : le message accuse le caractère, pas le modèle', () => {
    const d = sampleProfileV2()
    d.identity.firstName = 'Camille ✦'
    const [issue] = runRule('pdf-key-info', ctxFor(d, { pdf: fakePdf([page.replace('Camille', 'Camille ')]) }))
    expect(issue?.severity).toBe('error')
    expect(issue?.message).toContain('✦')
    expect(issue?.fix).toContain('pas du modèle')
    expect(issue?.fix).not.toMatch(/essayez un autre modèle|changez de modèle/i)
  })

  it('sans problème de caractères, le conseil de modèle reste proposé', () => {
    const [issue] = runRule('pdf-key-info', ctxFor(sampleProfileV2(), { pdf: fakePdf(['C a m i l l e\ncamille.exemple@example.test +33600000000']) }))
    expect(issue?.fix).toMatch(/autre modèle/)
  })

  it('un nom à diacritiques d’Europe centrale bien extrait ne déclenche rien', () => {
    const d = sampleProfileV2()
    d.identity.firstName = 'Łukasz'
    d.identity.lastName = 'Dvořák'
    const text = 'Łukasz Dvořák\ncamille.exemple@example.test | +33 6 00 00 00 00'
    expect(runRule('pdf-key-info', ctxFor(d, { pdf: fakePdf([text]) }))).toEqual([])
  })

  it('CV anonymisé : nom, coordonnées et liens ne sont pas attendus', () => {
    const c = ctxFor(sampleProfileV2(), { settings: { anonymize: true }, pdf: fakePdf(['C. E.\nCheffe de projet cybersécurité']) })
    expect(runRule('pdf-key-info', c)).toEqual([])
    expect(runRule('pdf-links', c)).toEqual([])
  })

  it('couverture : la cause « caractères » est nommée, sans renvoyer au modèle', () => {
    const d = sampleProfileV2()
    d.summary = 'Cheffe 😀projet cybersécurité, pilotage d’homologations, analyses de risques et déploiements d’outils.'
    const c = ctxFor(d, { pdf: fakePdf(['Camille Exemple\nProfil\nCheffe']) })
    const [issue] = runRule('pdf-coverage', c)
    expect(issue?.fix).toContain('😀')
    expect(issue?.fix).not.toMatch(/modèle à une colonne/)
  })
})

describe('rubriques v2 et identifiants `custom:<id>`', () => {
  it('rubrique libre masquée avec contenu : signalée avec son identifiant et son titre', () => {
    const d = sampleProfileV2()
    d.sections = d.sections.map((s) => (s.key === 'custom' ? { ...s, visible: false } : s))
    const [issue] = runRule('hidden-sections', ctxFor(d))
    expect(issue?.section).toBe('custom:cus1')
    expect(issue?.message).toContain('Bénévolat')
  })

  it('projets masqués avec contenu : signalés', () => {
    const d = sampleProfileV2()
    d.sections = d.sections.map((s) => (s.key === 'projects' ? { ...s, visible: false } : s))
    expect(runRule('hidden-sections', ctxFor(d))[0]?.section).toBe('projects')
  })

  it('saut de page demandé avant une rubrique libre masquée', () => {
    const d = sampleProfileV2()
    d.sections = d.sections.map((s) => (s.key === 'custom' ? { ...s, visible: false } : s))
    const issues = runRule('forced-breaks', ctxFor(d, { settings: { pageBreakBefore: ['custom:cus1', 'custom:disparue'] } }))
    expect(issues.map((i) => i.section)).toEqual(['custom:cus1', 'custom:disparue'])
    expect(issues[1]?.message).toContain('rubrique supprimée')
  })

  it('titre de rubrique libre introuvable dans le PDF : identifiant `custom:<id>`', () => {
    const d = sampleProfileV2()
    const located = locateHeadings(ctxFor(d, { pdf: fakePdf(['Profil\nExpérience professionnelle']) }))
    expect(located.find((h) => h.id === 'custom:cus1')?.status).toBe('missing')
    const issues = runRule('pdf-headings', ctxFor(d, { pdf: fakePdf(['Profil']) }))
    expect(issues.some((i) => i.section === 'custom:cus1' && i.message.includes('Bénévolat'))).toBe(true)
  })

  it('rubrique libre sans titre affichée : avertissement', () => {
    const d = sampleProfileV2()
    d.customSections[0]!.title = ''
    expect(runRule('custom-sections-titled', ctxFor(d))).toHaveLength(1)
  })

  it('titres en anglais (locale en) localisés dans le texte extrait', () => {
    const located = locateHeadings(ctxFor(sampleProfileV2(), { settings: { locale: 'en' }, pdf: fakePdf(['Profile\nProfessional Experience\nSkills']) }))
    expect(located.slice(0, 3).map((h) => h.status)).toEqual(['ok', 'ok', 'ok'])
  })
})

describe('missions', () => {
  it('une expérience décrite uniquement par ses missions a de la substance', () => {
    const d = sampleProfileV2()
    expect(d.experiences[1]!.description).not.toBe('')
    d.experiences[1]!.description = ''
    expect(runRule('experience-substance', ctxFor(d))).toEqual([])
  })

  it('les réalisations chiffrées des missions comptent', () => {
    const d = withExperiences([
      exp('a', '2020-01', null, {
        achievements: [{ id: 'x', text: 'Pilotage des audits' }],
        missions: [{ ...newMission(), client: 'Banque', startDate: '2021', achievements: [{ id: 'y', text: 'Déploiement dans 64 pays' }] }],
      }),
    ])
    expect(runRule('achievements-measurable', ctxFor(d))).toEqual([])
  })

  it('mission sans client ni date : information', () => {
    const d = withExperiences([exp('a', '2020-01', null, { missions: [{ ...newMission(), role: 'Chef de projet PAM' }] })])
    const [issue] = runRule('mission-fields', ctxFor(d))
    expect(issue?.severity).toBe('info')
    expect(issue?.message).toMatch(/client.*date de début/)
  })

  it('mission hors de la période de son expérience', () => {
    const d = withExperiences([exp('a', '2020-01', '2021-12', { missions: [{ ...newMission(), client: 'Banque', startDate: '2019-06', endDate: '2020-06' }] })])
    const [issue] = runRule('mission-within-experience', ctxFor(d))
    expect(issue?.message).toContain('commence avant')
    // Année seule : 2020 peut commencer en décembre, donc rien de certain à signaler.
    d.experiences[0]!.missions[0]!.startDate = '2020'
    expect(runRule('mission-within-experience', ctxFor(d))).toEqual([])
  })

  it('missions et réalisations de missions : puces manuelles et blocs longs repérés', () => {
    const d = withExperiences([exp('a', '2020-01', null, { missions: [{ ...newMission(), client: 'X', description: '• puce\n' + 'x'.repeat(650) }] })])
    expect(runRule('manual-bullets', ctxFor(d))).toHaveLength(1)
    expect(runRule('long-blocks', ctxFor(d))).toHaveLength(1)
  })
})

describe('dates v2', () => {
  const run = (id: string, list: ReturnType<typeof exp>[]) => runRule(id, ctxFor(withExperiences(list)))

  it('« mois » est invariable : jamais « moiss »', () => {
    expect(months(29)).toBe('29 mois')
    const [i] = run('overlaps', [exp('a', '2020-01', '2023-01'), exp('b', '2020-08', '2023-01')])
    expect(i?.message).toContain('29 mois')
    expect(i?.message).not.toContain('moiss')
    const [g] = run('gaps', [exp('b', '2023-01', null), exp('a', '2018-01', '2020-07')])
    expect(g?.message).toMatch(/^29 mois sans/)
  })

  it('activité cochée « en parallèle » : ni chronologie ni chevauchement', () => {
    const list = [exp('a', '2023-01', null), exp('free', '2011-01', null, { parallel: true, title: 'Journaliste' }), exp('b', '2016-01', '2022-12')]
    expect(run('chronology', list)).toEqual([])
    expect(run('overlaps', list)).toEqual([])
    expect(run('current-count', list)).toEqual([])
  })

  it.each([
    'Consultant (micro-entreprise)',
    'Gérant de SASU',
    'Président EURL Conseil',
    'Consultant en portage salarial',
    'Enseignant vacataire',
    'Formateur cybersécurité',
    'Formatrice Excel',
    'Bénévole à la Croix-Rouge',
    'Développeur freelance',
    'Rédactrice indépendante',
    'Auto-entrepreneur',
  ])('« %s » est reconnu comme parallèle par nature', (title) => {
    expect(PARALLEL_BY_NATURE.test(normalize(title))).toBe(true)
    const list = [exp('a', '2015-01', '2022-12'), exp('p', '2018-01', '2024-06', { title, company: 'X' })]
    expect(run('overlaps', list)).toEqual([])
  })

  it('n’en fait pas trop : un « Responsable formation » salarié n’est pas parallèle', () => {
    expect(isParallel(exp('a', '2020', null, { title: 'Responsable formation', company: 'Groupe X' }))).toBe(false)
    expect(isParallel(exp('a', '2020', null, { title: 'Chef de projet', company: 'Esus' }))).toBe(false)
  })

  it('les missions imbriquées ne créent jamais de chevauchement', () => {
    const parent = exp('esn', '2018-01', '2023-12', {
      missions: [
        { ...newMission(), client: 'BNP', startDate: '2018-01', endDate: '2020-06' },
        { ...newMission(), client: 'Sodexo', startDate: '2020-01', endDate: '2023-12' },
      ],
    })
    expect(run('overlaps', [exp('a', '2024-01', null), parent])).toEqual([])
    expect(run('chronology', [exp('a', '2024-01', null), parent])).toEqual([])
  })

  it('années seules : pas de chevauchement inventé entre « 2020–2021 » et « 2021–2023 »', () => {
    expect(run('overlaps', [exp('b', '2021', '2023'), exp('a', '2020', '2021')])).toEqual([])
    // Mais un chevauchement certain reste signalé.
    expect(run('overlaps', [exp('b', '2019', '2023'), exp('a', '2017', '2022')])).toHaveLength(1)
  })

  it('années seules : pas de trou inventé entre « 2017–2019 » et « 2020 »', () => {
    expect(run('gaps', [exp('b', '2020', null), exp('a', '2017', '2019')])).toEqual([])
    expect(run('gaps', [exp('b', '2021', null), exp('a', '2017', '2019')])).toHaveLength(1)
  })

  it('années seules : chronologie comparée à l’année', () => {
    expect(run('chronology', [exp('a', '2020', '2021'), exp('b', '2020-05', '2020-12')])).toEqual([])
    expect(run('chronology', [exp('a', '2019', '2021'), exp('b', '2020-05', '2020-12')])).toHaveLength(1)
  })

  it('années seules : une fin « 2026 » n’est pas dans le futur en octobre 2026, « 2027 » oui', () => {
    expect(run('future-dates', [exp('a', '2024', '2026')])).toEqual([])
    expect(run('future-dates', [exp('a', '2024', '2027')])).toHaveLength(1)
    expect(run('future-dates', [exp('a', '2027', null)])).toHaveLength(1)
  })

  it('années seules : ordre début/fin contrôlé (fin « 2019 » avant début « 2020 »)', () => {
    const [i] = run('date-order', [exp('a', '2020', '2019')])
    expect(i?.severity).toBe('error')
    expect(i?.message).toContain('(2019)')
    expect(run('date-order', [exp('a', '2020-06', '2020')])).toEqual([])
  })

  it('dates de missions et de projets contrôlées', () => {
    const d: ProfileData = withExperiences([exp('a', '2020-01', null, { missions: [{ ...newMission(), client: 'X', startDate: '2022-05', endDate: '2021-01' }] })])
    d.projects = [{ id: 'p', name: 'Guide', role: '', startDate: '2023', endDate: '2022', url: '', description: '', skills: [] }]
    const issues = runRule('date-order', ctxFor(d))
    expect(issues.map((i) => i.section)).toEqual(['experiences', 'projects'])
  })

  it('distinction datée dans le futur', () => {
    const d = sampleProfileV2()
    d.awards[0]!.date = '2027'
    expect(runRule('future-dates', ctxFor(d))[0]?.section).toBe('awards')
  })
})

describe('photo-present', () => {
  it('information seulement si la photo est affichée ET présente', () => {
    const d = sampleProfileV2()
    d.identity.photo = PNG
    const [issue] = runRule('photo-present', ctxFor(d, { settings: { showPhoto: true } }))
    expect(issue?.severity).toBe('info')
    expect(issue?.fix).toMatch(/ignorent/)
    expect(issue?.fix).toMatch(/biais/)
    expect(runRule('photo-present', ctxFor(d, { settings: { showPhoto: false } }))).toEqual([])
    expect(runRule('photo-present', ctxFor(sampleProfileV2(), { settings: { showPhoto: true } }))).toEqual([])
    expect(runRule('photo-present', ctxFor(d, { settings: { showPhoto: true, anonymize: true } }))).toEqual([])
  })

  it('ne crée pas de score global, même avec tous les réglages v2', () => {
    const d = sampleProfileV2()
    d.identity.photo = PNG
    const r = analyzeCv(ctxFor(d, { settings: { showPhoto: true, targetPages: 2, locale: 'en' } })) as unknown as Record<string, unknown>
    expect(Object.keys(r).sort()).toEqual(['counts', 'executed', 'issues', 'passed', 'results', 'skipped'])
  })
})
