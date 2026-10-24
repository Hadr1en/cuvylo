import { SECTION_LABELS, sectionHasContent, sectionId, sectionLabel, type ProfileData, type SectionId, type SectionKey } from '@/domain/profile'
import { EMAIL_RE, describeChar, isPlausiblePhone, unsupportedChars, upperRatio, wordCount } from '../text'
import type { AnalysisContext, Issue, Rule } from '../types'

export interface ContentText {
  text: string
  /** Rubrique d'affichage (clé fixe ou `custom:<id>`) ; absente pour l'en-tête (identité, liens). */
  section?: SectionId
  /** Libellé lisible du champ, pour les messages. */
  field: string
  /**
   * Faux pour les étiquettes dont l'affichage dépend du modèle (compétences d'une expérience, d'une
   * mission ou d'un projet) : elles comptent pour la lisibilité, pas pour la couverture du texte extrait.
   */
  printed: boolean
}

/** Texte de chaque champ de contenu, avec sa rubrique : sert aux règles de lisibilité et à l'analyse d'offre. */
export function contentTexts(data: ProfileData): ContentText[] {
  const out: ContentText[] = []
  const add = (text: string, field: string, section?: SectionId, printed = true) => {
    if (text.trim()) out.push({ text, field, printed, ...(section ? { section } : {}) })
  }
  const { identity: id } = data
  for (const [k, v] of Object.entries(id)) {
    // La photo est une image encodée, pas du texte.
    if (k !== 'photo') add(v, `identité (${k})`)
  }
  add(data.summary, 'résumé', 'summary')
  for (const e of data.experiences) {
    add(e.title, 'intitulé de poste', 'experiences')
    add(e.company, 'entreprise', 'experiences')
    add(e.location, 'lieu', 'experiences')
    add(e.description, 'description de poste', 'experiences')
    for (const a of e.achievements) add(a.text, 'réalisation', 'experiences')
    for (const s of e.skills) add(s, 'compétence d’une expérience', 'experiences', false)
    for (const m of e.missions) {
      add(m.client, 'client de mission', 'experiences')
      add(m.role, 'rôle en mission', 'experiences')
      add(m.location, 'lieu de mission', 'experiences')
      add(m.description, 'description de mission', 'experiences')
      for (const a of m.achievements) add(a.text, 'réalisation de mission', 'experiences')
      for (const s of m.skills) add(s, 'compétence de mission', 'experiences', false)
    }
  }
  for (const s of data.skills) {
    add(s.category, 'catégorie de compétences', 'skills')
    for (const i of s.items) add(i, 'compétence', 'skills')
  }
  for (const e of data.education) {
    add(e.degree, 'diplôme', 'education')
    add(e.school, 'établissement', 'education')
    add(e.location, 'lieu de formation', 'education')
    add(e.description, 'détails de formation', 'education')
  }
  for (const c of data.certifications) {
    add(c.name, 'certification', 'certifications')
    add(c.issuer, 'organisme', 'certifications')
  }
  for (const l of data.languages) {
    add(l.name, 'langue', 'languages')
    add(l.level, 'niveau de langue', 'languages')
  }
  for (const p of data.projects) {
    add(p.name, 'projet', 'projects')
    add(p.role, 'rôle dans un projet', 'projects')
    add(p.description, 'description de projet', 'projects')
    for (const s of p.skills) add(s, 'compétence d’un projet', 'projects', false)
  }
  for (const a of data.awards) {
    add(a.title, 'distinction', 'awards')
    add(a.issuer, 'organisme de la distinction', 'awards')
    add(a.description, 'description de distinction', 'awards')
  }
  for (const p of data.publications) {
    add(p.title, 'publication', 'publications')
    add(p.outlet, 'média ou éditeur', 'publications')
    add(p.description, 'description de publication', 'publications')
  }
  for (const i of data.interests) add(i.text, 'centre d’intérêt', 'interests')
  for (const c of data.customSections) {
    const sid: SectionId = `custom:${c.id}`
    const name = c.title.trim() || 'rubrique libre'
    add(c.title, 'titre de rubrique libre', sid)
    for (const e of c.entries) {
      add(e.title, `titre (${name})`, sid)
      add(e.subtitle, `sous-titre (${name})`, sid)
      add(e.description, `description (${name})`, sid)
    }
  }
  for (const l of data.links) add(l.label, 'libellé de lien')
  return out
}

