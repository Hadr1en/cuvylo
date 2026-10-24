import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { anonymizeProfile } from './anonymize'
import type { ProfileData } from './profile'

const fixture = (name: string) => JSON.parse(readFileSync(resolve(process.cwd(), '../shared/fixtures', name), 'utf8')) as ProfileData

describe('anonymisation : navigateur et serveur identiques', () => {
  // Même entrée piégée que backend/tests/SupportUnitTest (adresse complète, nom et téléphone recopiés, liens…) :
  // le PDF du navigateur et le lien public du serveur doivent montrer exactement la même chose.
  it('produit la même sortie que Anonymizer.php', () => {
    expect(anonymizeProfile(fixture('anonymize-input.json'))).toEqual(fixture('anonymize-expected.json'))
  })
})
