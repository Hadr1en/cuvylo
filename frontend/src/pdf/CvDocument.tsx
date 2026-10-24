import { Document, Image, Link, Page, Text, View, type Styles } from '@react-pdf/renderer'
import type { ReactNode } from 'react'
import type { CvLocale, CvSettings } from '@/domain/cv'
import { anonymizeProfile } from '@/domain/anonymize'
import { formatMonth, formatPeriod } from '@/domain/dates'
import { PUBLICATION_KIND_LABELS, fullName, type Achievement, type ProfileData } from '@/domain/profile'
import { formatDuration, skillsMatrix } from '@/skills'
import { planSections, type PlannedSection } from './layout'
import { themeFor, weightFor, type Theme } from './themes'

type Style = Styles[string]

const INK = '#1a1a1a'
const MUTED = '#4d4d4d'
const RULE = '#8a8a8a'
const ON_BAND = '#f4f4f4'
const PAGE_WIDTH = 595.28

const LABELS: Record<CvLocale, { env: string; parallel: string; skill: string; experience: string; lastUsed: string; dossier: string; contact: string; other: string; kinds: Record<string, string> }> = {
  fr: {
    env: 'Environnement',
    parallel: 'en parallèle',
    skill: 'Compétence',
    experience: 'Pratique',
    lastUsed: 'Dernière utilisation',
    dossier: 'Dossier de compétences',
    contact: 'Contact',
    other: 'Autres compétences',
    kinds: PUBLICATION_KIND_LABELS,
  },
  en: {
    env: 'Environment',
    parallel: 'concurrent',
    skill: 'Skill',
    experience: 'Experience',
    lastUsed: 'Last used',
    dossier: 'Skills profile',
    contact: 'Contact',
    other: 'Other skills',
    kinds: { article: 'Article', talk: 'Talk', interview: 'Interview', book: 'Book', other: 'Other' },
  },
}

/** Texte brut multi-lignes → paragraphes. Rien n'est interprété (pas de HTML/Markdown). */
function paragraphs(text: string): string[] {
  return text.split('\n').map((p) => p.trim()).filter(Boolean)
}

/** "https://www.example.com/in/x/" → "example.com/in/x" : l'URL visible reste lisible par un analyseur. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
}

/** Teinte claire d'une couleur (fond de barre latérale) : mélange avec du blanc. */
function tint(hex: string, amount: number): string {
  const c = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const mix = (v: number) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0')
  return `#${mix(c(0))}${mix(c(1))}${mix(c(2))}`
}

interface Ctx {
  data: ProfileData
  settings: CvSettings
  theme: Theme
  locale: CvLocale
  /** Couleur d'accent effective (noir pour un modèle monochrome). */
  accent: string
  photo: string | null
}

// ── En-têtes ────────────────────────────────────────────────────────

function nameText({ data, theme }: Ctx, color: string, align = theme.nameAlign) {
  const name = fullName(data)
  if (!name) return null
  return (
    <Text
      style={{
        fontFamily: theme.headingFont,
        fontWeight: theme.nameWeight,
        fontSize: theme.nameSize,
        lineHeight: 1.08,
        color,
        textAlign: align,
        textTransform: theme.nameCase === 'uppercase' ? 'uppercase' : 'none',
        letterSpacing: theme.nameCase === 'uppercase' ? -0.3 : 0,
      }}
    >
      {name}
    </Text>
  )
}

function headlineText({ data, theme }: Ctx, color: string, align = theme.nameAlign) {
  if (!data.identity.headline) return null
  const mono = theme.metaFont === 'JetBrains Mono'
  return (
    <Text
      style={{
        fontFamily: theme.headline === 'italic' ? theme.headingFont : theme.metaFont,
        fontStyle: theme.headline,
        fontSize: theme.headlineSize,
        marginTop: 4,
        color,
        textAlign: align,
        textTransform: mono ? 'uppercase' : 'none',
        letterSpacing: mono ? 0.6 : 0,
      }}
    >
      {data.identity.headline}
    </Text>
  )
}

