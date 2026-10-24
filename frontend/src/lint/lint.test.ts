import { describe, expect, it } from 'vitest'
import { emptyProfile, newExperience, newMission, type ProfileData } from '@/domain/profile'
import { sampleProfile, sampleProfileV2 } from '@/ats/testing'
import { bulletStyle, lintProfile, lintText, type LintFinding } from './index'

const ids = (f: LintFinding[]) => f.map((x) => x.id)

/** Profil avec une expérience dont les réalisations sont `bullets`. */
function withBullets(bullets: string[], description = ''): ProfileData {
  const p = emptyProfile()
  p.experiences = [{ ...newExperience(), id: 'e1', title: 'Cheffe de projet', company: 'Société', description, achievements: bullets.map((text, i) => ({ id: `a${i}`, text })) }]
  return p
}

describe('lintProfile — structure du résultat', () => {
  it('chemins précis, sévérités limitées à suggestion / info, extrait court', () => {
    const f = lintProfile(withBullets(['Pilotage de 3 projets.', 'En charge du budget de 2 M€.']))
    const weak = f.find((x) => x.id === 'weak-opening')!
    expect(weak.path).toBe('experiences.0.achievements.1.text')
    expect(weak.excerpt).toContain('En charge du budget')
    for (const x of f) {
      expect(['suggestion', 'info']).toContain(x.severity)
      expect(x.excerpt.length).toBeLessThanOrEqual(100)
      expect(x.message).not.toBe('')
      expect(x.hint).not.toBe('')
    }
  })

  it('ne réécrit jamais le texte : le profil reste identique', () => {
    const p = withBullets(['En charge de divers projets etc.', 'je gère gère le SUIVI'])
    const before = JSON.stringify(p)
    lintProfile(p)
    expect(JSON.stringify(p)).toBe(before)
  })

  it('profil propre : aucun constat', () => {
    const p = withBullets(['Pilotage de 12 homologations en 18 mois.', 'Déploiement du bastion sur 4 pays.'])
    expect(lintProfile(p)).toEqual([])
  })

  it('profils d’exemple : seulement les constats attendus', () => {
    // v1 migré : « Mise en place d’une gouvernance… » et « Gestion de projets… ».
    expect(ids(lintProfile(sampleProfile()))).toEqual(['nominalisation', 'nominalisation'])
    expect(lintProfile(sampleProfile()).map((f) => f.path)).toEqual(['experiences.0.achievements.1.text', 'experiences.1.description'])
    // v2 : la description « Homologation… » et la puce « Création des indicateurs… » sont nominales, sans faute.
    expect(ids(lintProfile(sampleProfileV2()))).toEqual([])
  })
})

describe('entrées en matière faibles', () => {
  it.each(['En charge de la sécurité du SI', 'Responsable des achats IT', 'Participation à la refonte du SI', 'Aide à la mise en production', 'Chargée de la relation client', 'J’ai participé au projet'])('« %s »', (t) => {
    expect(ids(lintText(t, 'x', 'bullet'))).toContain('weak-opening')
  })

  it('repérées en début de ligne ou de phrase dans une description', () => {
    const f = lintText('Pilotage du portefeuille. Responsable du budget annuel.\nEn charge des recrutements.', 'experiences.0.description')
    expect(f.filter((x) => x.id === 'weak-opening')).toHaveLength(1)
    expect(f[0]!.excerpt).toContain('Responsable du budget')
  })

  it('pas au milieu d’une phrase', () => {
    expect(ids(lintText('Pilotage de l’équipe responsable des achats', 'x', 'bullet'))).not.toContain('weak-opening')
  })
})