/** Textes longs susceptibles d'être saisis comme des paragraphes ou des puces. */
export function narrativeTexts(data: ProfileData): string[] {
  return [
    ...data.experiences.flatMap((e) => [
      e.description,
      ...e.achievements.map((a) => a.text),
      ...e.missions.flatMap((m) => [m.description, ...m.achievements.map((a) => a.text)]),
    ]),
    ...data.projects.map((p) => p.description),
    ...data.customSections.flatMap((c) => c.entries.map((e) => e.description)),
  ]
}

const planned = (ctx: AnalysisContext, key: SectionKey) => ctx.plan.some((s) => s.key === key)
const hiddenWithContent = (ctx: AnalysisContext, key: SectionKey) => {
  const ref = ctx.data.sections.find((s) => s.key === key)
  return ref !== undefined && !ref.visible
}

function sectionRule(key: SectionKey, severity: 'error' | 'warning' | 'info', title: string, absent: string, fix: string): Rule {
  return {
    id: `section-${key}`,
    category: 'essential',
    title,
    run(ctx) {
      if (planned(ctx, key)) return []
      const hidden = hiddenWithContent(ctx, key)
      return [
        {
          ruleId: `section-${key}`,
          severity,
          section: key,
          message: hidden ? `La rubrique « ${SECTION_LABELS[key]} » est masquée sur ce CV.` : absent,
          fix: hidden ? 'Affichez-la depuis l’onglet Contenu si elle est utile pour ce poste.' : fix,
        },
      ]
    },
  }
}

const trim = (s: string) => s.trim()
const entryLabel = (...parts: string[]) => parts.map(trim).filter(Boolean).join(' · ')