function contactLines(ctx: Ctx): string[] {
  const { identity } = ctx.data
  return [identity.email, identity.phone, identity.location, identity.details].filter(Boolean)
}

function LinksLine({ ctx, color, align }: { ctx: Ctx; color: string; align: 'left' | 'right' | 'center' }) {
  const links = ctx.data.links.filter((l) => l.url)
  if (links.length === 0) return null
  const { theme } = ctx
  return (
    <Text style={{ fontFamily: theme.metaFont, fontSize: theme.small + 0.3, marginTop: 2, color, textAlign: align }}>
      {links.map((l, i) => (
        <Text key={l.id}>
          {i > 0 ? '  |  ' : ''}
          {l.label ? `${l.label} : ` : ''}
          <Link src={l.url} style={{ color, textDecoration: 'none' }}>
            {displayUrl(l.url)}
          </Link>
        </Text>
      ))}
    </Text>
  )
}

function Photo({ ctx, size }: { ctx: Ctx; size: number }) {
  if (!ctx.photo) return null
  return <Image src={ctx.photo} style={{ width: size, height: size, borderRadius: 3, objectFit: 'cover' }} />
}

/** En-tête avec photo optionnelle à droite (ou au-dessus quand l'en-tête est centré). */
function WithPhoto({ ctx, children, size = 62 }: { ctx: Ctx; children: ReactNode; size?: number }) {
  if (!ctx.photo) return <>{children}</>
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      <View style={{ flex: 1, paddingRight: 14 }}>{children}</View>
      <Photo ctx={ctx} size={size} />
    </View>
  )
}

function DossierOverline({ ctx }: { ctx: Ctx }) {
  if (ctx.settings.template !== 'skills-dossier') return null
  return (
    <Text style={{ fontFamily: ctx.theme.metaFont, fontSize: ctx.theme.small, fontWeight: 600, color: ctx.accent, marginBottom: 4, letterSpacing: 0.4 }}>
      {LABELS[ctx.locale].dossier}
    </Text>
  )
}

