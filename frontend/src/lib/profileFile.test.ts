import { describe, expect, it } from 'vitest'
import { emptyProfile } from '@/domain/profile'
import { sampleProfile } from '@/test/fixtures'
import { parseProfileFile, serializeProfile } from './profileFile'

describe('export / import JSON du profil', () => {
  it('fait l’aller-retour sans perte', () => {
    const data = sampleProfile()
    const parsed = parseProfileFile(serializeProfile(data))
    expect(parsed).toEqual({ ok: true, data })
  })

  it('accepte un profil brut sans enveloppe', () => {
    expect(parseProfileFile(JSON.stringify(emptyProfile())).ok).toBe(true)
  })

  it('refuse un JSON invalide', () => {
    expect(parseProfileFile('{ pas du json').ok).toBe(false)
  })

  it('refuse un autre format d’enveloppe', () => {
    const r = parseProfileFile(JSON.stringify({ format: 'autre', version: 1, data: emptyProfile() }))
    expect(r).toEqual({ ok: false, error: 'Format de fichier non reconnu.' })
  })

  it('refuse un profil qui ne passe pas le schéma strict', () => {
    const bad = { ...sampleProfile(), extra: 'x' }
    expect(parseProfileFile(JSON.stringify({ format: 'cuvylo-profile', version: 1, data: bad })).ok).toBe(false)
  })

  it('refuse un fichier démesuré', () => {
    expect(parseProfileFile(' '.repeat(500_001)).ok).toBe(false)
  })
})
