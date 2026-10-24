import { createContext, useContext, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { formatPeriod } from '@/domain/dates'
import {
  PUBLICATION_KINDS,
  PUBLICATION_KIND_LABELS,
  SECTION_LABELS,
  addCustomSection,
  moveItem,
  newAward,
  newCertification,
  newCustomEntry,
  newEducation,
  newExperience,
  newId,
  newInterest,
  newLanguage,
  newLink,
  newMission,
  newProject,
  newPublication,
  newSkillGroup,
  removeCustomSection,
  sectionId,
  type Achievement,
  type CustomSection,
  type ProfileData,
  type SectionRef,
} from '@/domain/profile'
import type { Issue } from '@/hooks/useAutosave'
import { photoToDataUrl } from '@/lib/photo'
import { DateField, Disclosure, SelectField, Switch, TagsField, TextArea, TextField } from '@/ui/fields'
import { IconDown, IconEye, IconEyeOff, IconPlus, IconTrash, IconUp, IconUpload } from '@/ui/Icons'

interface Props {
  value: ProfileData
  onChange: (next: ProfileData) => void
  /** Problèmes de validation à afficher sous les champs concernés. */
  issues?: Issue[]
}

// ── Erreurs par champ ────────────────────────────────────────────────────────

const IssuesCtx = createContext<Map<string, string>>(new Map())
const useIssue = (path: string) => useContext(IssuesCtx).get(path)

/** Préfixe de chemin (« experiences.2 ») pour les champs d'un élément de liste. */
const PathCtx = createContext('')
function useField(name: string) {
  const prefix = useContext(PathCtx)
  return useIssue(prefix ? `${prefix}.${name}` : name)
}

/** Adresse web : `https://` ajouté à la sortie du champ s'il manque (« linkedin.com/in/… »). */
function UrlField({ label, value, onChange, name = 'url', placeholder = 'https://' }: { label: string; value: string; onChange: (v: string) => void; name?: string; placeholder?: string }) {
  const error = useField(name)
  return (
    <TextField
      label={label}
      type="url"
      inputMode="url"
      value={value}
      onChange={onChange}
      onBlur={() => {
        const v = value.trim()
        if (v && !/^https?:\/\//i.test(v) && /^[\w-]+(\.[\w-]+)+/.test(v)) onChange(`https://${v}`)
      }}
      maxLength={500}
      placeholder={placeholder}
      error={error}
    />
  )
}

function Text({ name, ...props }: Omit<Parameters<typeof TextField>[0], 'error'> & { name: string }) {
  return <TextField {...props} error={useField(name)} />
}
function Area({ name, ...props }: Omit<Parameters<typeof TextArea>[0], 'error'> & { name: string }) {
  return <TextArea {...props} error={useField(name)} />
}
function DateIn({ name, ...props }: Omit<Parameters<typeof DateField>[0], 'error'> & { name: string }) {
  return <DateField {...props} error={useField(name)} />
}

// ── Briques ──────────────────────────────────────────────────────────────────

function IconButton({ label, onClick, disabled, danger, children }: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button type="button" className={`btn btn-ghost btn-icon ${danger ? 'btn-danger' : ''}`} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

interface RepeaterProps<T extends { id: string }> {
  items: T[]
  onChange: (items: T[]) => void
  create: () => T
  noun: string
  addLabel: string
  /** Chemin des données (« experiences ») : sert à rattacher les erreurs aux champs. */
  path: string
  summary: (item: T) => { title: string; meta?: string }
  render: (item: T, patch: (p: Partial<T>) => void, index: number) => ReactNode
  max?: number
}

/** Liste d'éléments repliables, réordonnables au clavier (boutons monter/descendre). */
function Repeater<T extends { id: string }>({ items, onChange, create, noun, addLabel, path, summary, render, max = 50 }: RepeaterProps<T>) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const errors = useContext(IssuesCtx)
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div>
      {items.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-line rounded-md border border-line p-0">
          {items.map((item, i) => {
            const s = summary(item)
            const itemPath = `${path}.${i}`
            const hasError = [...errors.keys()].some((k) => k.startsWith(`${itemPath}.`))
            return (
              <li key={item.id} className="px-3 py-1">
                <Disclosure
                  title={s.title || 'Nouvel élément'}
                  meta={hasError ? <span className="text-danger">À corriger</span> : s.meta}
                  open={open.has(item.id) || hasError}
                  onToggle={() => toggle(item.id)}
                  actions={
                    <>
                      <IconButton label={`Monter ${noun} ${i + 1}`} disabled={i === 0} onClick={() => onChange(moveItem(items, i, i - 1))}>
                        <IconUp />
                      </IconButton>
                      <IconButton label={`Descendre ${noun} ${i + 1}`} disabled={i === items.length - 1} onClick={() => onChange(moveItem(items, i, i + 1))}>
                        <IconDown />
                      </IconButton>
                      <IconButton danger label={`Supprimer ${noun} ${i + 1}`} onClick={() => onChange(items.filter((x) => x.id !== item.id))}>
                        <IconTrash />
                      </IconButton>
                    </>
                  }
                >
                  <PathCtx.Provider value={itemPath}>
                    <div className="grid gap-3 pb-4 pl-6 pt-2">{render(item, (p) => onChange(items.map((x) => (x.id === item.id ? { ...x, ...p } : x))), i)}</div>
                  </PathCtx.Provider>
                </Disclosure>
              </li>
            )
          })}
        </ul>
      ) : null}
      <button
        type="button"
        className="btn btn-sm mt-3"
        disabled={items.length >= max}
        onClick={() => {
          const created = create()
          onChange([...items, created])
          setOpen((s) => new Set(s).add(created.id))
        }}
      >
        <IconPlus /> {addLabel}
      </button>
    </div>
  )
}

