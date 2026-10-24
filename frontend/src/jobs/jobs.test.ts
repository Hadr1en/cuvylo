import { describe, expect, it } from 'vitest'
import { emptyProfile, newExperience, type ProfileData } from '@/domain/profile'
import { sampleProfileV2 } from '@/ats/testing'
import { analyzeJob, analyzeJobText } from './index'
import { canonicalKey, formsOf, normalizeJob } from './dictionary'
import { extractKeywords, headerOf, termRegex, type JobKeyword } from './extract'
import { buildSuggestions, matchKeywords } from './match'
import { CYBER_PM, DATA_ANALYST, WEB_DEV } from './fixtures/postings'

/** Fiche de poste FICTIVE (jeu historique). */
const POSTING = `Chef de projets cybersécurité (H/F)

À propos de nous
Atlas Groupe est un acteur européen de la distribution, présent dans 12 pays.

Vos missions :
- Piloter les projets de déploiement d'outils de sécurité (EDR, bastion, gestion des vulnérabilités)
- Conduire les analyses de risques EBIOS RM et suivre les plans d'actions
- Animer les comités de pilotage et produire les KPI de sécurité
- Coordonner les audits PASSI avec les équipes sécurité

Profil recherché :
- 5 ans d'expérience minimum en gestion de projet cybersécurité
- Maîtrise de Qualys ou Tenable et de CyberArk
- Connaissance d'ISO 27001 et du RGPD
- Anglais courant

Un plus : certification PRINCE2, connaissance de SentinelOne.`

function cv(over: Partial<ProfileData> = {}): ProfileData {
  const p = emptyProfile()
  p.identity.headline = 'Chef de projets sécurité'
  p.summary = 'Chef de projets orienté pilotage de projets de sécurité et analyse de risques.'
  p.experiences = [
    {
      ...newExperience(),
      id: 'e1',
      title: 'Chef de projets sécurité',
      company: 'Groupe Exemple',
      description: 'Pilotage des audits PASSI et des analyses de risques EBIOS RM.',
      achievements: [
        { id: 'a1', text: 'Déploiement de Qualys sur 64 pays.' },
        { id: 'a2', text: 'Création des KPI pour les comités de pilotage.' },
      ],
    },
  ]
  p.skills = [{ id: 's1', category: 'Sécurité', kind: 'technical', items: ['CyberArk', 'Tenable', 'ISO 27001'] }]
  p.languages = [{ id: 'l1', name: 'Anglais', level: 'Courant' }]
  return { ...p, ...over }
}

const keysOf = (posting: string) => extractKeywords(posting).keywords.map((k) => k.key)
const byKey = (posting: string) => new Map(extractKeywords(posting).keywords.map((k) => [k.key, k]))

describe('normalisation des offres', () => {
  it('retire les élisions françaises (d’, l’, qu’, j’, jusqu’…)', () => {
    expect(normalizeJob('Maîtrise d’une solution PAM')).toBe('maitrise une solution pam')
    expect(normalizeJob("l'équipe qu'il rejoindra jusqu'à l'homologation")).toBe('equipe il rejoindra a homologation')
    expect(normalizeJob("aujourd'hui")).toBe("aujourd'hui")
  })

  it('bornes de mots Unicode : « SÉCURITÉ » ne contient pas « curit »', () => {
    expect(termRegex('curit').test(normalizeJob('SÉCURITÉ'))).toBe(false)
    expect(termRegex('securite').test(normalizeJob('Équipe SÉCURITÉ'))).toBe(true)
    expect(termRegex('java').test('javascript')).toBe(false)
  })

  it('pluriels tolérés sur chaque mot', () => {
    expect(termRegex('analyse de risques').test('conduire les analyses de risques')).toBe(true)
    expect(termRegex('gestion de projet').test('gestion des projets')).toBe(true)
  })

  it('table d’alias : une seule clé canonique par terme', () => {
    expect(canonicalKey('iso27001')).toBe('iso 27001')
    expect(canonicalKey('iso/iec 27001')).toBe('iso 27001')
    expect(canonicalKey('iso/iec 27001:2022')).toBe('iso 27001')
    expect(canonicalKey('nodejs')).toBe('node.js')
    expect(canonicalKey('m365')).toBe('microsoft 365')
    expect(canonicalKey('o365')).toBe('microsoft 365')
    expect(canonicalKey('office 365')).toBe('microsoft 365')
    expect(canonicalKey('gcp')).toBe('google cloud')
    expect(canonicalKey('ad')).toBe('active directory')
    expect(canonicalKey('k8s')).toBe('kubernetes')
    expect(formsOf('iso 27001')).toContain('iso/iec 27001')
  })

  it('titres de rubrique : lignes finissant par « : » ou lexique connu, rien d’autre', () => {
    expect(headerOf('Profil recherché :')?.level).toBe('required')
    expect(headerOf('Profil souhaité')?.level).toBe('required')
    expect(headerOf('Les petits plus')?.level).toBe('preferred')
    expect(headerOf('Avantages')?.level).toBe('mentioned')
    expect(headerOf('Environnement de travail :')?.level).toBe('mentioned')
    expect(headerOf('Anglais souhaité')).toBeNull()
    expect(headerOf('Python, SQL, Docker')).toBeNull()
    expect(headerOf('Maîtrise de Kubernetes')).toBeNull()
  })
})

