import { normalize } from '@/ats/text'

/**
 * Données linguistiques de l'analyse d'offre : listes statiques, aucune IA, aucun appel réseau.
 * Les entrées sont écrites en clair et normalisées au chargement par `normalizeJob` (minuscules,
 * sans accents, sans élisions) : le dictionnaire et les textes comparés suivent la même règle.
 */

/**
 * Normalisation des textes d'offre et de CV : `normalize` (minuscules, sans accents, espaces)
 * puis retrait des élisions françaises (« d'une » → « une », « l'équipe » → « equipe »,
 * « qu'il » → « il ») pour qu'aucune élision ne ressorte comme mot-clé.
 */
export function normalizeJob(text: string): string {
  return normalize(text)
    .replace(/(^|[^\p{L}\p{N}])(?:jusqu|lorsqu|puisqu|quoiqu|qu|d|l|j|n|s|c|m|t)'(?=\p{L})/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Termes de compétences courants (techniques, méthodes, cybersécurité, data, développement, gestion). */
const RAW_SKILL_TERMS: string[] = [
  // Méthodes et gestion
  'Scrum', 'agile', 'Kanban', 'SAFe', 'ITIL', 'PRINCE2', 'PMP', 'cycle en V', 'Lean', 'DevOps', 'DevSecOps', 'CI/CD',
  'gestion de projet', 'pilotage de projet', 'conduite de projet', 'conduite du changement', 'chef de projet', 'project management',
  'roadmap', 'budget', 'KPI', 'OKR', 'reporting', 'COPIL', 'comité de pilotage', 'product owner', 'product manager',
  'gestion des risques', 'analyse de risques', 'conformité', 'audit', 'gouvernance', 'PMO', 'AMOA', 'recette', 'MOA',
  // Cybersécurité
  'cybersécurité', 'sécurité informatique', "sécurité des systèmes d'information", 'SSI', 'SOC', 'SIEM', 'EDR', 'XDR', 'MDR',
  'PAM', 'IAM', 'MFA', 'SSO', 'zero trust', "test d'intrusion", 'red team', 'blue team', 'threat intelligence',
  'EBIOS', 'EBIOS RM', 'ISO 27001', 'ISO 27002', 'ISO 27005', 'ISO 22301', 'ISO 9001', 'NIS2', 'DORA', 'RGPD', 'GDPR', 'LPM', 'PASSI', 'PCI DSS', 'NIST', 'OWASP', 'MITRE ATT&CK',
  'gestion des vulnérabilités', 'vulnerability management', 'durcissement', 'hardening', 'gestion des incidents', 'réponse à incident', 'forensic',
  'homologation', 'bastion', 'CyberArk', 'Wallix', 'SentinelOne', 'CrowdStrike', 'Qualys', 'Tenable', 'Nessus', 'Splunk', 'Sentinel', 'QRadar', 'Wazuh',
  'PSSI', 'PCA', 'PRA', 'SecNumCloud',
  // Systèmes, réseaux, cloud
  'Active Directory', 'Azure', 'Entra ID', 'AWS', 'Google Cloud', 'Microsoft 365', 'Linux', 'Windows', 'macOS', 'VMware', 'Intune',
  'Kubernetes', 'Docker', 'Terraform', 'Ansible', 'PowerShell', 'Bash', 'firewall', 'VPN', 'DNS', 'DHCP', 'NAC', 'proxy', 'SD-WAN', 'cloud',
  // Développement
  'Python', 'Java', 'JavaScript', 'TypeScript', 'PHP', 'Symfony', 'Laravel', 'React', 'Angular', 'Vue.js', 'Node.js', 'Next.js', 'Spring',
  'HTML', 'CSS', 'Sass', 'Tailwind', 'GraphQL', 'REST', 'API', 'SQL', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Git', 'GitHub', 'GitLab',
  'Jest', 'Cypress', 'Playwright', 'Webpack', 'Vite', 'tests unitaires', 'TDD', 'accessibilité', 'RGAA', 'WCAG', 'SEO', 'UX', 'design system',
  // Data
  'Power BI', 'Tableau', 'Excel', 'VBA', 'DAX', 'Power Query', 'Looker Studio', 'Looker', 'dbt', 'Airflow', 'Snowflake', 'BigQuery', 'pandas', 'NumPy',
  'statistiques', 'data visualisation', 'dataviz', 'ETL', 'data warehouse', 'machine learning', 'A/B testing', 'Google Analytics',
  'SAP', 'Salesforce', 'Jira', 'Confluence', 'ServiceNow', 'Figma',
  // Langues
  'anglais', 'english', 'allemand', 'espagnol', 'italien',
]

/**
 * Alias : graphies d'un MÊME terme (abréviation, accolement, marque). Un alias trouvé dans le CV
 * vaut présence du terme. `cased` : formes reconnues seulement avec cette casse exacte, dans le texte
 * d'origine (« AD » oui, « ad » non ; « SAFe » oui, « safe » non ; « Tableau » l'outil, jamais
 * « tableau de bord » ni « tableaux »). `label` : forme affichée par défaut.
 */
export interface AliasGroup {
  key: string
  label?: string
  forms: string[]
  /** Formes à casse exacte (mot entier, texte d'origine). */
  cased?: string[]
  /** Contexte exclu après une forme à casse exacte (source d'expression régulière). */
  notFollowedBy?: string
}

export const ALIAS_GROUPS: AliasGroup[] = [
  { key: 'node.js', label: 'Node.js', forms: ['node.js', 'nodejs', 'node js', 'node'] },
  { key: 'react', label: 'React', forms: ['react', 'react.js', 'reactjs'] },
  { key: 'vue.js', label: 'Vue.js', forms: ['vue.js', 'vuejs', 'vue 3'] },
  { key: 'next.js', label: 'Next.js', forms: ['next.js', 'nextjs'] },
  { key: 'javascript', label: 'JavaScript', forms: ['javascript', 'js', 'ecmascript'] },
  { key: 'postgresql', label: 'PostgreSQL', forms: ['postgresql', 'postgres'] },
  { key: 'power bi', label: 'Power BI', forms: ['power bi', 'powerbi'] },
  { key: 'microsoft 365', label: 'Microsoft 365', forms: ['microsoft 365', 'm365', 'office 365', 'o365'] },
  { key: 'google cloud', label: 'Google Cloud', forms: ['google cloud', 'google cloud platform', 'gcp'] },
  { key: 'active directory', label: 'Active Directory', forms: ['active directory'], cased: ['AD'] },
  { key: 'entra id', label: 'Entra ID', forms: ['entra id', 'azure ad', 'azure active directory'] },
  { key: 'kubernetes', label: 'Kubernetes', forms: ['kubernetes', 'k8s'] },
  { key: 'ci/cd', label: 'CI/CD', forms: ['ci/cd', 'ci-cd', 'cicd', 'ci cd'] },
  { key: 'aws', label: 'AWS', forms: ['aws', 'amazon web services'] },
  { key: 'machine learning', label: 'machine learning', forms: ['machine learning', 'apprentissage automatique'], cased: ['ML'] },
  { key: 'data visualisation', label: 'data visualisation', forms: ['data visualisation', 'data visualization', 'dataviz', 'datavisualisation'] },
  { key: 'pci dss', label: 'PCI DSS', forms: ['pci dss', 'pci-dss'] },
  { key: 'ebios rm', label: 'EBIOS RM', forms: ['ebios rm', 'ebios risk manager'] },
  { key: 'a/b testing', label: 'A/B testing', forms: ['a/b testing', 'ab testing', 'a/b test', 'test a/b'] },
  { key: 'test intrusion', label: 'test d’intrusion', forms: ["test d'intrusion", 'pentest'] },
  { key: 'safe', label: 'SAFe', forms: [], cased: ['SAFe'] },
  { key: 'tableau', label: 'Tableau', forms: [], cased: ['Tableau'], notFollowedBy: '\\s+de\\s+bord' },
]

/** Sigles et mots en capitales qui ne sont jamais des compétences (type de contrat, taille d'entreprise, rôles…). */
export const NON_SKILL_TERMS = new Set(
  (
    'esn eti pme tpe ge cdi cdd cdic comex codir rh drh ssii h/f f/h hf fh h-f ca pdg dg dga dsi rssi dpo ceo cto cio ciso cfo coo ' +
    'it si sa sas sarl tjm bac k€ keur eur ue fr en uk us usa ok nb etp rtt cse pee perco idf cv vie vae iut bts dut tt jo qvt cac ' +
    'pc faq asap via rer tgv sncf ratp iso iec iso/iec a/b ' +
    'linkedin youtube facebook instagram whatsapp tiktok glassdoor indeed hellowork apec'
  ).split(' '),
)

/** Groupes d'expressions équivalentes (formulations différentes) : on propose de reprendre celle de l'offre. */
const RAW_SYNONYM_GROUPS: string[][] = [
  ['gestion de projet', 'pilotage de projet', 'conduite de projet', 'project management', 'chef de projet'],
  ['cybersécurité', 'sécurité informatique', "sécurité des systèmes d'information", 'SSI', 'cyber security', 'cyber-sécurité', 'sécurité des SI'],
  ['gestion des risques', 'analyse de risques', 'risk management', 'risk assessment', 'évaluation des risques'],
  ['gestion des vulnérabilités', 'vulnerability management'],
  ['RGPD', 'GDPR', 'protection des données'],
  ['audit', 'auditer'],
  ['gestion des incidents', 'réponse à incident', 'réponse aux incidents', 'incident response', 'traitement des incidents'],
  ['MFA', 'authentification multifacteur', 'authentification forte', 'double authentification'],
  ['KPI', 'indicateurs de performance', 'tableaux de bord', 'indicateurs'],
  ['anglais', 'english'],
  ['comité de pilotage', 'COPIL'],
  ['product owner', 'PO'],
  ['tests unitaires', 'TDD', 'tests automatisés'],
  ['accessibilité', 'RGAA', 'WCAG'],
  ['statistiques', 'analyse statistique'],
]

export const STOPWORDS = new Set(
  (
    'le la les un une des du de d l et ou a au aux en dans pour par sur avec sans sous chez vers votre vos notre nos nous vous il elle ils elles on ce cet cette ces ' +
    'qui que quoi dont est sont etre avoir ont plus moins tres bien aussi comme mais si ne pas se sa son ses leur leurs y afin ainsi alors donc car entre ' +
    'ton ta tes tu te toi je me mon ma mes tout tous toute toutes chaque plusieurs autre autres meme memes sein lors etc puis deja encore ' +
    'the a an and or of to in for on with at by from your our we you is are be have as it this that these those will can may their its'
  ).split(' '),
)

/** Mots d'annonce sans valeur de compétence : exclus des mots-clés. */
export const GENERIC_WORDS = new Set(
  (
    'poste postes mission missions entreprise societe groupe equipe equipes candidat candidats candidate profil experience experiences annee annees ans an ' +
    'connaissance connaissances capacite capacites autonomie rigueur esprit travail cdi cdd h/f f/h rejoindre recherche recherchons sein cadre contexte vie offre ' +
    'salaire teletravail avantages france paris lyon lille nantes bordeaux toulouse marseille niveau minimum idealement souhaite souhaitee appreciee apprecie atout atouts plus ' +
    'bonne bon bonnes bons grande grand fort forte excellent excellente diplome bac ecole ingenieur master licence formation domaine secteur environnement ' +
    'outil outils sujet sujets projet projets service services client clients besoin besoins solution solutions activite activites responsable ' +
    'data propos lieu contrat date debut statut process processus pourquoi rejoignez postulez ideal bonus quotidien role description descriptif ' +
    'job role team company position skills skill experience years year strong good great working work join about candidate requirements responsibilities'
  ).split(' '),
)

export type Importance = 'required' | 'preferred' | 'mentioned'

/** Titres de rubriques d'annonce reconnus (normalisés, sans « : » final) et importance qu'ils fixent. */
export const HEADING_LEXICON: ReadonlyMap<string, Importance> = new Map<string, Importance>([
  ...(
    [
      'profil recherche', 'profil souhaite', 'votre profil', 'ton profil', 'profil', 'le profil', 'profil du candidat', 'qui etes-vous', 'qui es-tu',
      'competences requises', 'competences', 'competences techniques', 'competences attendues', 'prerequis', 'pre-requis', 'qualifications', 'exigences',
      'savoir-faire', 'savoir-etre', 'environnement technique', 'stack technique', 'stack', 'technologies', 'ce que nous recherchons', 'vous etes', 'vous avez',
      'requirements', 'your profile', 'what we are looking for', 'qualifications required',
      'missions', 'vos missions', 'tes missions', 'missions principales', 'vos missions principales', 'vos responsabilites', 'responsabilites', 'le poste',
      'description du poste', 'descriptif du poste', 'ce que vous ferez', 'au quotidien', 'votre role', 'ton role', 'vos activites', 'activites principales',
      'what you will do', 'responsibilities', 'your mission', 'the role',
    ] as const
  ).map((h) => [h, 'required'] as [string, Importance]),
  ...(
    ['un plus', 'les plus', 'les petits plus', 'atouts', 'serait un plus', 'serait un atout', 'competences appreciees', 'idealement', 'nice to have', 'bonus', 'pluses'] as const
  ).map((h) => [h, 'preferred'] as [string, Importance]),
  ...(
    [
      'qui sommes-nous', 'qui sommes nous', 'a propos', 'a propos de nous', 'entreprise', 'notre entreprise', 'la societe', 'about us', 'about the company',
      'avantages', 'nos avantages', 'ce que nous offrons', 'ce que nous proposons', 'nous vous offrons', 'nous te proposons', 'pourquoi nous rejoindre',
      'informations complementaires', 'infos pratiques', 'conditions', 'remuneration', 'salaire', 'process de recrutement', 'processus de recrutement',
      'deroulement du processus', 'contexte', 'le contexte', 'localisation', 'lieu', 'type de contrat', 'contrat', 'benefits', 'why join us', 'perks',
    ] as const
  ).map((h) => [h, 'mentioned'] as [string, Importance]),
])

/** Indices d'importance dans une ligne (valables pour cette ligne seulement). */
export const REQUIRED_CUES = /(maitris|requis|exige|indispensable|obligatoire|imperati|necessaire|must[- ]have|required)/
export const PREFERRED_CUES = /(un plus|les plus|serait un (plus|atout)|est un atout|appreci|souhait|idealement|de preference|nice[- ]to[- ]have|bonus|preferred)/
/** Indices d'un titre de rubrique inconnu du lexique (ligne finissant par « : »). */
export const REQUIRED_HEADING_CUES = /(profil|competences|requis|prerequis|exig|qualifications?|requirements?|missions?|responsabilit|poste|role|vous (ferez|serez|etes|avez))/

// ── Tables dérivées (normalisées une fois) ──────────────────────────────────

const ISO_RE = /^iso(?:[ /-]?iec)?[ -]?(\d{3,5})(?:[: -]\d{4})?$/

/** Variantes d'une norme ISO : « ISO27001 », « ISO/IEC 27001 », « ISO-27001 » → même terme. */
export function isoForms(n: string): string[] {
  return [`iso ${n}`, `iso${n}`, `iso-${n}`, `iso/iec ${n}`, `iso/iec${n}`, `iso iec ${n}`, `iso/iec-${n}`]
}

const ALIAS_BY_FORM = new Map<string, AliasGroup>()
for (const g of ALIAS_GROUPS) {
  ALIAS_BY_FORM.set(g.key, g)
  for (const f of [...g.forms, ...(g.cased ?? [])]) ALIAS_BY_FORM.set(normalizeJob(f), g)
}

/** Expressions à casse exacte d'une clé (« AD », « SAFe », « Tableau » hors « tableau de bord »). */
export function casedRegexes(key: string): RegExp[] {
  const g = ALIAS_BY_FORM.get(canonicalKey(key))
  if (!g?.cased) return []
  const tail = g.notFollowedBy ? `(?!${g.notFollowedBy})` : ''
  return g.cased.map((w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![\\p{L}\\p{N}])${tail}`, 'u'))
}

/** Clé canonique d'un terme normalisé (alias et normes ISO résolus). */
export function canonicalKey(norm: string): string {
  const iso = ISO_RE.exec(norm)
  if (iso) return `iso ${iso[1]}`
  return ALIAS_BY_FORM.get(norm)?.key ?? norm
}

export function aliasGroupOf(key: string): AliasGroup | undefined {
  return ALIAS_BY_FORM.get(canonicalKey(key))
}

/** Formes normalisées à chercher pour une clé canonique (la clé elle-même, ses alias, ses variantes ISO). */
export function formsOf(key: string): string[] {
  const canon = canonicalKey(key)
  const iso = /^iso (\d{3,5})$/.exec(canon)
  if (iso) return isoForms(iso[1]!)
  const g = ALIAS_BY_FORM.get(canon)
  if (g) return g.forms.map(normalizeJob)
  return [canon]
}

/** Clés dont la reconnaissance exige la casse exacte (jamais trouvées en minuscules). */
export const CASED_ONLY_KEYS = new Set(ALIAS_GROUPS.filter((g) => g.forms.length === 0).map((g) => g.key))

export interface DictionaryTerm {
  key: string
  /** Forme affichée par défaut (casse d'origine du dictionnaire). */
  label: string
}

/** Dictionnaire normalisé et dédoublonné par clé canonique. */
export const SKILL_TERMS: DictionaryTerm[] = (() => {
  const seen = new Map<string, DictionaryTerm>()
  for (const raw of RAW_SKILL_TERMS) {
    const key = canonicalKey(normalizeJob(raw))
    if (!seen.has(key)) seen.set(key, { key, label: ALIAS_BY_FORM.get(key)?.label ?? raw })
  }
  return [...seen.values()]
})()

export const SYNONYM_GROUPS: string[][] = RAW_SYNONYM_GROUPS.map((g) => g.map((t) => canonicalKey(normalizeJob(t))))
