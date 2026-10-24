import { useEffect, useState, type ReactNode } from 'react'
import { ACCENT_PRESETS, FONT_PAIRS, FONT_PAIR_LABELS, TEMPLATE_GROUPS, TEMPLATE_INFO, contrastRatio, type CvSettings, type TemplateId } from '@/domain/cv'
import { sectionHasContent, sectionId, sectionLabel, type ProfileData } from '@/domain/profile'
import type { FitInfo } from '@/pdf/usePdf'
import { renderThumb } from '@/pdf/thumbs'
import { SelectField, Switch } from '@/ui/fields'
import { IconCheck } from '@/ui/Icons'

interface Props {
  settings: CvSettings
  data: ProfileData
  onChange: (next: CvSettings) => void
  fit?: FitInfo | null
}

/** Miniature RÉELLE : le modèle rendu par le moteur PDF avec le contenu de l'utilisateur. */
function TemplateThumb({ template, data, settings }: { template: TemplateId; data: ProfileData; settings: CvSettings }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    const timer = setTimeout(() => {
      renderThumb(data, { ...settings, template }, 260, abort.signal)
        .then((u) => !abort.signal.aborted && setUrl(u))
        .catch(() => undefined)
    }, 450)
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [data, settings, template])

  return (
    <div className="aspect-[595/842] w-full overflow-hidden rounded-sm bg-white">
      {url ? (
        <img src={url} alt="" className="fade-in block size-full object-cover object-top" draggable={false} />
      ) : (
        <div className="grid size-full place-items-center bg-[#f4f6f9] text-xs text-neutral-500">Génération…</div>
      )}
    </div>
  )
}

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 min-w-0 border-0 border-t border-line p-0 pt-5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full text-base font-semibold text-ink">{title}</legend>
      {description ? <p className="clear-left mb-3 text-sm text-muted">{description}</p> : <div className="clear-left mb-3" />}
      {children}
    </fieldset>
  )
}