function Header(ctx: Ctx) {
  const { theme, accent } = ctx
  const contact = contactLines(ctx)
  const metaStyle = (color: string, align: 'left' | 'right' | 'center' = theme.nameAlign): Style => ({
    fontFamily: theme.metaFont,
    fontSize: theme.small + 0.3,
    marginTop: 7,
    color,
    textAlign: align,
  })
  const nameColor = theme.accentName ? accent : INK

  switch (theme.headerKind) {
    case 'band':
      return (
        <View
          style={{
            backgroundColor: accent,
            marginTop: -theme.padTop,
            marginHorizontal: -theme.padX,
            paddingTop: theme.padTop,
            paddingBottom: 20,
            paddingHorizontal: theme.padX,
            marginBottom: theme.sectionGap + 2,
          }}
        >
          <WithPhoto ctx={ctx}>
            {nameText(ctx, '#ffffff')}
            {headlineText(ctx, ON_BAND)}
            {contact.length > 0 ? <Text style={metaStyle(ON_BAND)}>{contact.join('  |  ')}</Text> : null}
            <LinksLine ctx={ctx} color={ON_BAND} align={theme.nameAlign} />
          </WithPhoto>
        </View>
      )

    case 'bar':
      return (
        <View style={{ marginBottom: theme.sectionGap }}>
          <View style={{ height: 5, backgroundColor: INK, marginBottom: 12 }} />
          <WithPhoto ctx={ctx}>
            {nameText(ctx, INK)}
            {headlineText(ctx, INK)}
            {contact.length > 0 ? <Text style={metaStyle(MUTED)}>{contact.join('  /  ')}</Text> : null}
            <LinksLine ctx={ctx} color={MUTED} align="left" />
          </WithPhoto>
        </View>
      )

    case 'rule':
      return (
        <View style={{ marginBottom: theme.sectionGap, paddingBottom: 10, borderBottomWidth: 2.2, borderBottomColor: theme.monochrome ? INK : accent }}>
          <WithPhoto ctx={ctx} size={66}>
            {nameText(ctx, INK)}
            {headlineText(ctx, theme.monochrome ? INK : accent)}
            {contact.length > 0 ? <Text style={metaStyle(MUTED)}>{contact.join('  ·  ')}</Text> : null}
            <LinksLine ctx={ctx} color={MUTED} align="left" />
          </WithPhoto>
        </View>
      )

    case 'center':
      return (
        <View style={{ marginBottom: theme.sectionGap, alignItems: 'center' }}>
          {ctx.photo ? (
            <View style={{ marginBottom: 8 }}>
              <Photo ctx={ctx} size={58} />
            </View>
          ) : null}
          {nameText(ctx, nameColor, 'center')}
          {headlineText(ctx, INK, 'center')}
          {contact.length > 0 ? <Text style={metaStyle(MUTED, 'center')}>{contact.join('  ·  ')}</Text> : null}
          <LinksLine ctx={ctx} color={MUTED} align="center" />
        </View>
      )

    case 'split':
      return (
        <View style={{ marginBottom: theme.sectionGap, flexDirection: 'row', justifyContent: 'space-between' }}>
          {ctx.photo ? (
            <View style={{ marginRight: 12 }}>
              <Photo ctx={ctx} size={56} />
            </View>
          ) : null}
          <View style={{ flex: 1, paddingRight: 18 }}>
            <DossierOverline ctx={ctx} />
            {nameText(ctx, nameColor)}
            {headlineText(ctx, INK)}
          </View>
          <View style={{ maxWidth: '45%' }}>
            {contact.map((c) => (
              <Text key={c} style={{ fontFamily: theme.metaFont, fontSize: theme.small + 0.3, color: MUTED, textAlign: 'right', marginBottom: 1 }}>
                {c}
              </Text>
            ))}
            {ctx.data.links
              .filter((l) => l.url)
              .map((l) => (
                <Text key={l.id} style={{ fontFamily: theme.metaFont, fontSize: theme.small + 0.3, color: MUTED, textAlign: 'right', marginBottom: 1 }}>
                  {l.label ? `${l.label} : ` : ''}
                  <Link src={l.url} style={{ color: MUTED, textDecoration: 'none' }}>
                    {displayUrl(l.url)}
                  </Link>
                </Text>
              ))}
          </View>
        </View>
      )

    default:
      return (
        <View style={{ marginBottom: theme.sectionGap }}>
          <WithPhoto ctx={ctx}>
            {nameText(ctx, nameColor)}
            {headlineText(ctx, INK)}
            {theme.layout === 'sidebar' ? null : (
              <>
                {contact.length > 0 ? <Text style={metaStyle(MUTED)}>{contact.join('  |  ')}</Text> : null}
                <LinksLine ctx={ctx} color={MUTED} align={theme.nameAlign} />
              </>
            )}
          </WithPhoto>
        </View>
      )
  }
}

// ── Titres de rubrique ──────────────────────────────────────────────

function SectionTitle({ title, ctx }: { title: string; ctx: Ctx }) {
  const { theme, accent } = ctx
  const color = theme.accentTitles && !theme.monochrome ? accent : INK
  const font = theme.titleKind === 'marker' ? theme.metaFont : theme.headingFont
  const text: Style = {
    fontFamily: font,
    fontWeight: weightFor(font, theme.titleKind === 'marker' ? 700 : theme.headingWeight),
    fontSize: theme.sectionTitleSize,
    color,
    textTransform: theme.sectionTitleCase === 'uppercase' ? 'uppercase' : 'none',
    letterSpacing: theme.sectionTitleTracking,
  }

  switch (theme.titleKind) {
    case 'rule':
      return (
        <Text style={{ ...text, paddingBottom: 3, borderBottomWidth: 0.7, borderBottomColor: theme.accentTitles && !theme.monochrome ? accent : RULE, marginBottom: 7 }} minPresenceAhead={70}>
          {title}
        </Text>
      )
    case 'short-rule':
      return (
        <View style={{ marginBottom: 8 }} minPresenceAhead={70}>
          <Text style={{ ...text, color: INK }}>{title}</Text>
          <View style={{ width: 28, height: 2.2, backgroundColor: accent, marginTop: 4 }} />
        </View>
      )
    case 'overline':
      return (
        <View style={{ marginBottom: 7, paddingTop: 5, borderTopWidth: 1.6, borderTopColor: theme.monochrome || !theme.accentTitles ? INK : accent }} minPresenceAhead={70}>
          <Text style={{ ...text, color: INK }}>{title}</Text>
        </View>
      )
    case 'marker':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, borderBottomWidth: 1.2, borderBottomColor: INK, paddingBottom: 4 }} minPresenceAhead={70}>
          <View style={{ width: 7, height: 7, backgroundColor: accent, marginRight: 6 }} />
          <Text style={{ ...text, color: INK }}>{title}</Text>
        </View>
      )
    case 'gutter':
      return <Text style={text}>{title}</Text>
    default:
      return (
        <Text style={{ ...text, marginBottom: theme.sectionTitleCase === 'none' ? 6 : 7 }} minPresenceAhead={70}>
          {title}
        </Text>
      )
  }
}