describe('extractKeywords — jeu historique', () => {
  const { title, keywords } = extractKeywords(POSTING)
  const map = new Map(keywords.map((k) => [k.key, k]))

  it('produit une liste propre, sans doublon ni bruit', () => {
    expect(keywords.map((k) => k.key).sort()).toEqual(
      [
        'analyse de risques', 'anglais', 'audit', 'bastion', 'chef de projet', 'comite de pilotage', 'cyberark', 'cybersecurite', 'ebios rm', 'edr',
        'gestion de projet', 'gestion des vulnerabilites', 'iso 27001', 'kpi', 'passi', 'prince2', 'qualys', 'rgpd', 'securite', 'sentinelone', 'tenable',
      ].sort(),
    )
  })

  it('reconnaît l’intitulé du poste', () => {
    expect(title).toBe('Chef de projets cybersécurité (H/F)')
  })

  it('distingue exigé, souhaité et simple mention', () => {
    expect(map.get('cyberark')?.importance).toBe('required')
    expect(map.get('ebios rm')?.importance).toBe('required')
    expect(map.get('sentinelone')?.importance).toBe('preferred')
    expect(map.get('prince2')?.importance).toBe('preferred')
  })

  it('n’extrait pas les mots génériques d’annonce', () => {
    for (const k of ['poste', 'equipes', 'experience', 'groupe', 'propos']) expect(map.has(k), k).toBe(false)
  })

  it('ne compte pas deux fois un terme du dictionnaire', () => {
    expect(map.get('gestion de projet')?.count).toBe(1)
  })

  it('renvoie une liste vide pour un texte vide', () => {
    expect(extractKeywords('  \n ')).toEqual({ title: null, keywords: [] })
  })

  it('borne le nombre de mots-clés', () => {
    const big = Array.from({ length: 400 }, (_, i) => `Compétence${i}X python sql docker kubernetes`).join('\n')
    expect(extractKeywords(big).keywords.length).toBeLessThanOrEqual(40)
  })
})

