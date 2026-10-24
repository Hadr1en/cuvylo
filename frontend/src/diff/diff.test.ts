import { describe, expect, it } from 'vitest'
import { addCustomSection, newMission, type ProfileData } from '@/domain/profile'
import { sampleProfileV2 } from '@/ats/testing'
import { diffCv, diffLines, diffStats } from './index'

const clone = (p: ProfileData) => structuredClone(p)

describe('diffCv', () => {
  const base = sampleProfileV2()

  it('aucune différence entre deux copies', () => {
    expect(diffCv(base, clone(base))).toEqual([])
  })

  it('champ d’identité et résumé', () => {
    const b = clone(base)
    b.identity.headline = 'Responsable sécurité'
    b.identity.photo = 'data:image/png;base64,AAAA'
    b.summary = 'Nouveau résumé.'
    expect(diffCv(base, b)).toEqual([
      { kind: 'changed', section: 'Identité', sectionId: 'identity', item: '', field: 'Titre', before: 'Cheffe de projet cybersécurité', after: 'Responsable sécurité' },
      { kind: 'changed', section: 'Identité', sectionId: 'identity', item: '', field: 'Photo', before: '', after: '(photo)' },
      { kind: 'changed', section: 'Résumé', sectionId: 'summary', item: '', field: 'Texte', before: base.summary, after: 'Nouveau résumé.' },
    ])
  })

  it('expérience : champ modifié, réalisation ajoutée, dates', () => {
    const b = clone(base)
    b.experiences[0]!.title = 'Responsable sécurité'
    b.experiences[0]!.achievements.push({ id: 'new', text: 'Audit PASSI de 3 sites.' })
    b.experiences[0]!.current = false
    b.experiences[0]!.endDate = '2026-09'
    const changes = diffCv(base, b)
    expect(changes).toContainEqual({ kind: 'changed', section: 'Expériences', sectionId: 'experiences', item: 'Responsable sécurité · Aéroport Fictif', field: 'Intitulé', before: 'Cheffe de projet sécurité', after: 'Responsable sécurité' })
    expect(changes).toContainEqual({ kind: 'changed', section: 'Expériences', sectionId: 'experiences', item: 'Responsable sécurité · Aéroport Fictif', field: 'Fin', before: 'en cours', after: '2026-09' })
    expect(changes).toContainEqual({ kind: 'changed', section: 'Expériences', sectionId: 'experiences', item: 'Responsable sécurité · Aéroport Fictif', field: 'Poste actuel', before: 'oui', after: 'non' })
    expect(changes).toContainEqual({ kind: 'added', section: 'Expériences', sectionId: 'experiences', item: 'Responsable sécurité · Aéroport Fictif', field: 'Réalisations', before: '', after: 'Audit PASSI de 3 sites.' })
  })

  it('missions : ajout, suppression et modification sous leur expérience', () => {
    const b = clone(base)
    const exp = b.experiences[1]!
    exp.missions[0]!.achievements[0]!.text = 'Déploiement du bastion sur 6 pays.'
    exp.missions.splice(1, 1)
    exp.missions.push({ ...newMission(), id: 'm3', client: 'Assureur Exemple', role: 'PMO' })
    const changes = diffCv(base, b)
    expect(changes.map((c) => [c.kind, c.item, c.field])).toEqual([
      ['removed', 'Consultante cybersécurité · Cabinet Imaginaire › Distributeur Exemple · Consultante vulnérabilités', ''],
      // Puis dans l'ordre de la nouvelle version.
      ['changed', 'Consultante cybersécurité · Cabinet Imaginaire › Banque Fictive · Cheffe de projet PAM', 'Réalisations'],
      ['added', 'Consultante cybersécurité · Cabinet Imaginaire › Assureur Exemple · PMO', ''],
    ])
    expect(changes[1]).toMatchObject({ before: 'Déploiement du bastion d\'administration sur 4 pays.', after: 'Déploiement du bastion sur 6 pays.' })
  })

  it('compétences d’une liste, ordre des expériences, élément supprimé', () => {
    const b = clone(base)
    b.skills[0]!.items = ['EBIOS RM', 'CyberArk', 'ISO 27001', 'NIS2']
    b.experiences.reverse()
    b.awards = []
    const changes = diffCv(base, b)
    expect(changes).toContainEqual(expect.objectContaining({ section: 'Compétences', item: 'Cybersécurité', field: 'Éléments', before: 'EBIOS RM · CyberArk · Qualys · ISO 27001', after: 'EBIOS RM · CyberArk · ISO 27001 · NIS2' }))
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'moved', section: 'Expériences', field: 'Ordre' }))
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'removed', section: 'Distinctions', item: 'Prix du meilleur blog technologie' }))
  })

  it('rubriques libres : titre, entrées, ajout ; ordre et visibilité des rubriques', () => {
    const b = clone(base)
    b.customSections[0]!.title = 'Engagements'
    b.customSections[0]!.entries[0]!.description = 'Ateliers mensuels.'
    const withNew = addCustomSection(b, 'Enseignement')
    withNew.sections = withNew.sections.map((s) => (s.key === 'interests' ? { ...s, visible: false } : s))
    const changes = diffCv(base, withNew)
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'changed', section: 'Engagements', sectionId: 'custom:cus1', field: 'Titre de la rubrique', before: 'Bénévolat', after: 'Engagements' }))
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'changed', section: 'Engagements', item: 'Formatrice', field: 'Description', after: 'Ateliers mensuels.' }))
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'added', section: 'Enseignement' }))
    expect(changes).toContainEqual(expect.objectContaining({ section: 'Rubriques', item: 'Centres d’intérêt', field: 'Visible', before: 'oui', after: 'non' }))
    // Ajouter une rubrique en fin de liste ne change pas l'ordre relatif des autres.
    expect(changes.some((c) => c.section === 'Rubriques' && c.kind === 'moved')).toBe(false)
  })

  it('type de publication en clair', () => {
    const b = clone(base)
    b.publications[0]!.kind = 'talk'
    expect(diffCv(base, b)).toEqual([expect.objectContaining({ section: 'Publications et médias', field: 'Type', before: 'Article', after: 'Conférence' })])
  })
})