// ── Corps de rubrique ───────────────────────────────────────────────

function Bullets({ items, theme }: { items: Achievement[]; theme: Theme }) {
  const list = items.map((a) => a.text.trim()).filter(Boolean)
  if (list.length === 0) return null
  return (
    <View style={{ marginTop: 3 }}>
      {list.map((text, i) => (
        <View key={i} style={{ flexDirection: 'row', marginTop: i === 0 ? 0 : 2 }}>
          <Text style={{ width: 11, fontSize: theme.body }}>•</Text>
          <Text style={{ flex: 1, fontSize: theme.body }}>{text}</Text>
        </View>
      ))}
    </View>
  )
}

function Paragraphs({ text, theme, top = 3 }: { text: string; theme: Theme; top?: number }) {
  return (
    <>
      {paragraphs(text).map((p, i) => (
        <Text key={i} style={{ fontSize: theme.body, marginTop: i === 0 ? top : 3 }}>
          {p}
        </Text>
      ))}
    </>
  )
}

function EnvLine({ skills, ctx }: { skills: string[]; ctx: Ctx }) {
  if (!ctx.theme.showEntrySkills || skills.length === 0) return null
  return (
    <Text style={{ fontSize: ctx.theme.small + 0.2, color: MUTED, marginTop: 3 }}>
      <Text style={{ fontWeight: 600, color: INK }}>{LABELS[ctx.locale].env} : </Text>
      {skills.join(', ')}
    </Text>
  )
}

function EntryHeading({ title, sub, period, ctx }: { title: string; sub: string; period: string; ctx: Ctx }) {
  const { theme } = ctx
  // Avec une colonne de dates, la période est déjà affichée à gauche.
  const line = theme.dateColumn ? sub : [sub, period].filter(Boolean).join('  |  ')
  return (
    <>
      {title ? <Text style={{ fontWeight: 600, fontSize: theme.body + 0.7, color: INK }}>{title}</Text> : null}
      {line ? <Text style={{ fontSize: theme.small + 0.3, color: MUTED, marginTop: 1 }}>{line}</Text> : null}
    </>
  )
}

/** Cadre d'une entrée datée : simple, avec frise (Chronologie) ou avec colonne de dates (Grille). */
function Entry({ children, last, wrap, ctx, period }: { children: ReactNode; last: boolean; wrap: boolean; ctx: Ctx; period?: string }) {
  const { theme, accent } = ctx
  if (theme.dateColumn) {
    return (
      <View wrap={wrap} style={{ flexDirection: 'row', marginBottom: last ? 0 : theme.entryGap }}>
        <Text style={{ width: 74, paddingRight: 8, fontSize: theme.small, color: MUTED, paddingTop: 1.5 }}>{period ?? ''}</Text>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    )
  }
  if (!theme.timeline) {
    return (
      <View wrap={wrap} style={{ marginBottom: last ? 0 : theme.entryGap }}>
        {children}
      </View>
    )
  }
  return (
    <View wrap={wrap} style={{ marginLeft: 3, paddingLeft: 13, paddingBottom: last ? 0 : theme.entryGap, borderLeftWidth: last ? 0 : 1, borderLeftColor: accent }}>
      <View style={{ position: 'absolute', left: last ? -3.5 : -4, top: 2, width: 7, height: 7, borderRadius: 3.5, backgroundColor: accent }} />
      {children}
    </View>
  )
}