describe('offres françaises réelles', () => {
  const NEVER = ['curit', 'une', 'esn', 'eti', 'pme', 'tpe', 'comex', 'cdi', 'cdd', 'rssi', 'dsi', 'h/f', 'f/h', 'rtt', 'cse', 'si', 'iso/iec', 'iso', 'data', 'qui', 'propos']

  it('chef de projet cybersécurité : jeu de mots-clés attendu', () => {
    const keys = keysOf(CYBER_PM)
    expect(keys.sort()).toEqual(
      [
        'active directory', 'analyse de risques', 'anglais', 'audit', 'azure', 'bastion', 'chef de projet', 'comite de pilotage', 'conformite', 'cyberark',
        'cybersecurite', 'durcissement', 'ebios rm', 'edr', 'gestion de projet', 'gestion des vulnerabilites', 'homologation', 'iso 27001', 'kpi', 'mfa',
        'microsoft 365', 'nis2', 'pam', 'passi', 'pmp', 'prince2', 'qualys', 'rgpd', 'securite', 'test intrusion', 'wallix',
      ].sort(),
    )
    for (const k of NEVER) expect(keys, k).not.toContain(k)
  })

  it('chef de projet cybersécurité : alias et importances', () => {
    const map = byKey(CYBER_PM)
    expect(map.get('iso 27001')?.count).toBe(2) // « ISO/IEC 27001 » et « ISO27001 » : un seul terme
    expect(map.get('microsoft 365')?.term).toBe('M365')
    expect(map.get('active directory')?.term).toBe('AD')
    expect(map.get('cyberark')?.importance).toBe('required')
    expect(map.get('pmp')?.importance).toBe('preferred')
    expect(map.get('azure')?.importance).toBe('preferred')
    expect(map.get('conformite')?.importance).toBe('mentioned') // seulement dans « Qui sommes-nous »
    expect(map.get('conformite')?.term).toBe('conformité') // pas la forme criée « CONFORMITÉ »
    expect(map.get('securite')?.term).toBe('sécurité')
    expect(map.has('tableau')).toBe(false) // « tableaux de bord » n'est pas l'outil de BI
  })

  it('data analyst : jeu de mots-clés attendu, « Tableau » (l’outil) distinct des tableaux de bord', () => {
    const keys = keysOf(DATA_ANALYST)
    expect(keys.sort()).toEqual(
      ['a/b testing', 'airflow', 'anglais', 'bigquery', 'data visualisation', 'dbt', 'excel', 'google cloud', 'pandas', 'power bi', 'python', 'sql', 'statistiques', 'tableau'].sort(),
    )
    for (const k of NEVER) expect(keys, k).not.toContain(k)
    const map = byKey(DATA_ANALYST)
    expect(map.get('tableau')?.importance).toBe('preferred')
    expect(map.get('tableau')?.count).toBe(1)
    expect(map.get('google cloud')?.count).toBe(2) // « Google Cloud » et « GCP »
    expect(map.get('sql')?.importance).toBe('required')
  })

  it('développeur web : jeu de mots-clés attendu, SAFe seulement avec sa casse', () => {
    const keys = keysOf(WEB_DEV)
    expect(keys.sort()).toEqual(
      [
        'accessibilite', 'api', 'ci/cd', 'cypress', 'docker', 'git', 'gitlab', 'graphql', 'javascript', 'jest', 'kubernetes', 'node.js', 'postgresql', 'react',
        'rest', 'rgaa', 'saas', 'safe', 'scrum', 'sql', 'tests unitaires', 'typescript',
      ].sort(),
    )
    for (const k of NEVER) expect(keys, k).not.toContain(k)
    const map = byKey(WEB_DEV)
    expect(map.get('safe')).toMatchObject({ term: 'SAFe', importance: 'preferred', count: 1 }) // « environnement safe » ignoré
    expect(map.get('node.js')?.count).toBe(2) // « NodeJS » et « Node.js »
    expect(map.get('kubernetes')?.count).toBe(2) // « K8s » et « Kubernetes »
    expect(map.get('scrum')?.importance).toBe('required') // « SAFe est un atout » ne déborde pas sur Scrum
    expect(map.get('javascript')?.inTitle).toBe(true)
  })

  it('SAFe : ni « safe » ni « SAFE »', () => {
    expect(keysOf('Poste\nProfil :\n- Un cadre safe\n- Méthode SAFE')).not.toContain('safe')
    expect(keysOf('Poste\nProfil :\n- Framework SAFe')).toContain('safe')
  })

  it('« Tableau de bord » en début de ligne n’est pas l’outil', () => {
    expect(keysOf('Poste\nMissions :\n- Tableau de bord mensuel\n- Tableaux de bord RH')).not.toContain('tableau')
  })

  it('l’importance d’une ligne ne déborde jamais sur les suivantes', () => {
    const map = byKey('Analyste\nProfil recherché :\n- Anglais souhaité\n- Python\n- Une connaissance de Docker serait appréciée\n- Kubernetes\n- SQL indispensable')
    expect(map.get('anglais')?.importance).toBe('preferred')
    expect(map.get('python')?.importance).toBe('required')
    expect(map.get('docker')?.importance).toBe('preferred')
    expect(map.get('kubernetes')?.importance).toBe('required')
    expect(map.get('sql')?.importance).toBe('required')
  })

  it('« Libellé : contenu » s’applique à toute la ligne et à elle seule', () => {
    const map = byKey('Poste\nUn plus : certification PRINCE2, connaissance de SentinelOne.\nMaîtrise de Splunk')
    expect(map.get('prince2')?.importance).toBe('preferred')
    expect(map.get('sentinelone')?.importance).toBe('preferred')
    expect(map.get('splunk')?.importance).toBe('required')
  })

  it('une rubrique non qualifiante remet l’importance à « mentionné »', () => {
    const map = byKey('Poste\nProfil recherché :\n- Python\nAvantages :\n- Formation Docker offerte')
    expect(map.get('docker')?.importance).toBe('mentioned')
  })

  it('mots criés et élisions n’apparaissent jamais', () => {
    const keys = keysOf('Poste\nVOUS REJOINDREZ LA DIRECTION SÉCURITÉ.\nIMPORTANT : poste en CDI, au sein d’une ESN.\nMaîtrise d’une solution SIEM.')
    expect(keys).toContain('siem')
    for (const k of ['important', 'curit', 'securite', 'une', 'cdi', 'esn', 'vous', 'direction']) expect(keys, k).not.toContain(k)
  })
})

