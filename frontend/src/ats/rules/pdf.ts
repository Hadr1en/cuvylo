import type { SectionId } from '@/domain/profile'
import { describeChar, compact, digitsOnly, displayUrl, extractionArtifacts, hasLetterSpacedText, normalize, unsupportedChars } from '../text'
import type { AnalysisContext, Issue, Rule } from '../types'
import { contentTexts } from './content'

/**
 * Règles portant sur le texte extrait du PDF généré (pdf.js). C'est une approximation de ce que lit
 * un ATS : un autre extracteur peut se comporter différemment. Une règle réussie rassure, elle ne garantit rien.
 */

interface Line {
  page: number
  text: string
  c: string
}

function linesOf(ctx: AnalysisContext): Line[] {
  const pdf = ctx.pdf
  if (!pdf) return []
  return pdf.pageTexts.flatMap((t, page) => t.split('\n').map((text) => ({ page, text, c: compact(text) })))
}

const fullCompact = (ctx: AnalysisContext) => compact(ctx.pdf?.text ?? '')

type HeadingStatus = 'ok' | 'misordered' | 'missing'

/**
 * Localise chaque titre de rubrique planifié dans le texte extrait, dans l'ordre du plan.
 * 1) ligne identique au titre ; 2) à défaut, ligne qui commence par le titre (extracteur qui accole du texte).
 * Un titre trouvé seulement avant le curseur est « mal ordonné ».
 */
export function locateHeadings(ctx: AnalysisContext): { id: SectionId; key: string; title: string; status: HeadingStatus }[] {
  const lines = linesOf(ctx)
  let cursor = 0
  return ctx.plan.map((s) => {
    const ch = compact(s.title)
    const find = (from: number, match: (l: Line) => boolean) => lines.findIndex((l, i) => i >= from && match(l))
    const exact = (l: Line) => l.c === ch
    const starts = (l: Line) => l.c.startsWith(ch)

    let idx = find(cursor, exact)
    if (idx < 0) idx = find(cursor, starts)
    if (idx >= 0) {
      cursor = idx + 1
      return { id: s.id, key: s.key, title: s.title, status: 'ok' as const }
    }
    const earlier = find(0, exact) >= 0 || find(0, starts) >= 0
    return { id: s.id, key: s.key, title: s.title, status: earlier ? ('misordered' as const) : ('missing' as const) }
  })
}