function SkillsMatrix({ ctx }: { ctx: Ctx }) {
  const { theme, locale } = ctx
  // Seules les compétences rattachées à des périodes réelles ont une durée ; les autres restent
  // dans les lignes « catégorie : liste » affichées sous la matrice.
  const rows = skillsMatrix(ctx.data, new Date())
    .filter((r) => r.months > 0)
    .slice(0, 20)
  if (rows.length === 0) return null
  const L = LABELS[locale]
  const cell: Style = { fontSize: theme.small + 0.3 }
  return (
    <View style={{ marginBottom: 6 }}>
      <View style={{ flexDirection: 'row', borderBottomWidth: 0.7, borderBottomColor: RULE, paddingBottom: 2, marginBottom: 2 }}>
        <Text style={{ ...cell, flex: 1, fontWeight: 600 }}>{L.skill}</Text>
        <Text style={{ ...cell, width: 90, fontWeight: 600 }}>{L.experience}</Text>
        <Text style={{ ...cell, width: 90, fontWeight: 600, textAlign: 'right' }}>{L.lastUsed}</Text>
      </View>
      {rows.map((r) => (
        <View key={r.skill} style={{ flexDirection: 'row', paddingVertical: 1.2 }} wrap={false}>
          <Text style={{ ...cell, flex: 1, color: INK }}>{r.skill}</Text>
          <Text style={{ ...cell, width: 90, color: MUTED }}>{formatDuration(r.months, locale)}</Text>
          <Text style={{ ...cell, width: 90, color: MUTED, textAlign: 'right' }}>{r.current ? (locale === 'en' ? 'Current' : 'Actuelle') : String(r.lastYear ?? '')}</Text>
        </View>
      ))}
    </View>
  )
}