describe('analyzeJob', () => {
  const analysis = analyzeJob(POSTING, cv())
  const status = (a: ReturnType<typeof analyzeJob>, key: string) => a.matches.find((m) => m.key === key)?.status

  it('marque présents les termes cités dans une expérience', () => {
    for (const k of ['qualys', 'ebios rm', 'passi', 'kpi', 'analyse de risques', 'comite de pilotage']) expect(status(analysis, k), k).toBe('present')
  })

  it('marque « listé » ce qui n’est que dans les compétences', () => {
    expect(status(analysis, 'cyberark')).toBe('listed')
    expect(status(analysis, 'iso 27001')).toBe('listed')
  })

  it('marque absents les termes que le CV ne contient pas — sans rien inventer', () => {
    expect(status(analysis, 'sentinelone')).toBe('missing')
    expect(status(analysis, 'prince2')).toBe('missing')
    expect(status(analysis, 'rgpd')).toBe('missing')
    const forMissing = analysis.suggestions.filter((s) => s.kind === 'missing')
    expect(forMissing.length).toBeGreaterThan(0)
    for (const s of forMissing) expect(s.message).toMatch(/Si vous l’avez réellement|Ne l’ajoutez que si c’est vrai|Sinon, ne l’ajoutez pas/)
  })

  it('propose de reprendre la formulation de l’offre quand le CV dit la même chose autrement', () => {
    const data = cv()
    data.summary = 'Conduite de projets de sécurité informatique.'
    data.experiences[0]!.description = ''
    data.experiences[0]!.achievements = []
    const a = analyzeJob('Chef de projet\nProfil recherché :\n- Gestion de projet\n- Cybersécurité', data)
    expect(status(a, 'gestion de projet')).toBe('variant')
    expect(a.suggestions.some((s) => s.kind === 'variant')).toBe(true)
  })

  it('calcule la couverture des exigences', () => {
    expect(analysis.required.total).toBeGreaterThan(0)
    expect(analysis.required.found).toBeLessThanOrEqual(analysis.required.total)
    expect(analysis.all.total).toBeGreaterThanOrEqual(analysis.required.total)
  })

  it('compare l’intitulé de l’offre au titre du CV, sans tenir compte de « (H/F) »', () => {
    expect(analysis.suggestions.some((s) => s.kind === 'title')).toBe(true)
    const same = analyzeJob(POSTING, cv({ identity: { ...emptyProfile().identity, headline: 'Chef de projets cybersécurité' } }))
    expect(same.suggestions.some((s) => s.kind === 'title')).toBe(false)
  })

  it('reconnaît les pluriels et ignore la casse et les accents', () => {
    const data = cv()
    data.skills = [{ id: 's', category: '', kind: 'technical', items: ['Firewalls', 'Vulnérabilités'] }]
    const a = analyzeJob('Poste\nProfil recherché :\n- firewall\n- vulnerabilites\n- firewall\n- vulnerabilites\n- firewall\n- vulnerabilites', data)
    expect(status(a, 'firewall')).toBe('listed')
  })

  it('ne confond pas un terme avec une sous-chaîne d’un autre mot', () => {
    const data = cv()
    data.skills = [{ id: 's', category: '', kind: 'technical', items: ['Javascript'] }]
    const a = analyzeJob('Dev\nProfil recherché :\n- Java\n- SQL', data)
    expect(status(a, 'java')).toBe('missing')
  })

  it('les alias du CV satisfont l’offre (ISO27001, K8s, Active Directory, Microsoft 365, GCP)', () => {
    const data = cv()
    data.skills = [{ id: 's', category: '', kind: 'technical', items: ['ISO27001', 'K8s', 'Active Directory', 'Microsoft 365', 'GCP', 'NodeJS'] }]
    const a = analyzeJob('Poste\nProfil :\n- ISO/IEC 27001\n- Kubernetes\n- AD\n- O365\n- Google Cloud\n- Node.js', data)
    for (const k of ['iso 27001', 'kubernetes', 'active directory', 'microsoft 365', 'google cloud', 'node.js']) expect(status(a, k), k).toBe('listed')
  })

  it('« ad hoc » n’est pas Active Directory ; « tableaux de bord » n’est pas Tableau', () => {
    const data = cv()
    data.summary = 'Réunions ad hoc et création de tableaux de bord.'
    const a = analyzeJob('Poste\nProfil :\n- AD\n- Maîtrise de Tableau', data)
    expect(status(a, 'active directory')).toBe('missing')
    expect(status(a, 'tableau')).toBe('missing')
  })
})