describe('première personne', () => {
  it('« je », « j’ », « nous »', () => {
    expect(ids(lintText('Je pilote les audits', 'x', 'bullet'))).toContain('first-person')
    expect(ids(lintText('J’ai réduit les coûts de 10 %', 'x', 'bullet'))).toContain('first-person')
    expect(ids(lintText("j'anime le comité", 'x', 'bullet'))).toContain('first-person')
    expect(ids(lintText('Avec mon équipe, nous avons livré 3 sites', 'x', 'bullet'))).toContain('first-person')
  })

  it('ne confond pas avec « jeu », « jeune », « Jean » ou « nouveau »', () => {
    expect(ids(lintText('Conception d’un jeu sérieux pour jeunes diplômés avec Jean, nouveau venu', 'x', 'bullet'))).not.toContain('first-person')
  })

  it('dans le résumé : simple information (usage toléré), dans une puce : suggestion', () => {
    const p = emptyProfile()
    p.summary = 'Je suis cheffe de projet depuis 9 ans.'
    expect(lintProfile(p)[0]).toMatchObject({ id: 'first-person', severity: 'info', path: 'summary' })
    expect(lintText('Je pilote', 'experiences.0.achievements.0.text', 'bullet')[0]?.severity).toBe('suggestion')
  })
})

describe('temps mélangés', () => {
  it('classe le style d’ouverture d’une puce', () => {
    expect(bulletStyle('Pilotage de 3 projets')).toBe('nominal')
    expect(bulletStyle('Déploiement du bastion')).toBe('nominal')
    expect(bulletStyle('Mise en place d’un SOC')).toBe('nominal')
    expect(bulletStyle('Piloté 3 projets')).toBe('participle')
    expect(bulletStyle('Créée en 2019')).toBe('participle')
    expect(bulletStyle('Conçu un outil interne')).toBe('participle')
    expect(bulletStyle('J’ai piloté 3 projets')).toBe('passe-compose')
    expect(bulletStyle('Pilotais les audits')).toBe('imperfect')
    expect(bulletStyle('Je gérais le budget')).toBe('imperfect')
    expect(bulletStyle('Piloter les audits')).toBe('infinitive')
    expect(bulletStyle('Anglais courant')).toBeNull()
    expect(bulletStyle('Mais aussi')).toBeNull()
    expect(bulletStyle('Assure le suivi')).toBeNull()
  })

  it('signale une liste qui mélange nominal et participe passé, une seule fois, au niveau de la liste', () => {
    const f = lintProfile(withBullets(['Pilotage de 3 projets.', 'Réduit les délais de 30 %.', 'Déploiement de Qualys.']))
    const mix = f.filter((x) => x.id === 'tense-mix')
    expect(mix).toHaveLength(1)
    expect(mix[0]!.path).toBe('experiences.0.achievements')
    expect(mix[0]!.message).toMatch(/nominal.*participe passé/)
  })

  it('imparfait et passé composé', () => {
    const f = lintProfile(withBullets(['Je gérais 4 équipes.', 'J’ai livré 25 projets.']))
    expect(f.find((x) => x.id === 'tense-mix')?.message).toMatch(/imparfait|passé composé/)
  })

  it('les puces des missions forment leur propre liste', () => {
    const p = withBullets(['Pilotage de 3 projets.'])
    p.experiences[0]!.missions = [{ ...newMission(), client: 'Banque', achievements: [{ id: 'm1', text: 'Piloté le déploiement en 6 mois.' }, { id: 'm2', text: 'Rédaction de 40 procédures.' }] }]
    const mix = lintProfile(p).filter((x) => x.id === 'tense-mix')
    expect(mix.map((x) => x.path)).toEqual(['experiences.0.missions.0.achievements'])
  })

  it('une liste homogène ne déclenche rien', () => {
    expect(ids(lintProfile(withBullets(['Piloté 3 projets.', 'Réduit les délais de 30 %.', 'Conçu un outil interne pour 40 personnes.'])))).toEqual([])
  })
})

describe('nominalisations', () => {
  it.each([
    ['Mise en place d’un SOC 24/7', 'mettre en place'],
    ['Gestion des incidents de sécurité', 'gérer'],
    ['Réalisation des audits annuels', 'réaliser'],
    ['Mise en œuvre de la PSSI', 'mettre en œuvre'],
  ])('« %s » → propose « %s »', (text, verb) => {
    const [f] = lintText(text, 'x', 'bullet').filter((x) => x.id === 'nominalisation')
    expect(f?.hint).toContain(verb)
    expect(f?.hint).toContain('même contenu')
  })

  it('un seul constat par texte', () => {
    expect(lintText('Gestion des risques et mise en place de la PSSI', 'x', 'bullet').filter((x) => x.id === 'nominalisation')).toHaveLength(1)
  })
})