function SectionBody({ section, ctx }: { section: PlannedSection; ctx: Ctx }) {
  const { data, theme, locale } = ctx
  const keepOf = (id: string) => section.entries.find((e) => e.id === id)?.keepTogether ?? false
  const lastId = section.entries[section.entries.length - 1]?.id
  const inPlan = (id: string) => section.entries.some((s) => s.id === id)
  const date = (v: string) => formatMonth(v, locale)

  if (section.key === 'custom') {
    const custom = data.customSections.find((c) => c.id === section.customId)
    if (!custom) return null
    return (
      <View>
        {custom.entries
          .filter((e) => inPlan(e.id))
          .map((e) => (
            <Entry key={e.id} wrap={!keepOf(e.id)} last={e.id === lastId} ctx={ctx} period={date(e.date)}>
              <EntryHeading title={e.title} sub={e.subtitle} period={date(e.date)} ctx={ctx} />
              <Paragraphs text={e.description} theme={theme} />
            </Entry>
          ))}
      </View>
    )
  }

  switch (section.key) {
    case 'summary':
      if (theme.emphasizeSummary) {
        return (
          <View style={{ borderLeftWidth: 2.2, borderLeftColor: ctx.accent, paddingLeft: 10 }}>
            {paragraphs(data.summary).map((p, i) => (
              <Text key={i} style={{ fontSize: theme.body + 0.8, marginTop: i === 0 ? 0 : 3 }}>
                {p}
              </Text>
            ))}
          </View>
        )
      }
      return (
        <View>
          <Paragraphs text={data.summary} theme={theme} top={0} />
        </View>
      )

    case 'experiences':
      return (
        <View>
          {data.experiences
            .filter((e) => inPlan(e.id))
            .map((e) => {
              const place = [e.company, e.location].filter(Boolean).join(', ')
              const period = formatPeriod(e.startDate, e.endDate, e.current, locale)
              const sub = [place, e.parallel ? LABELS[locale].parallel : ''].filter(Boolean).join('  ·  ')
              return (
                <Entry key={e.id} wrap={!keepOf(e.id)} last={e.id === lastId} ctx={ctx} period={period}>
                  <EntryHeading title={e.title} sub={sub} period={period} ctx={ctx} />
                  <Paragraphs text={e.description} theme={theme} />
                  <Bullets items={e.achievements} theme={theme} />
                  <EnvLine skills={e.skills} ctx={ctx} />
                  {e.missions
                    .filter((m) => m.client.trim() || m.role.trim() || m.description.trim())
                    .map((m) => {
                      const mPeriod = formatPeriod(m.startDate, m.endDate, false, locale)
                      return (
                        <View key={m.id} style={{ marginTop: 5, paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: '#c9c9c9' }} wrap={!ctx.settings.keepEntriesTogether}>
                          <Text style={{ fontSize: theme.body, color: INK }}>
                            <Text style={{ fontWeight: 600 }}>{[m.client, m.role].filter(Boolean).join(' — ')}</Text>
                            {[m.location, mPeriod].filter(Boolean).length ? <Text style={{ color: MUTED, fontSize: theme.small + 0.3 }}>{`  |  ${[m.location, mPeriod].filter(Boolean).join('  |  ')}`}</Text> : null}
                          </Text>
                          <Paragraphs text={m.description} theme={theme} top={2} />
                          <Bullets items={m.achievements} theme={theme} />
                          <EnvLine skills={m.skills} ctx={ctx} />
                        </View>
                      )
                    })}
                </Entry>
              )
            })}
        </View>
      )

    case 'skills': {
      const groups = data.skills.filter((s) => inPlan(s.id))
      const lines = groups.map((s) => (
        <Text key={s.id} style={{ fontSize: theme.body, marginBottom: s.id === lastId ? 0 : 3 }}>
          {s.category ? <Text style={{ fontWeight: 600 }}>{s.category} : </Text> : null}
          {s.items.join(', ')}
        </Text>
      ))
      if (theme.skillsKind === 'matrix') {
        return (
          <View>
            <SkillsMatrix ctx={ctx} />
            {lines}
          </View>
        )
      }
      return <View>{lines}</View>
    }

    case 'education':
      return (
        <View>
          {data.education
            .filter((e) => inPlan(e.id))
            .map((e) => {
              const place = [e.school, e.location].filter(Boolean).join(', ')
              const period = formatPeriod(e.startDate, e.endDate, false, locale)
              return (
                <Entry key={e.id} wrap={!keepOf(e.id)} last={e.id === lastId} ctx={ctx} period={period}>
                  <EntryHeading title={e.degree} sub={place} period={period} ctx={ctx} />
                  <Paragraphs text={e.description} theme={theme} />
                </Entry>
              )
            })}
        </View>
      )

    case 'certifications':
      return (
        <View>
          {data.certifications
            .filter((c) => inPlan(c.id))
            .map((c) => {
              const meta = [c.issuer, date(c.date)].filter(Boolean).join(', ')
              return (
                <Text key={c.id} style={{ fontSize: theme.body, marginBottom: c.id === lastId ? 0 : 3 }}>
                  <Text style={{ fontWeight: 600 }}>{c.name}</Text>
                  {meta ? `  |  ${meta}` : ''}
                </Text>
              )
            })}
        </View>
      )

    case 'languages':
      return (
        <Text style={{ fontSize: theme.body }}>
          {data.languages
            .filter((l) => l.name.trim())
            .map((l, i) => (
              <Text key={l.id}>
                {i > 0 ? '  |  ' : ''}
                <Text style={{ fontWeight: 600 }}>{l.name}</Text>
                {l.level ? ` (${l.level})` : ''}
              </Text>
            ))}
        </Text>
      )

    case 'projects':
      return (
        <View>
          {data.projects
            .filter((p) => inPlan(p.id))
            .map((p) => {
              const period = formatPeriod(p.startDate, p.endDate, false, locale)
              return (
                <Entry key={p.id} wrap={!keepOf(p.id)} last={p.id === lastId} ctx={ctx} period={period}>
                  <EntryHeading title={p.name} sub={p.role} period={period} ctx={ctx} />
                  {p.url ? (
                    <Link src={p.url} style={{ fontSize: theme.small + 0.3, color: MUTED, textDecoration: 'none', marginTop: 1 }}>
                      {displayUrl(p.url)}
                    </Link>
                  ) : null}
                  <Paragraphs text={p.description} theme={theme} />
                  {p.skills.length ? (
                    <Text style={{ fontSize: theme.small + 0.2, color: MUTED, marginTop: 3 }}>
                      <Text style={{ fontWeight: 600, color: INK }}>{LABELS[locale].env} : </Text>
                      {p.skills.join(', ')}
                    </Text>
                  ) : null}
                </Entry>
              )
            })}
        </View>
      )

    case 'awards':
      return (
        <View>
          {data.awards
            .filter((a) => inPlan(a.id))
            .map((a) => (
              <Entry key={a.id} wrap={false} last={a.id === lastId} ctx={ctx} period={date(a.date)}>
                <EntryHeading title={a.title} sub={a.issuer} period={date(a.date)} ctx={ctx} />
                <Paragraphs text={a.description} theme={theme} />
              </Entry>
            ))}
        </View>
      )

    case 'publications':
      return (
        <View>
          {data.publications
            .filter((p) => inPlan(p.id))
            .map((p) => {
              const sub = [LABELS[locale].kinds[p.kind], p.outlet].filter(Boolean).join(', ')
              return (
                <Entry key={p.id} wrap={false} last={p.id === lastId} ctx={ctx} period={date(p.date)}>
                  <EntryHeading title={p.title} sub={sub} period={date(p.date)} ctx={ctx} />
                  {p.url ? (
                    <Link src={p.url} style={{ fontSize: theme.small + 0.3, color: MUTED, textDecoration: 'none', marginTop: 1 }}>
                      {displayUrl(p.url)}
                    </Link>
                  ) : null}
                  <Paragraphs text={p.description} theme={theme} />
                </Entry>
              )
            })}
        </View>
      )

    case 'interests':
      return (
        <Text style={{ fontSize: theme.body }}>
          {data.interests
            .map((x) => x.text.trim())
            .filter(Boolean)
            .join('  ·  ')}
        </Text>
      )
  }
}