describe('analyzeJob sur le contenu v2', () => {
  const data = sampleProfileV2()
  const kw = (key: string): JobKeyword => ({ key, term: key, importance: 'required', count: 1, inTitle: false, weight: 1 })
  const match = (key: string, d: ProfileData = data) => matchKeywords([kw(key)], d)[0]!

  it('cherche dans les missions, leurs compétences, les compétences des expériences et les projets', () => {
    const a = analyzeJob('Poste\nProfil :\n- Qualys\n- CyberArk\n- Active Directory\n- Gestion des risques\n- Homologation', data)
    const m = (k: string) => a.matches.find((x) => x.key === k)
    expect(m('qualys')?.status).toBe('present') // réalisation de mission
    expect(m('active directory')?.foundIn).toEqual(['experiences']) // compétence d'une mission
    expect(m('gestion des risques')?.status).toBe('present') // compétence d'une expérience
    expect(m('homologation')?.status).toBe('present')
    expect(match('sensibilisation').foundIn).toEqual(['projects'])
    expect(match('sensibilisation').status).toBe('present')
  })

  it('une rubrique masquée ne compte pas : le PDF envoyé ne la contient pas', () => {
    const d = sampleProfileV2()
    d.sections = d.sections.map((s) => (s.key === 'projects' ? { ...s, visible: false } : s))
    expect(matchKeywords([kw('sensibilisation')], d)[0]).toMatchObject({ status: 'missing', foundIn: [] })
  })

  it('texte d’un PDF analysé : tout le texte compte, sans plafond ni « seulement en compétences »', () => {
    // Un long bloc avant le terme : l'ancien brouillon d'import (4 000 caractères par bloc) le perdait.
    const text = ['EXPÉRIENCE', 'x'.repeat(5000), 'COMPÉTENCES', 'Python, Git'].join('\n')
    const a = analyzeJobText('Développeur (H/F)\nProfil recherché :\n- Python\n- Git\n- Kubernetes', text)
    const m = (k: string) => a.matches.find((x) => x.key === k)
    expect(m('python')).toMatchObject({ status: 'present', foundIn: ['document'] })
    expect(m('git')?.status).toBe('present')
    expect(m('kubernetes')?.status).toBe('missing')
    expect(a.matches.some((x) => x.status === 'listed')).toBe(false)
  })

  it('rubriques libres, publications, distinctions et centres d’intérêt', () => {
    expect(match('seniors')).toMatchObject({ status: 'present', foundIn: ['custom:cus1'] })
    expect(match('rancongiciels').foundIn).toEqual(['publications'])
    expect(match('blog')).toMatchObject({ status: 'listed', foundIn: ['awards'] })
    expect(match('semi-marathon')).toMatchObject({ status: 'listed', foundIn: ['interests'] })
  })

  it('les suggestions nomment les rubriques en clair', () => {
    const d = sampleProfileV2()
    const matches = matchKeywords([kw('blog'), kw('semi-marathon')], d)
    const messages = buildSuggestions(null, matches, d).map((s) => s.message)
    expect(messages[0]).toContain('distinctions')
    expect(messages[1]).toContain('centres d’intérêt')
    expect(messages.every((m) => !m.includes('custom:'))).toBe(true)
  })

  it('un terme saisi sur deux champs différents n’est pas reconstitué à cheval', () => {
    const d = { ...emptyProfile(), skills: [{ id: 's', category: '', kind: 'technical' as const, items: ['Gestion', 'Projet'] }] }
    expect(match('gestion projet', d).status).toBe('missing')
  })
})