describe('diffLines', () => {
  it('textes identiques ou vides', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'equal', text: 'b' },
    ])
    expect(diffLines('', '')).toEqual([])
    expect(diffLines('', 'x')).toEqual([{ op: 'add', text: 'x' }])
    expect(diffLines('x', '')).toEqual([{ op: 'del', text: 'x' }])
  })

  it('remplacement au milieu : suppression puis ajout', () => {
    expect(diffLines('Profil\nChef de projet\nCompétences', 'Profil\nResponsable sécurité\nCompétences')).toEqual([
      { op: 'equal', text: 'Profil' },
      { op: 'del', text: 'Chef de projet' },
      { op: 'add', text: 'Responsable sécurité' },
      { op: 'equal', text: 'Compétences' },
    ])
  })

  it('plus longue sous-suite commune', () => {
    const d = diffLines('a\nb\nc\nd\ne', 'a\nc\nd\nx\ne')
    expect(d.filter((l) => l.op === 'equal').map((l) => l.text)).toEqual(['a', 'c', 'd', 'e'])
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 })
  })

  it('fins de ligne Windows', () => {
    expect(diffLines('a\r\nb', 'a\nb').every((l) => l.op === 'equal')).toBe(true)
  })

  it('reste rapide sur de longs textes', () => {
    const a = Array.from({ length: 1500 }, (_, i) => `ligne ${i}`).join('\n')
    const b = a.replace('ligne 700', 'ligne modifiée')
    const t = performance.now()
    const d = diffLines(a, b)
    expect(performance.now() - t).toBeLessThan(1000)
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 })
  })
})