export function CvSettingsPanel({ settings, data, onChange, fit }: Props) {
  const set = (p: Partial<CvSettings>) => onChange({ ...settings, ...p })
  const visible = data.sections.filter((s) => s.visible && sectionHasContent(data, sectionId(s)))
  const firstId = visible[0] ? sectionId(visible[0]) : undefined
  const isPreset = ACCENT_PRESETS.some((c) => c.value === settings.accent.toLowerCase())
  const ratio = contrastRatio(settings.accent, '#ffffff')
  const hasPhoto = data.identity.photo !== ''

  return (
    <div className="grid gap-6">
      <Group title="Modèle" description="Miniatures générées avec votre contenu. « Une colonne » se lit de façon linéaire par un analyseur ; ce n’est pas une garantie.">
        <div className="grid gap-5">
          {TEMPLATE_GROUPS.map((g) => (
            <div key={g.label}>
              <p className="overline mb-2">{g.label}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
                {g.templates.map((t) => {
                  const active = settings.template === t
                  const info = TEMPLATE_INFO[t]
                  return (
                    <label key={t} className="group relative block cursor-pointer">
                      <input type="radio" name="template" className="peer sr-only" checked={active} onChange={() => set({ template: t })} />
                      <span
                        className={`block rounded-md border p-1 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
                          active ? 'border-accent ring-2 ring-accent' : 'border-line group-hover:border-line-strong'
                        }`}
                      >
                        <TemplateThumb template={t} data={data} settings={settings} />
                      </span>
                      <span className="mt-1.5 flex items-center gap-1.5 text-[0.93rem] font-semibold text-ink">
                        {info.label}
                        {active ? <IconCheck className="text-accent-text" aria-label="sélectionné" /> : null}
                      </span>
                      <span className="block text-sm leading-snug text-muted">{info.blurb}</span>
                      <span className={`badge mt-1 ${info.ats === 'high' ? 'badge-ok' : 'badge-warn'}`}>{info.ats === 'high' ? 'Une colonne' : 'Deux colonnes'}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </Group>

      <Group title="Couleur d’accent">
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map((c) => {
            const active = settings.accent.toLowerCase() === c.value
            return (
              <label key={c.value} className="relative cursor-pointer">
                <input type="radio" name="accent" className="peer sr-only" checked={active} onChange={() => set({ accent: c.value })} />
                <span
                  className={`grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-surface transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent ${active ? 'ring-2 ring-ink' : ''}`}
                  style={{ background: c.value }}
                  title={c.label}
                >
                  {active ? <IconCheck className="text-white" /> : null}
                </span>
                <span className="sr-only">{c.label}</span>
              </label>
            )
          })}
          <label className="ml-1 flex items-center gap-2 text-sm text-muted">
            <input type="color" value={settings.accent} onChange={(e) => set({ accent: e.target.value })} className="size-8 cursor-pointer rounded-full border border-line bg-transparent p-0.5" aria-label="Couleur personnalisée" />
            {isPreset ? 'Autre' : settings.accent}
          </label>
        </div>
        {ratio < 4.5 ? (
          <p role="status" className="notice notice-warn mt-3 text-sm">
            Couleur trop claire sur fond blanc (contraste {ratio.toFixed(1).replace('.', ',')}:1, 4,5 recommandé) : le texte coloré se lira mal, surtout imprimé.
          </p>
        ) : null}
      </Group>

      <Group title="Typographie et langue">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Polices" value={settings.fontPair} onChange={(v) => set({ fontPair: v })} options={FONT_PAIRS.map((f) => ({ value: f, label: FONT_PAIR_LABELS[f] }))} />
          <SelectField
            label="Langue des intitulés"
            value={settings.locale}
            onChange={(v) => set({ locale: v })}
            options={[
              { value: 'fr', label: 'Français' },
              { value: 'en', label: 'Anglais' },
            ]}
            hint="Titres de rubriques, mois, « Présent »."
          />
        </div>
      </Group>

      <Group title="Mise en page">
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Densité"
              value={settings.density}
              onChange={(v) => set({ density: v })}
              options={[
                { value: 'comfortable', label: 'Aérée' },
                { value: 'compact', label: 'Resserrée' },
              ]}
            />
            <SelectField
              label="Ajuster au nombre de pages"
              value={String(settings.targetPages) as '0' | '1' | '2'}
              onChange={(v) => set({ targetPages: Number(v) as 0 | 1 | 2 })}
              options={[
                { value: '0', label: 'Non' },
                { value: '1', label: 'Tenir sur 1 page' },
                { value: '2', label: 'Tenir sur 2 pages' },
              ]}
              hint="Réduit légèrement la taille du texte, sans descendre sous un seuil lisible."
            />
          </div>
          {settings.targetPages > 0 && fit ? (
            <p role="status" className={`notice text-sm ${fit.reached ? 'notice-ok' : 'notice-warn'}`}>
              {fit.reached
                ? fit.scale < 1
                  ? `Texte réduit à ${Math.round(fit.scale * 100)} % pour tenir sur ${settings.targetPages} page${settings.targetPages > 1 ? 's' : ''}.`
                  : 'Le CV tient déjà dans ce nombre de pages.'
                : `Impossible de tenir sur ${settings.targetPages} page${settings.targetPages > 1 ? 's' : ''} sans nuire à la lisibilité (${fit.pages} pages au plus petit). Allégez le contenu ou masquez une rubrique.`}
            </p>
          ) : null}
          <Switch
            label="Garder chaque expérience d’un seul tenant"
            description="Évite qu’un poste soit coupé entre deux pages (sauf s’il est très long)."
            checked={settings.keepEntriesTogether}
            onChange={(v) => set({ keepEntriesTogether: v })}
          />
          <Switch
            label="Afficher la photo"
            description={hasPhoto ? 'Ignorée par les ATS ; en France, une photo n’est pas attendue et peut exposer à des biais.' : 'Ajoutez d’abord une photo dans l’onglet Contenu, rubrique Identité.'}
            checked={settings.showPhoto && hasPhoto}
            disabled={!hasPhoto}
            onChange={(v) => set({ showPhoto: v })}
          />
          <Switch
            label="Anonymiser"
            description="Initiales à la place du nom, sans coordonnées, liens ni photo. Pour un dossier de compétences transmis par un cabinet ou une ESN."
            checked={settings.anonymize}
            onChange={(v) => set({ anonymize: v })}
          />
        </div>
      </Group>

      <Group title="Sauts de page" description="Forcez le début d’une rubrique sur une nouvelle page. Seules les rubriques affichées sont listées.">
        <div className="grid gap-3">
          {visible.map((s) => {
            const sid = sectionId(s)
            return (
              <Switch
                key={sid}
                label={sectionLabel(data, sid)}
                description={sid === firstId ? 'Première rubrique : sans effet.' : undefined}
                checked={sid !== firstId && settings.pageBreakBefore.includes(sid)}
                disabled={sid === firstId}
                onChange={(on) =>
                  set({
                    pageBreakBefore: on ? [...settings.pageBreakBefore.filter((k) => k !== sid), sid] : settings.pageBreakBefore.filter((k) => k !== sid),
                  })
                }
              />
            )
          })}
          {visible.length === 0 ? <p className="text-sm text-faint">Aucune rubrique à afficher pour l’instant.</p> : null}
        </div>
      </Group>
    </div>
  )
}