describe('chiffres, ponctuation, mots vagues, longueur, doublons, capitales', () => {
  it('aucun chiffre dans une liste : information douce, sans exiger d’en inventer', () => {
    const [f] = lintProfile(withBullets(['Pilotage des audits.', 'Animation des comités.'])).filter((x) => x.id === 'no-figure')
    expect(f?.severity).toBe('info')
    expect(f?.hint).toContain('N’en inventez aucun')
  })

  it('les nombres écrits en lettres comptent', () => {
    expect(ids(lintProfile(withBullets(['Encadrement de trois consultants.', 'Pilotage des audits.'])))).not.toContain('no-figure')
  })

  it('ponctuation finale irrégulière dans une liste', () => {
    const [f] = lintProfile(withBullets(['Pilotage de 3 projets.', 'Déploiement de 2 outils', 'Animation de 4 ateliers (2023).'])).filter((x) => x.id === 'punctuation-mix')
    expect(f?.message).toContain('2 avec « . »')
    expect(f?.message).toContain('1 sans ponctuation')
    expect(ids(lintProfile(withBullets(['Pilotage de 3 projets', 'Animation de 4 ateliers (2023)'])))).not.toContain('punctuation-mix')
  })

  it('mots vagues : divers, variés, etc., « les différents »', () => {
    expect(ids(lintText('Gestion de divers projets', 'x', 'bullet'))).toContain('filler-words')
    expect(ids(lintText('Clients variés : banque, assurance', 'x', 'bullet'))).toContain('filler-words')
    expect(ids(lintText('Outils : Jira, Confluence, etc.', 'x', 'bullet'))).toContain('filler-words')
    expect(ids(lintText('Coordination des différents prestataires', 'x', 'bullet'))).toContain('filler-words')
    expect(ids(lintText('Déploiement sur trois sites différents', 'x', 'bullet'))).not.toContain('filler-words')
  })

  it('puce de plus de 220 caractères', () => {
    const long = `Pilotage ${'du programme de transformation '.repeat(8)}`
    expect(long.length).toBeGreaterThan(220)
    expect(ids(lintText(long, 'x', 'bullet'))).toContain('long-bullet')
    expect(ids(lintText(long, 'x', 'prose'))).not.toContain('long-bullet')
  })

  it('mot répété consécutivement, casse ignorée', () => {
    const [f] = lintText('Pilotage de de la refonte', 'x', 'bullet').filter((x) => x.id === 'duplicate-word')
    expect(f?.message).toContain('de de')
    expect(ids(lintText('Le le comité', 'x', 'bullet'))).toContain('duplicate-word')
    expect(ids(lintText('Nous nous sommes', 'x', 'bullet'))).not.toContain('duplicate-word')
    expect(ids(lintText('Budget 2023 2024', 'x', 'bullet'))).not.toContain('duplicate-word')
  })

  it('mots en capitales, sauf sigles', () => {
    expect(ids(lintText('Pilotage de la SÉCURITÉ du SI', 'x', 'bullet'))).toContain('all-caps')
    expect(ids(lintText('Audits PASSI, ISO 27001, RGPD, EBIOS, SIEM, PRINCE2 et UNESCO', 'x', 'bullet'))).not.toContain('all-caps')
  })
})

describe('couverture du profil v2', () => {
  it('relit missions, projets, distinctions, publications et rubriques libres', () => {
    const p = sampleProfileV2()
    p.projects[0]!.description = 'Je rédige divers guides.'
    p.awards[0]!.description = 'Prix obtenu obtenu en 2015.'
    p.publications[0]!.description = 'Article sur la SÉCURITÉ.'
    p.customSections[0]!.entries[0]!.description = 'En charge des ateliers.'
    p.experiences[1]!.missions[0]!.description = 'Mise en place du bastion.'
    const paths = lintProfile(p).map((f) => `${f.id}@${f.path}`)
    expect(paths).toEqual([
      'nominalisation@experiences.1.missions.0.description',
      'first-person@projects.0.description',
      'filler-words@projects.0.description',
      'duplicate-word@awards.0.description',
      'all-caps@publications.0.description',
      'weak-opening@customSections.0.entries.0.description',
    ])
  })
})