function SectionCard({ title, description, children, controls, hidden, id }: {
  title: ReactNode
  description?: string
  children: ReactNode
  controls?: ReactNode
  hidden?: boolean
  id?: string
}) {
  const [open, setOpen] = useState(!hidden)
  return (
    <section id={id} className={`card px-4 py-2 sm:px-5 ${hidden ? 'bg-sunken' : ''}`} aria-label={typeof title === 'string' ? title : undefined}>
      <Disclosure
        level={2}
        title={<span className="text-[1.05rem] font-semibold text-ink">{title}</span>}
        meta={hidden ? 'Masquée sur le CV' : undefined}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        actions={controls}
      >
        <div className="pb-4 pt-1">
          {description ? <p className="mb-3 text-sm text-muted">{description}</p> : null}
          {children}
        </div>
      </Disclosure>
    </section>
  )
}

function AchievementList({ items, set, hint }: { items: Achievement[]; set: (next: Achievement[]) => void; hint?: string }) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="label">Réalisations et résultats</legend>
      <p className="-mt-1 mb-2 text-sm text-faint">{hint ?? 'Un verbe d’action, un résultat ; chiffrez quand c’est vrai (délais, volumes, budgets).'}</p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {items.map((a, i) => (
          <li key={a.id} className="flex items-start gap-1">
            <textarea
              className="input min-h-[2.4rem] flex-1"
              rows={2}
              lang="fr"
              spellCheck
              aria-label={`Réalisation ${i + 1}`}
              value={a.text}
              maxLength={4000}
              onChange={(e) => set(items.map((x) => (x.id === a.id ? { ...x, text: e.target.value } : x)))}
            />
            <div className="flex flex-col">
              <IconButton label={`Monter la réalisation ${i + 1}`} disabled={i === 0} onClick={() => set(moveItem(items, i, i - 1))}>
                <IconUp />
              </IconButton>
              <IconButton label={`Descendre la réalisation ${i + 1}`} disabled={i === items.length - 1} onClick={() => set(moveItem(items, i, i + 1))}>
                <IconDown />
              </IconButton>
            </div>
            <IconButton danger label={`Supprimer la réalisation ${i + 1}`} onClick={() => set(items.filter((x) => x.id !== a.id))}>
              <IconTrash />
            </IconButton>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-sm mt-2" disabled={items.length >= 30} onClick={() => set([...items, { id: newId(), text: '' }])}>
        <IconPlus /> Ajouter une réalisation
      </button>
    </fieldset>
  )
}

function PhotoField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      onChange(await photoToDataUrl(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image illisible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="label">Photo (facultative)</p>
      <div className="flex items-center gap-4">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-sunken text-xs text-faint">
          {value ? <img src={value} alt="Votre portrait" className="size-full object-cover" /> : 'Aucune'}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
            <IconUpload /> {value ? 'Remplacer' : 'Choisir une image'}
          </button>
          {value ? (
            <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => onChange('')}>
              Retirer
            </button>
          ) : null}
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Image de profil" onChange={(e) => void onFile(e)} />
        </div>
      </div>
      <p className={`mt-1 text-sm ${error ? 'text-danger' : 'text-faint'}`} role={error ? 'alert' : undefined}>
        {error ?? 'Recadrée au carré, métadonnées supprimées. Affichée seulement si vous l’activez dans les réglages d’un CV ; en France, elle n’est pas attendue.'}
      </p>
    </div>
  )
}