export const CONTENT_RULES: Rule[] = [
  // ── Rubriques essentielles ──────────────────────────────────────
  {
    id: 'identity-name',
    category: 'essential',
    title: 'Nom et prénom renseignés',
    run: ({ data }) =>
      trim(data.identity.firstName) && trim(data.identity.lastName)
        ? []
        : [{ ruleId: 'identity-name', severity: 'error', message: 'Le nom ou le prénom est manquant.', fix: 'Renseignez-les dans « Identité et contact » : c’est la première chose qu’un analyseur cherche.' }],
  },
  {
    id: 'contact-email',
    category: 'essential',
    title: 'Adresse e-mail présente et valide',
    run({ data }) {
      const e = trim(data.identity.email)
      if (!e) return [{ ruleId: 'contact-email', severity: 'error', message: 'Aucune adresse e-mail.', fix: 'Ajoutez une adresse e-mail professionnelle : les ATS l’utilisent comme identifiant du candidat.' }]
      if (!EMAIL_RE.test(e)) return [{ ruleId: 'contact-email', severity: 'error', message: `L’adresse « ${e} » ne ressemble pas à une adresse e-mail valide.`, fix: 'Vérifiez la saisie (format nom@domaine.fr).' }]
      return []
    },
  },
  {
    id: 'contact-phone',
    category: 'essential',
    title: 'Téléphone présent et plausible',
    run({ data }) {
      const p = trim(data.identity.phone)
      if (!p) return [{ ruleId: 'contact-phone', severity: 'warning', message: 'Aucun numéro de téléphone.', fix: 'La plupart des recruteurs attendent un numéro ; ajoutez-le si vous le souhaitez.' }]
      if (!isPlausiblePhone(p)) return [{ ruleId: 'contact-phone', severity: 'warning', message: `Le numéro « ${p} » est inhabituel (8 à 15 chiffres, séparateurs usuels).`, fix: 'Utilisez un format standard, par exemple +33 6 00 00 00 00.' }]
      return []
    },
  },
  {
    id: 'contact-location',
    category: 'essential',
    title: 'Localisation indiquée',
    run: ({ data }) =>
      trim(data.identity.location)
        ? []
        : [{ ruleId: 'contact-location', severity: 'info', message: 'Aucune localisation.', fix: 'Une ville et un pays suffisent ; beaucoup de filtres de recrutement portent sur la zone géographique.' }],
  },
  {
    id: 'headline',
    category: 'essential',
    title: 'Titre professionnel indiqué',
    run: ({ data }) =>
      trim(data.identity.headline)
        ? []
        : [{ ruleId: 'headline', severity: 'warning', message: 'Aucun titre professionnel sous le nom.', fix: 'Reprenez l’intitulé du poste visé, tel qu’il apparaît dans l’offre, tant qu’il est exact.' }],
  },
  sectionRule('experiences', 'error', 'Rubrique « Expérience professionnelle » présente', 'Aucune expérience professionnelle à afficher.', 'Ajoutez au moins une expérience (stages et missions comptent).'),
  sectionRule('education', 'warning', 'Rubrique « Formation » présente', 'Aucune formation à afficher.', 'Ajoutez votre formation la plus récente, même si elle n’est pas diplômante.'),
  sectionRule('skills', 'warning', 'Rubrique « Compétences » présente', 'Aucune compétence à afficher.', 'Listez les compétences que vous maîtrisez réellement ; les ATS les comparent aux offres.'),
  sectionRule('summary', 'info', 'Résumé de profil présent', 'Aucun résumé de profil.', 'Optionnel, mais utile : 3 à 4 phrases sur ce que vous apportez.'),

  // ── Structure ───────────────────────────────────────────────────
  {
    id: 'hidden-sections',
    category: 'structure',
    title: 'Aucune rubrique renseignée n’est masquée par inadvertance',
    run({ data }) {
      const issues: Issue[] = []
      for (const ref of data.sections) {
        if (ref.visible) continue
        const sid = sectionId(ref)
        if (sectionHasContent(data, sid)) {
          issues.push({ ruleId: 'hidden-sections', severity: 'info', section: sid, message: `« ${sectionLabel(data, sid)} » contient des données mais n’apparaît pas sur ce CV.`, fix: 'C’est voulu ? Sinon, réaffichez la rubrique.' })
        }
      }
      return issues
    },
  },
  {
    id: 'forced-breaks',
    category: 'structure',
    title: 'Sauts de page forcés cohérents avec le contenu',
    run({ data, settings, plan }) {
      const visible = new Set<string>(plan.map((s) => s.id))
      const issues: Issue[] = settings.pageBreakBefore
        .filter((k) => !visible.has(k))
        .map((k) => ({
          ruleId: 'forced-breaks',
          severity: 'info',
          section: k as SectionId,
          message: `Un saut de page est demandé avant « ${k.startsWith('custom:') && !data.customSections.some((c) => `custom:${c.id}` === k) ? 'une rubrique supprimée' : sectionLabel(data, k as SectionId)} », rubrique absente ou masquée : il est sans effet.`,
          fix: 'Retirez-le dans l’onglet Modèle pour garder des réglages propres.',
        }))
      if (plan.length === 0) {
        issues.push({ ruleId: 'forced-breaks', severity: 'info', message: 'Le CV ne contient aucune rubrique à afficher.' })
      }
      return issues
    },
  },

  // ── Informations manquantes ─────────────────────────────────────
  {
    id: 'experience-fields',
    category: 'missing',
    title: 'Chaque expérience a intitulé, entreprise et dates',
    run({ data }) {
      const issues: Issue[] = []
      for (const e of data.experiences) {
        if (!trim(e.title) && !trim(e.company)) continue
        const missing: string[] = []
        if (!trim(e.title)) missing.push('l’intitulé')
        if (!trim(e.company)) missing.push('l’entreprise')
        if (!e.startDate) missing.push('la date de début')
        if (!e.current && !e.endDate) missing.push('la date de fin (ou cochez « poste actuel »)')
        if (missing.length) {
          issues.push({ ruleId: 'experience-fields', severity: 'warning', section: 'experiences', message: `« ${entryLabel(e.title, e.company)} » : il manque ${missing.join(', ')}.`, fix: 'Les ATS reconstruisent votre ancienneté à partir de ces champs.' })
        }
      }
      return issues
    },
  },
  {
    id: 'mission-fields',
    category: 'missing',
    title: 'Chaque mission indique un client et une date de début',
    run({ data }) {
      const issues: Issue[] = []
      for (const e of data.experiences) {
        for (const m of e.missions) {
          const filled = trim(m.client) || trim(m.role) || trim(m.description) || m.achievements.some((a) => trim(a.text))
          if (!filled) continue
          const missing: string[] = []
          if (!trim(m.client)) missing.push('le client (un secteur suffit si le nom est confidentiel)')
          if (!m.startDate) missing.push('la date de début')
          if (missing.length) {
            issues.push({
              ruleId: 'mission-fields',
              severity: 'info',
              section: 'experiences',
              message: `Mission « ${entryLabel(m.client || m.role || 'sans titre')} » chez « ${entryLabel(e.company || e.title)} » : il manque ${missing.join(' et ')}.`,
              fix: 'Un client et des dates situent la mission ; « Grande banque française » convient si le nom est confidentiel.',
            })
          }
        }
      }
      return issues
    },
  },
  {
    id: 'experience-substance',
    category: 'missing',
    title: 'Chaque expérience décrit des missions ou des résultats',
    run({ data }) {
      const hasSubstance = (e: ProfileData['experiences'][number]) =>
        trim(e.description) !== '' ||
        e.achievements.some((a) => trim(a.text)) ||
        e.missions.some((m) => trim(m.description) || m.achievements.some((a) => trim(a.text)))
      return data.experiences
        .filter((e) => (trim(e.title) || trim(e.company)) && !hasSubstance(e))
        .map((e) => ({
          ruleId: 'experience-substance',
          severity: 'warning' as const,
          section: 'experiences' as const,
          message: `« ${entryLabel(e.title, e.company)} » n’a ni description ni réalisation.`,
          fix: 'Décrivez ce que vous avez réellement fait ; deux ou trois réalisations suffisent.',
        }))
    },
  },
  {
    id: 'achievements-measurable',
    category: 'missing',
    title: 'Au moins une réalisation chiffrée',
    run({ data }) {
      const texts = data.experiences
        .flatMap((e) => [...e.achievements.map((a) => a.text), ...e.missions.flatMap((m) => m.achievements.map((a) => a.text))])
        .filter(trim)
      if (texts.length < 2 || texts.some((t) => /\d/.test(t))) return []
      return [{ ruleId: 'achievements-measurable', severity: 'info', section: 'experiences', message: 'Aucune réalisation ne contient de chiffre.', fix: 'Si c’est exact, quantifiez : pourcentages, volumes, délais, budgets, taille d’équipe. N’inventez aucun chiffre.' }]
    },
  },
  {
    id: 'education-fields',
    category: 'missing',
    title: 'Chaque formation a un diplôme et un établissement',
    run: ({ data }) =>
      data.education
        .filter((e) => (trim(e.degree) || trim(e.school)) && !(trim(e.degree) && trim(e.school)))
        .map((e) => ({
          ruleId: 'education-fields',
          severity: 'warning' as const,
          section: 'education' as const,
          message: `« ${trim(e.degree) || trim(e.school)} » : ${trim(e.degree) ? 'l’établissement' : 'le diplôme'} est manquant.`,
          fix: 'Indiquez les deux ; un ATS classe la formation à partir du diplôme.',
        })),
  },
  {
    id: 'links-complete',
    category: 'missing',
    title: 'Liens complets (libellé et adresse)',
    run: ({ data }) =>
      data.links.flatMap((l): Issue[] => {
        if (!trim(l.url) && !trim(l.label)) return [{ ruleId: 'links-complete', severity: 'info', message: 'Un lien est entièrement vide.', fix: 'Supprimez-le ou complétez-le.' }]
        if (!trim(l.url)) return [{ ruleId: 'links-complete', severity: 'info', message: `Le lien « ${l.label} » n’a pas d’adresse.`, fix: 'Il ne sera pas affiché.' }]
        if (!trim(l.label)) return [{ ruleId: 'links-complete', severity: 'info', message: 'Un lien n’a pas de libellé.', fix: 'Ajoutez-en un (LinkedIn, Portfolio…) pour qu’on comprenne l’adresse.' }]
        return []
      }),
  },
  {
    id: 'summary-length',
    category: 'missing',
    title: 'Résumé de longueur raisonnable',
    run({ data }) {
      const n = data.summary.trim().length
      if (n === 0) return []
      if (n < 120) return [{ ruleId: 'summary-length', severity: 'info', section: 'summary', message: `Le résumé est très court (${n} caractères).`, fix: '3 à 4 phrases donnent plus de matière aux recruteurs et aux filtres.' }]
      if (n > 900) return [{ ruleId: 'summary-length', severity: 'warning', section: 'summary', message: `Le résumé est long (${n} caractères).`, fix: 'Gardez l’essentiel : il doit se lire en quelques secondes.' }]
      return []
    },
  },
  {
    id: 'skills-volume',
    category: 'missing',
    title: 'Un nombre suffisant de compétences listées',
    run({ data }) {
      const n = data.skills.reduce((acc, s) => acc + s.items.length, 0)
      if (n === 0 || n >= 6) return []
      return [{ ruleId: 'skills-volume', severity: 'warning', section: 'skills', message: `Seulement ${n} compétence${n > 1 ? 's' : ''} listée${n > 1 ? 's' : ''}.`, fix: 'Ajoutez celles que vous maîtrisez vraiment et qui sont pertinentes : outils, méthodes, langages.' }]
    },
  },
  {
    id: 'certifications-complete',
    category: 'missing',
    title: 'Certifications avec organisme et date',
    run: ({ data }) =>
      data.certifications
        .filter((c) => trim(c.name) && (!trim(c.issuer) || !c.date))
        .map((c) => ({
          ruleId: 'certifications-complete',
          severity: 'info' as const,
          section: 'certifications' as const,
          message: `« ${c.name} » : ${!trim(c.issuer) ? 'organisme' : 'date'} manquant${!trim(c.issuer) ? '' : 'e'}.`,
          fix: 'Une certification sans émetteur ni date est difficile à vérifier.',
        })),
  },
  {
    id: 'languages-level',
    category: 'missing',
    title: 'Niveau indiqué pour chaque langue',
    run: ({ data }) =>
      data.languages
        .filter((l) => trim(l.name) && !trim(l.level))
        .map((l) => ({ ruleId: 'languages-level', severity: 'info' as const, section: 'languages' as const, message: `Langue « ${l.name} » sans niveau.`, fix: 'Précisez-le (Courant, B2, Langue maternelle…).' })),
  },
  {
    id: 'custom-sections-titled',
    category: 'missing',
    title: 'Chaque rubrique libre a un titre',
    run: ({ data, plan }) =>
      data.customSections
        .filter((c) => !trim(c.title) && plan.some((s) => s.id === `custom:${c.id}`))
        .map((c) => ({
          ruleId: 'custom-sections-titled',
          severity: 'warning' as const,
          section: `custom:${c.id}` as SectionId,
          message: 'Une rubrique libre affichée n’a pas de titre : elle sera intitulée « Divers ».',
          fix: 'Donnez-lui un intitulé explicite (Bénévolat, Enseignement…) : un ATS classe le contenu d’après le titre.',
        })),
  },

  // ── Éléments susceptibles de perturber ──────────────────────────
  {
    id: 'unsupported-glyphs',
    category: 'risks',
    title: 'Aucun caractère que les polices du PDF ne savent pas dessiner',
    run({ data }) {
      const issues: Issue[] = []
      const reported = new Set<string>()
      for (const { text, field, section } of contentTexts(data)) {
        const bad = unsupportedChars(text).filter((c) => !reported.has(c))
        if (bad.length === 0) continue
        bad.forEach((c) => reported.add(c))
        issues.push({
          ruleId: 'unsupported-glyphs',
          severity: 'warning',
          ...(section ? { section } : {}),
          message: `Caractère(s) que les polices du PDF ne savent pas dessiner, dans ${field} : ${bad.slice(0, 5).map(describeChar).join(', ')}.`,
          fix: 'Ils s’afficheraient vides ou en carré et disparaîtraient de l’extraction, quel que soit le modèle. Remplacez-les par du texte ordinaire.',
        })
      }
      return issues
    },
  },
  {
    id: 'manual-bullets',
    category: 'risks',
    title: 'Pas de puces saisies à la main',
    run({ data }) {
      const bullet = /^\s*[-–—•·▪►✓*]\s+/
      const hits = narrativeTexts(data).filter((t) => t.split('\n').some((l) => bullet.test(l)))
      return hits.length
        ? [{ ruleId: 'manual-bullets', severity: 'info', section: 'experiences', message: `${hits.length} texte${hits.length > 1 ? 's' : ''} commence${hits.length > 1 ? 'nt' : ''} par une puce saisie à la main.`, fix: 'Chaque réalisation reçoit déjà sa puce : supprimez le tiret ou le symbole pour éviter un doublon.' }]
        : []
    },
  },
  {
    id: 'all-caps',
    category: 'risks',
    title: 'Pas de titres entièrement en majuscules',
    run({ data }) {
      const fields = [
        ...data.experiences.flatMap((e) => [e.title, e.company, ...e.missions.flatMap((m) => [m.client, m.role])]),
        ...data.education.flatMap((e) => [e.degree, e.school]),
        ...data.projects.map((p) => p.name),
        ...data.customSections.flatMap((c) => [c.title, ...c.entries.map((e) => e.title)]),
        data.identity.headline,
      ]
      const caps = fields.filter((f) => wordCount(f) >= 2 && f.replace(/\P{L}/gu, '').length >= 8 && upperRatio(f) > 0.85)
      return caps.length
        ? [{ ruleId: 'all-caps', severity: 'info', message: `${caps.length} intitulé${caps.length > 1 ? 's' : ''} en majuscules (ex. « ${caps[0]} »).`, fix: 'Les majuscules continues gênent la lecture et certains analyseurs ; la casse normale est plus sûre.' }]
        : []
    },
  },
  {
    id: 'long-blocks',
    category: 'risks',
    title: 'Pas de bloc de texte trop long',
    run({ data }) {
      const long = narrativeTexts(data).filter((t) => t.length > 600)
      return long.length
        ? [{ ruleId: 'long-blocks', severity: 'info', section: 'experiences', message: `${long.length} bloc${long.length > 1 ? 's' : ''} de plus de 600 caractères.`, fix: 'Scindez en réalisations courtes (une idée, un résultat) : plus lisible pour un humain comme pour un analyseur.' }]
        : []
    },
  },
  {
    id: 'headline-length',
    category: 'risks',
    title: 'Titre professionnel concis',
    run: ({ data }) =>
      data.identity.headline.length > 90
        ? [{ ruleId: 'headline-length', severity: 'info', message: `Le titre professionnel fait ${data.identity.headline.length} caractères.`, fix: 'Gardez une ligne : l’intitulé de poste, pas une phrase.' }]
        : [],
  },
  {
    id: 'photo-present',
    category: 'risks',
    title: 'Pas de photo sur un CV destiné aux portails de recrutement',
    run: ({ data, settings }) =>
      settings.showPhoto && !settings.anonymize && data.identity.photo !== ''
        ? [
            {
              ruleId: 'photo-present',
              severity: 'info',
              message: 'Le CV affiche une photo.',
              fix: 'Les ATS l’ignorent (elle n’apporte aucun texte) et elle expose à des biais de sélection. Courante en France, elle reste un choix : gardez-la pour un envoi direct, retirez-la pour un portail.',
            },
          ]
        : [],
  },
]