/** Rubriques placées dans la barre latérale (modèle « Barre latérale »). */
const SIDEBAR_KEYS = new Set(['skills', 'languages', 'certifications', 'interests'])

function SidebarContact({ ctx }: { ctx: Ctx }) {
  const { theme } = ctx
  const contact = contactLines(ctx)
  const links = ctx.data.links.filter((l) => l.url)
  if (contact.length === 0 && links.length === 0 && !ctx.photo) return null
  return (
    <View style={{ marginBottom: theme.sectionGap }}>
      {ctx.photo ? (
        <View style={{ marginBottom: 10 }}>
          <Photo ctx={ctx} size={78} />
        </View>
      ) : null}
      <SectionTitle title={LABELS[ctx.locale].contact} ctx={ctx} />
      {contact.map((c) => (
        <Text key={c} style={{ fontSize: theme.small + 0.3, marginBottom: 2 }}>
          {c}
        </Text>
      ))}
      {links.map((l) => (
        <Text key={l.id} style={{ fontSize: theme.small + 0.3, marginBottom: 2 }}>
          {l.label ? `${l.label} : ` : ''}
          <Link src={l.url} style={{ color: INK, textDecoration: 'none' }}>
            {displayUrl(l.url)}
          </Link>
        </Text>
      ))}
    </View>
  )
}