// ── Formulaire ───────────────────────────────────────────────────────────────

/**
 * Formulaire complet d'un profil / CV. Les rubriques apparaissent dans l'ordre
 * de `value.sections`, qui est aussi l'ordre du PDF : réordonner ici réordonne le CV.
 */
export function ProfileForm({ value, onChange, issues = [] }: Props) {
  const errorMap = useMemo(() => new Map(issues.map((i) => [i.path, i.message])), [issues])
  const set = <K extends keyof ProfileData>(key: K, v: ProfileData[K]) => onChange({ ...value, [key]: v })
  const setIdentity = (p: Partial<ProfileData['identity']>) => set('identity', { ...value.identity, ...p })

  const moveSection = (from: number, to: number) => set('sections', moveItem(value.sections, from, to))
  const toggleSection = (ref: SectionRef) =>
    set(
      'sections',
      value.sections.map((s) => (sectionId(s) === sectionId(ref) ? { ...s, visible: !s.visible } : s)),
    )
  const patchCustom = (id: string, p: Partial<CustomSection>) =>
    set('customSections', value.customSections.map((c) => (c.id === id ? { ...c, ...p } : c)))

  const fixedBody = {
    summary: (
      <PathCtx.Provider value="">
        <Area name="summary" label="Résumé de profil" hint="3 à 4 phrases : votre métier, ce que vous apportez, un résultat marquant." rows={5} maxLength={4000} value={value.summary} onChange={(v) => set('summary', v)} />
      </PathCtx.Provider>
    ),
    experiences: (
      <Repeater
        path="experiences"
        items={value.experiences}
        onChange={(v) => set('experiences', v)}
        create={newExperience}
        noun="l’expérience"
        addLabel="Ajouter une expérience"
        summary={(e) => ({
          title: [e.title, e.company].filter(Boolean).join(' · '),
          meta: [formatPeriod(e.startDate, e.endDate, e.current), e.parallel ? 'en parallèle' : '', e.missions.length ? `${e.missions.length} mission${e.missions.length > 1 ? 's' : ''}` : '']
            .filter(Boolean)
            .join(' · '),
        })}
        render={(e, patch, i) => (
          <>
            <Text name="title" label="Intitulé du poste" value={e.title} onChange={(v) => patch({ title: v })} maxLength={200} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Text name="company" label="Entreprise" value={e.company} onChange={(v) => patch({ company: v })} maxLength={200} />
              <Text name="location" label="Lieu" value={e.location} onChange={(v) => patch({ location: v })} maxLength={200} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <DateIn name="startDate" label="Début" value={e.startDate} onChange={(v) => patch({ startDate: v })} />
              <DateIn name="endDate" label="Fin" value={e.endDate ?? ''} disabled={e.current} onChange={(v) => patch({ endDate: v })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Switch label="Poste actuel" checked={e.current} onChange={(c) => patch(c ? { current: true, endDate: '' } : { current: false })} />
              <Switch
                label="Activité en parallèle"
                description="Freelance, bénévolat, enseignement… menés en même temps qu’un autre poste."
                checked={e.parallel}
                onChange={(c) => patch({ parallel: c })}
              />
            </div>
            <Area name="description" label="Description du poste" rows={3} maxLength={4000} value={e.description} onChange={(v) => patch({ description: v })} />
            <AchievementList items={e.achievements} set={(a) => patch({ achievements: a })} />
            <TagsField label="Compétences mobilisées" hint="Séparées par des virgules. Servent au dossier de compétences et à la comparaison avec une offre." items={e.skills} onChange={(v) => patch({ skills: v })} />
            <fieldset className="m-0 min-w-0 rounded-md border border-line p-3">
              <legend className="px-1 text-[0.93rem] font-semibold text-ink">Missions clients</legend>
              <p className="mb-2 text-sm text-muted">Pour le conseil, les ESN ou le freelance : chaque mission devient un sous-bloc sous l’employeur.</p>
              <Repeater
                path={`experiences.${i}.missions`}
                items={e.missions}
                onChange={(m) => patch({ missions: m })}
                create={newMission}
                noun="la mission"
                addLabel="Ajouter une mission"
                max={30}
                summary={(m) => ({ title: [m.client, m.role].filter(Boolean).join(' · '), meta: formatPeriod(m.startDate, m.endDate, m.endDate === null) })}
                render={(m, pm) => (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Text name="client" label="Client" value={m.client} onChange={(v) => pm({ client: v })} maxLength={200} />
                      <Text name="role" label="Rôle" value={m.role} onChange={(v) => pm({ role: v })} maxLength={200} />
                    </div>
                    <Text name="location" label="Lieu" value={m.location} onChange={(v) => pm({ location: v })} maxLength={200} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <DateIn name="startDate" label="Début" value={m.startDate} onChange={(v) => pm({ startDate: v })} />
                      <DateIn name="endDate" label="Fin" value={m.endDate ?? ''} disabled={m.endDate === null} onChange={(v) => pm({ endDate: v })} />
                    </div>
                    <Switch label="Mission en cours" checked={m.endDate === null} onChange={(c) => pm({ endDate: c ? null : '' })} />
                    <Area name="description" label="Contexte et objectifs" rows={2} maxLength={4000} value={m.description} onChange={(v) => pm({ description: v })} />
                    <AchievementList items={m.achievements} set={(a) => pm({ achievements: a })} />
                    <TagsField label="Environnement technique" hint="Séparé par des virgules." items={m.skills} onChange={(v) => pm({ skills: v })} />
                  </>
                )}
              />
            </fieldset>
          </>
        )}
      />
    ),
    skills: (
      <Repeater
        path="skills"
        items={value.skills}
        onChange={(v) => set('skills', v)}
        create={newSkillGroup}
        noun="le groupe de compétences"
        addLabel="Ajouter un groupe"
        summary={(s) => ({ title: s.category, meta: s.items.length ? `${s.items.length} compétence${s.items.length > 1 ? 's' : ''}` : '' })}
        render={(s, patch) => (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
              <Text name="category" label="Catégorie" value={s.category} onChange={(v) => patch({ category: v })} maxLength={200} />
              <SelectField
                label="Type"
                value={s.kind}
                onChange={(v) => patch({ kind: v })}
                options={[
                  { value: 'technical', label: 'Technique' },
                  { value: 'soft', label: 'Comportementale' },
                ]}
              />
            </div>
            <TagsField label="Compétences" hint="Séparées par des virgules." items={s.items} onChange={(v) => patch({ items: v })} />
          </>
        )}
      />
    ),
    education: (
      <Repeater
        path="education"
        items={value.education}
        onChange={(v) => set('education', v)}
        create={newEducation}
        noun="la formation"
        addLabel="Ajouter une formation"
        summary={(e) => ({ title: [e.degree, e.school].filter(Boolean).join(' · '), meta: formatPeriod(e.startDate, e.endDate, false) })}
        render={(e, patch) => (
          <>
            <Text name="degree" label="Diplôme" value={e.degree} onChange={(v) => patch({ degree: v })} maxLength={200} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Text name="school" label="Établissement" value={e.school} onChange={(v) => patch({ school: v })} maxLength={200} />
              <Text name="location" label="Lieu" value={e.location} onChange={(v) => patch({ location: v })} maxLength={200} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <DateIn name="startDate" label="Début" value={e.startDate} onChange={(v) => patch({ startDate: v })} />
              <DateIn name="endDate" label="Fin" value={e.endDate} onChange={(v) => patch({ endDate: v })} />
            </div>
            <Area name="description" label="Détails (facultatif)" rows={2} maxLength={4000} value={e.description} onChange={(v) => patch({ description: v })} />
          </>
        )}
      />
    ),
    certifications: (
      <Repeater
        path="certifications"
        items={value.certifications}
        onChange={(v) => set('certifications', v)}
        create={newCertification}
        noun="la certification"
        addLabel="Ajouter une certification"
        summary={(c) => ({ title: c.name, meta: c.issuer })}
        render={(c, patch) => (
          <>
            <Text name="name" label="Intitulé" value={c.name} onChange={(v) => patch({ name: v })} maxLength={200} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Text name="issuer" label="Organisme" value={c.issuer} onChange={(v) => patch({ issuer: v })} maxLength={200} />
              <DateIn name="date" label="Obtenue en" value={c.date} onChange={(v) => patch({ date: v })} />
            </div>
            <UrlField label="Lien de vérification (facultatif)" value={c.url} onChange={(v) => patch({ url: v })} />
          </>
        )}
      />
    ),
    languages: (
      <Repeater
        path="languages"
        items={value.languages}
        onChange={(v) => set('languages', v)}
        create={newLanguage}
        noun="la langue"
        addLabel="Ajouter une langue"
        summary={(l) => ({ title: l.name, meta: l.level })}
        render={(l, patch) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Text name="name" label="Langue" value={l.name} onChange={(v) => patch({ name: v })} maxLength={200} />
            <Text name="level" label="Niveau" value={l.level} onChange={(v) => patch({ level: v })} maxLength={200} placeholder="Courant (C1)" />
          </div>
        )}
      />
    ),
    projects: (
      <Repeater
        path="projects"
        items={value.projects}
        onChange={(v) => set('projects', v)}
        create={newProject}
        noun="le projet"
        addLabel="Ajouter un projet"
        summary={(p) => ({ title: p.name, meta: [p.role, formatPeriod(p.startDate, p.endDate, false)].filter(Boolean).join(' · ') })}
        render={(p, patch) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Text name="name" label="Nom du projet" value={p.name} onChange={(v) => patch({ name: v })} maxLength={200} />
              <Text name="role" label="Votre rôle" value={p.role} onChange={(v) => patch({ role: v })} maxLength={200} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <DateIn name="startDate" label="Début" value={p.startDate} onChange={(v) => patch({ startDate: v })} />
              <DateIn name="endDate" label="Fin" value={p.endDate} onChange={(v) => patch({ endDate: v })} />
            </div>
            <UrlField label="Lien (facultatif)" value={p.url} onChange={(v) => patch({ url: v })} />
            <Area name="description" label="Description" rows={3} maxLength={4000} value={p.description} onChange={(v) => patch({ description: v })} />
            <TagsField label="Technologies et compétences" hint="Séparées par des virgules." items={p.skills} onChange={(v) => patch({ skills: v })} />
          </>
        )}
      />
    ),
    awards: (
      <Repeater
        path="awards"
        items={value.awards}
        onChange={(v) => set('awards', v)}
        create={newAward}
        noun="la distinction"
        addLabel="Ajouter une distinction"
        summary={(a) => ({ title: a.title, meta: [a.issuer, a.date].filter(Boolean).join(' · ') })}
        render={(a, patch) => (
          <>
            <Text name="title" label="Intitulé" value={a.title} onChange={(v) => patch({ title: v })} maxLength={200} placeholder="Prix de l’innovation" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Text name="issuer" label="Décerné par" value={a.issuer} onChange={(v) => patch({ issuer: v })} maxLength={200} />
              <DateIn name="date" label="Date" value={a.date} onChange={(v) => patch({ date: v })} />
            </div>
            <Area name="description" label="Précisions (facultatif)" rows={2} maxLength={4000} value={a.description} onChange={(v) => patch({ description: v })} />
          </>
        )}
      />
    ),
    publications: (
      <Repeater
        path="publications"
        items={value.publications}
        onChange={(v) => set('publications', v)}
        create={newPublication}
        noun="la publication"
        addLabel="Ajouter une publication ou intervention"
        summary={(p) => ({ title: p.title, meta: [PUBLICATION_KIND_LABELS[p.kind], p.outlet].filter(Boolean).join(' · ') })}
        render={(p, patch) => (
          <>
            <Text name="title" label="Titre" value={p.title} onChange={(v) => patch({ title: v })} maxLength={200} />
            <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
              <Text name="outlet" label="Média, éditeur ou événement" value={p.outlet} onChange={(v) => patch({ outlet: v })} maxLength={200} />
              <SelectField label="Type" value={p.kind} onChange={(v) => patch({ kind: v })} options={PUBLICATION_KINDS.map((k) => ({ value: k, label: PUBLICATION_KIND_LABELS[k] }))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <DateIn name="date" label="Date" value={p.date} onChange={(v) => patch({ date: v })} />
              <UrlField label="Lien (facultatif)" value={p.url} onChange={(v) => patch({ url: v })} />
            </div>
            <Area name="description" label="Résumé (facultatif)" rows={2} maxLength={4000} value={p.description} onChange={(v) => patch({ description: v })} />
          </>
        )}
      />
    ),
    interests: (
      <Repeater
        path="interests"
        items={value.interests}
        onChange={(v) => set('interests', v)}
        create={newInterest}
        noun="le centre d’intérêt"
        addLabel="Ajouter un centre d’intérêt"
        max={30}
        summary={(x) => ({ title: x.text })}
        render={(x, patch) => (
          <Text name="text" label="Centre d’intérêt" hint="Concret et vérifiable : « Trail — 3 ultras terminés » plutôt que « Sport »." value={x.text} onChange={(v) => patch({ text: v })} maxLength={200} />
        )}
      />
    ),
  } satisfies Record<Exclude<SectionRef['key'], 'custom'>, ReactNode>

  function customBody(c: CustomSection, index: number) {
    return (
      <PathCtx.Provider value={`customSections.${index}`}>
        <div className="grid gap-3">
          <Text name="title" label="Titre de la rubrique" value={c.title} onChange={(v) => patchCustom(c.id, { title: v })} maxLength={80} placeholder="Bénévolat, Engagements associatifs…" />
          <Repeater
            path={`customSections.${index}.entries`}
            items={c.entries}
            onChange={(entries) => patchCustom(c.id, { entries })}
            create={newCustomEntry}
            noun="l’entrée"
            addLabel="Ajouter une entrée"
            max={30}
            summary={(e) => ({ title: e.title, meta: [e.subtitle, e.date].filter(Boolean).join(' · ') })}
            render={(e, patch) => (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Text name="title" label="Intitulé" value={e.title} onChange={(v) => patch({ title: v })} maxLength={200} />
                  <Text name="subtitle" label="Organisation ou précision" value={e.subtitle} onChange={(v) => patch({ subtitle: v })} maxLength={200} />
                </div>
                <DateIn name="date" label="Date" value={e.date} onChange={(v) => patch({ date: v })} />
                <Area name="description" label="Description" rows={2} maxLength={4000} value={e.description} onChange={(v) => patch({ description: v })} />
              </>
            )}
          />
        </div>
      </PathCtx.Provider>
    )
  }

  return (
    <IssuesCtx.Provider value={errorMap}>
      <div className="grid gap-3">
        <SectionCard title="Identité et contact" id="rubrique-identite">
          <PathCtx.Provider value="identity">
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Text name="firstName" label="Prénom" autoComplete="given-name" value={value.identity.firstName} onChange={(v) => setIdentity({ firstName: v })} maxLength={200} />
                <Text name="lastName" label="Nom" autoComplete="family-name" value={value.identity.lastName} onChange={(v) => setIdentity({ lastName: v })} maxLength={200} />
              </div>
              <Text name="headline" label="Titre professionnel" hint="L’intitulé du poste visé, tel qu’il apparaît dans les offres." value={value.identity.headline} onChange={(v) => setIdentity({ headline: v })} maxLength={200} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Text name="email" label="E-mail" type="email" autoComplete="email" value={value.identity.email} onChange={(v) => setIdentity({ email: v })} maxLength={200} />
                <Text name="phone" label="Téléphone" type="tel" autoComplete="tel" value={value.identity.phone} onChange={(v) => setIdentity({ phone: v })} maxLength={200} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Text name="location" label="Localisation" autoComplete="address-level2" value={value.identity.location} onChange={(v) => setIdentity({ location: v })} maxLength={200} placeholder="Ville, pays" />
                <Text name="details" label="Informations complémentaires" value={value.identity.details} onChange={(v) => setIdentity({ details: v })} maxLength={200} placeholder="Permis B · Mobile Île-de-France" />
              </div>
              <PhotoField value={value.identity.photo} onChange={(v) => setIdentity({ photo: v })} />
            </div>
          </PathCtx.Provider>
        </SectionCard>

        <SectionCard title="Liens professionnels">
          <Repeater
            path="links"
            items={value.links}
            onChange={(v) => set('links', v)}
            create={newLink}
            noun="le lien"
            addLabel="Ajouter un lien"
            summary={(l) => ({ title: l.label, meta: l.url.replace(/^https?:\/\//, '') })}
            render={(l, patch) => (
              <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                <Text name="label" label="Libellé" value={l.label} onChange={(v) => patch({ label: v })} maxLength={200} placeholder="LinkedIn" />
                <UrlField label="Adresse" value={l.url} onChange={(v) => patch({ url: v })} />
              </div>
            )}
          />
        </SectionCard>

        <div className="mt-3 flex items-baseline justify-between gap-3">
          <h2 className="text-base">Rubriques du CV</h2>
          <p className="text-sm text-muted">L’ordre ci-dessous est celui du PDF.</p>
        </div>

        {value.sections.map((ref, i) => {
          const custom = ref.key === 'custom' ? value.customSections.find((c) => c.id === ref.customId) : undefined
          const customIndex = custom ? value.customSections.indexOf(custom) : -1
          const label = ref.key === 'custom' ? custom?.title.trim() || 'Rubrique sans titre' : SECTION_LABELS[ref.key]
          return (
            <SectionCard
              key={sectionId(ref)}
              title={label}
              hidden={!ref.visible}
              controls={
                <>
                  <IconButton label={`Monter la rubrique ${label}`} disabled={i === 0} onClick={() => moveSection(i, i - 1)}>
                    <IconUp />
                  </IconButton>
                  <IconButton label={`Descendre la rubrique ${label}`} disabled={i === value.sections.length - 1} onClick={() => moveSection(i, i + 1)}>
                    <IconDown />
                  </IconButton>
                  <IconButton label={`${ref.visible ? 'Masquer' : 'Afficher'} la rubrique ${label}`} onClick={() => toggleSection(ref)}>
                    {ref.visible ? <IconEye /> : <IconEyeOff />}
                  </IconButton>
                  {custom ? (
                    <IconButton danger label={`Supprimer la rubrique ${label}`} onClick={() => onChange(removeCustomSection(value, custom.id))}>
                      <IconTrash />
                    </IconButton>
                  ) : null}
                </>
              }
            >
              {ref.key === 'custom' ? (custom ? customBody(custom, customIndex) : null) : fixedBody[ref.key]}
            </SectionCard>
          )
        })}

        <div>
          <button type="button" className="btn" disabled={value.customSections.length >= 10} onClick={() => onChange(addCustomSection(value, ''))}>
            <IconPlus /> Ajouter une rubrique libre
          </button>
          <p className="mt-1 text-sm text-faint">Bénévolat, engagements, expositions… jusqu’à 10 rubriques.</p>
        </div>
      </div>
    </IssuesCtx.Provider>
  )
}