export const PDF_RULES: Rule[] = [
  {
    id: 'pdf-text-present',
    category: 'pdf',
    needsPdf: true,
    title: 'Le PDF contient du texte extractible',
    run(ctx) {
      if (ctx.plan.length === 0) return []
      return fullCompact(ctx).length < 40
        ? [{ ruleId: 'pdf-text-present', severity: 'error', message: 'Presque aucun texte n’a pu être extrait du PDF.', fix: 'Un PDF sans texte réel (image, polices non extractibles) est illisible pour un ATS. Régénérez le PDF ; si le problème persiste, changez de modèle.' }]
        : []
    },
  },
  {
    id: 'pdf-key-info',
    category: 'pdf',
    needsPdf: true,
    title: 'Nom, e-mail et téléphone retrouvés dans le texte extrait',
    run(ctx) {
      // CV anonymisé (dossier de compétences) : nom et coordonnées sont volontairement masqués.
      if (ctx.settings.anonymize) return []
      const { identity: id } = ctx.data
      const text = fullCompact(ctx)
      const issues: Issue[] = []
      const name = compact(`${id.firstName}${id.lastName}`)
      if (name && !text.includes(name)) {
        const glyphs = unsupportedChars(`${id.firstName}${id.lastName}`)
        issues.push(
          glyphs.length
            ? {
                ruleId: 'pdf-key-info',
                severity: 'error',
                message: `Le nom contient ${glyphs.map(describeChar).join(', ')}, que les polices du PDF ne savent pas dessiner : il n’apparaît pas tel quel dans le texte extrait.`,
                fix: 'Le problème vient de ces caractères, pas du modèle : changer de modèle n’y changera rien. Vérifiez la saisie (caractère collé depuis un autre logiciel) ou utilisez la graphie latine usuelle.',
              }
            : { ruleId: 'pdf-key-info', severity: 'error', message: 'Le nom n’apparaît pas tel quel dans le texte extrait du PDF.', fix: 'Un extracteur lit peut-être le nom lettre par lettre ou dans le désordre ; essayez un autre modèle.' },
        )
      }
      const email = compact(id.email)
      if (email && !text.includes(email)) {
        const glyphs = unsupportedChars(id.email)
        issues.push({
          ruleId: 'pdf-key-info',
          severity: 'error',
          message: 'L’adresse e-mail n’apparaît pas telle quelle dans le texte extrait du PDF.',
          fix: glyphs.length
            ? `Elle contient ${glyphs.map(describeChar).join(', ')}, impossible à imprimer : corrigez la saisie (le modèle n’y est pour rien).`
            : 'Sans e-mail lisible, la candidature ne peut pas être rattachée à vous.',
        })
      }
      const phone = digitsOnly(id.phone)
      if (phone.length >= 8 && !digitsOnly(ctx.pdf?.text ?? '').includes(phone)) {
        issues.push({ ruleId: 'pdf-key-info', severity: 'warning', message: 'Le numéro de téléphone n’est pas retrouvé tel quel dans le texte extrait.' })
      }
      return issues
    },
  },
  {
    id: 'pdf-headings',
    category: 'pdf',
    needsPdf: true,
    title: 'Titres de rubriques retrouvés dans le texte extrait',
    run(ctx) {
      return locateHeadings(ctx)
        .filter((h) => h.status === 'missing')
        .map((h) => ({
          ruleId: 'pdf-headings',
          severity: 'warning' as const,
          section: h.id,
          message: `Le titre « ${h.title} » est introuvable dans le texte extrait.`,
          fix: unsupportedChars(h.title).length
            ? `Le titre contient ${unsupportedChars(h.title).map(describeChar).join(', ')}, que les polices ne savent pas dessiner : retirez ces caractères (le modèle n’y est pour rien).`
            : 'Un ATS ne pourra pas reconnaître cette rubrique. Un modèle plus simple règle en général le problème.',
        }))
    },
  },
  {
    id: 'pdf-heading-order',
    category: 'pdf',
    needsPdf: true,
    title: 'Rubriques extraites dans le même ordre que sur le CV',
    run(ctx) {
      const bad = locateHeadings(ctx).filter((h) => h.status === 'misordered')
      return bad.length
        ? [{ ruleId: 'pdf-heading-order', severity: 'warning', section: bad[0]!.id, message: `L’extraction restitue ${bad.map((b) => `« ${b.title} »`).join(', ')} dans un autre ordre que l’affichage.`, fix: 'Un ordre de lecture désordonné mélange les rubriques chez certains ATS. Évitez les mises en page en colonnes ou à éléments flottants.' }]
        : []
    },
  },
  {
    id: 'pdf-entries',
    category: 'pdf',
    needsPdf: true,
    title: 'Postes et formations retrouvés dans le texte extrait',
    run(ctx) {
      const text = fullCompact(ctx)
      const issues: Issue[] = []
      const entries = (key: string) => new Set(ctx.plan.find((s) => s.key === key)?.entries.map((e) => e.id) ?? [])
      const exp = entries('experiences')
      for (const e of ctx.data.experiences.filter((x) => exp.has(x.id))) {
        const parts = [e.title, e.company].map(compact).filter(Boolean)
        if (parts.some((p) => !text.includes(p))) {
          issues.push({ ruleId: 'pdf-entries', severity: 'warning', section: 'experiences', message: `« ${[e.title, e.company].filter(Boolean).join(' · ')} » n’est pas retrouvée intégralement dans le texte extrait.` })
        }
        for (const m of e.missions) {
          const client = compact(m.client)
          if (client && !text.includes(client)) {
            issues.push({ ruleId: 'pdf-entries', severity: 'warning', section: 'experiences', message: `La mission « ${m.client} » (${e.company || e.title}) n’est pas retrouvée dans le texte extrait.` })
          }
        }
      }
      const edu = entries('education')
      for (const e of ctx.data.education.filter((x) => edu.has(x.id))) {
        const parts = [e.degree, e.school].map(compact).filter(Boolean)
        if (parts.some((p) => !text.includes(p))) {
          issues.push({ ruleId: 'pdf-entries', severity: 'warning', section: 'education', message: `La formation « ${e.degree || e.school} » n’est pas retrouvée intégralement dans le texte extrait.` })
        }
      }
      return issues
    },
  },
  {
    id: 'pdf-artifacts',
    category: 'pdf',
    needsPdf: true,
    title: 'Aucune anomalie d’extraction (ligatures, caractères de remplacement, lettres espacées)',
    run(ctx) {
      const text = ctx.pdf?.text ?? ''
      const issues: Issue[] = []
      const found = extractionArtifacts(text)
      if (found.length) {
        issues.push({ ruleId: 'pdf-artifacts', severity: 'warning', message: `Caractères d’extraction suspects : ${found.slice(0, 5).map(describeChar).join(', ')}.`, fix: 'Ligatures non décomposées ou glyphes sans équivalent texte : un ATS risque de casser des mots (« ﬁ » au lieu de « fi »). Retirez les symboles décoratifs du contenu ; si le problème persiste, changez de paire typographique.' })
      }
      if (hasLetterSpacedText(text)) {
        issues.push({ ruleId: 'pdf-artifacts', severity: 'warning', message: 'Du texte semble extrait lettre par lettre (« E X P É R I E N C E »).', fix: 'Un espacement de lettres trop large casse les mots à l’extraction ; réduisez-le ou changez de modèle.' })
      }
      return issues
    },
  },
  {
    id: 'pdf-links',
    category: 'pdf',
    needsPdf: true,
    title: 'Adresses des liens visibles dans le texte extrait',
    run(ctx) {
      if (ctx.settings.anonymize) return []
      const text = fullCompact(ctx)
      return ctx.data.links
        .filter((l) => l.url.trim() && !text.includes(compact(displayUrl(l.url))))
        .map((l) => ({ ruleId: 'pdf-links', severity: 'info' as const, message: `L’adresse du lien « ${l.label || l.url} » n’apparaît pas en clair dans le texte extrait.`, fix: 'Un ATS ne suit pas les liens cachés derrière un libellé : l’adresse doit figurer en toutes lettres.' }))
    },
  },
  {
    id: 'pdf-coverage',
    category: 'pdf',
    needsPdf: true,
    title: 'Tout le contenu saisi se retrouve dans le texte extrait',
    run(ctx) {
      // L'en-tête (section absente) est imprimé, sauf en mode anonyme ; la photo n'est pas du texte.
      const shown = new Set<string | undefined>([...(ctx.settings.anonymize ? [] : [undefined]), ...ctx.plan.map((s) => s.id)])
      const tokens = (t: string) => normalize(t).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      const printed = contentTexts(ctx.data).filter((c) => c.printed && shown.has(c.section) && c.field !== 'libellé de lien')
      const source = new Set(printed.flatMap((c) => tokens(c.text)).filter((w) => w.length >= 4))
      if (source.size < 10) return []
      const extracted = new Set(tokens(ctx.pdf?.text ?? ''))
      const missing = [...source].filter((w) => !extracted.has(w))
      const pct = Math.round(((source.size - missing.length) / source.size) * 100)
      if (pct >= 90) return []
      const glyphs = [...new Set(printed.flatMap((c) => unsupportedChars(c.text)))]
      return [
        {
          ruleId: 'pdf-coverage',
          severity: 'warning',
          message: `Seuls ${pct} % des mots du CV sont retrouvés dans le texte extrait (ex. : ${missing.slice(0, 4).join(', ')}).`,
          fix: glyphs.length
            ? `Le contenu contient des caractères que les polices ne savent pas dessiner (${glyphs.slice(0, 5).map(describeChar).join(', ')}) : remplacez-les d’abord, aucun modèle ne les imprimera.`
            : 'Du texte est perdu ou déformé à l’extraction (texte coupé, mise en page complexe). Un modèle à une colonne règle souvent le problème.',
        },
      ]
    },
  },
  {
    id: 'pdf-length',
    category: 'pdf',
    needsPdf: true,
    title: 'Longueur raisonnable (2 pages maximum)',
    run: ({ pdf }) =>
      pdf && pdf.pages > 2
        ? [{ ruleId: 'pdf-length', severity: 'warning', message: `Le CV fait ${pdf.pages} pages.`, fix: 'Au-delà de 2 pages, l’essentiel se dilue. Resserrez la densité, retirez les expériences anciennes ou peu pertinentes pour ce poste.' }]
        : [],
  },
  {
    id: 'pdf-sparse-pages',
    category: 'pdf',
    needsPdf: true,
    title: 'Aucune page presque vide',
    run({ pdf }) {
      if (!pdf) return []
      const issues: Issue[] = []
      pdf.pageTexts.forEach((t, i) => {
        if (i > 0 && compact(t).length < 250) {
          issues.push({ ruleId: 'pdf-sparse-pages', severity: 'warning', message: `La page ${i + 1} est presque vide (${compact(t).length} caractères).`, fix: 'Un débordement de quelques lignes ou un saut de page forcé laisse une page quasi blanche. Resserrez la densité ou retirez le saut de page.' })
        }
      })
      return issues
    },
  },
]