function Sections({ plan, ctx }: { plan: PlannedSection[]; ctx: Ctx }) {
  const { theme } = ctx
  return (
    <>
      {plan.map((section, i) => {
        const marginBottom = i === plan.length - 1 ? 0 : theme.sectionGap
        const body = <SectionBody section={section} ctx={ctx} />
        if (theme.layout === 'gutter') {
          return (
            <View key={section.id} break={section.breakBefore} style={{ marginBottom, flexDirection: 'row' }}>
              <View style={{ width: theme.gutterWidth, paddingRight: 8, paddingTop: 1 }}>
                <SectionTitle title={section.title} ctx={ctx} />
              </View>
              <View style={{ flex: 1 }}>{body}</View>
            </View>
          )
        }
        return (
          <View key={section.id} break={section.breakBefore} style={{ marginBottom }}>
            <SectionTitle title={section.title} ctx={ctx} />
            {body}
          </View>
        )
      })}
    </>
  )
}

export interface CvDocumentProps {
  data: ProfileData
  settings: CvSettings
  /** Titre des métadonnées du PDF (affiché par les lecteurs et lu par certains ATS). */
  title?: string | undefined
  /** Échelle typographique (ajustement automatique au nombre de pages), 1 par défaut. */
  scale?: number
}

/**
 * Document PDF d'un CV : texte réel, aucun tableau ni icône, ordre de lecture = ordre visuel.
 * Les modèles diffèrent par leur thème (voir themes.ts) ; « Marge » place les titres dans une
 * colonne latérale et « Barre latérale » met contact et compétences dans une colonne teintée.
 */
export function CvDocument({ data: raw, settings, title, scale = 1 }: CvDocumentProps) {
  const data = settings.anonymize ? anonymizeProfile(raw) : raw
  const theme = themeFor(settings, scale)
  const locale = settings.locale ?? 'fr'
  const contentWidth = PAGE_WIDTH - theme.padX * 2
  const columnRatio =
    theme.layout === 'gutter' ? (contentWidth - theme.gutterWidth) / contentWidth : theme.layout === 'sidebar' ? (contentWidth - theme.sidebarWidth - 18) / contentWidth : 1
  const plan = planSections(data, settings, columnRatio)
  const name = fullName(data)
  const accent = theme.monochrome ? INK : settings.accent
  const photo = settings.showPhoto && !settings.anonymize && data.identity.photo ? data.identity.photo : null
  const ctx: Ctx = { data, settings, theme, locale, accent, photo }
  const docTitle = settings.anonymize ? LABELS[locale].dossier : (title ?? (name ? `CV ${name}` : 'CV'))

  const page: Style = {
    fontFamily: theme.bodyFont,
    fontSize: theme.body,
    lineHeight: theme.lineHeight,
    color: INK,
    paddingTop: theme.padTop,
    paddingBottom: theme.padBottom,
    paddingHorizontal: theme.padX,
  }

  if (theme.layout === 'sidebar') {
    const side = plan.filter((s) => SIDEBAR_KEYS.has(s.key))
    const main = plan.filter((s) => !SIDEBAR_KEYS.has(s.key))
    const sideBg = tint(settings.accent, 0.9)
    return (
      <Document title={docTitle} author={settings.anonymize ? undefined : name || undefined} creator="Cuvylo" producer="Cuvylo" language={locale === 'en' ? 'en-US' : 'fr-FR'}>
        <Page size="A4" style={{ ...page, paddingLeft: theme.sidebarWidth + 24, paddingRight: theme.padX }}>
          {/* Fond de la barre latérale, répété sur chaque page. */}
          <View fixed style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: theme.sidebarWidth, backgroundColor: sideBg }} />
          <Header {...ctx} />
          <View fixed={false} style={{ position: 'absolute', top: theme.padTop, left: 18, width: theme.sidebarWidth - 30 }}>
            <SidebarContact ctx={ctx} />
            <Sections plan={side.map((s) => ({ ...s, breakBefore: false }))} ctx={ctx} />
          </View>
          <Sections plan={main} ctx={ctx} />
        </Page>
      </Document>
    )
  }

  return (
    <Document title={docTitle} author={settings.anonymize ? undefined : name || undefined} creator="Cuvylo" producer="Cuvylo" language={locale === 'en' ? 'en-US' : 'fr-FR'}>
      <Page size="A4" style={page}>
        <Header {...ctx} />
        <Sections plan={plan} ctx={ctx} />
      </Page>
    </Document>
  )
}
