import { useId, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { IconChevron } from './Icons'

interface FieldShell {
  label: string
  hint?: string | undefined
  error?: string | undefined
  className?: string | undefined
}

/** Étiquette + champ + aide/erreur, correctement reliés (aria-describedby). */
function Shell({ label, hint, error, className, id, children, counter }: FieldShell & { id: string; children: ReactNode; counter?: ReactNode }) {
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        {counter}
      </div>
      {children}
      {error ? (
        <p id={`${id}-msg`} className="mt-1 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-msg`} className="mt-1 text-sm text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

type TextProps = FieldShell & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'className'> & {
  value: string
  onChange: (value: string) => void
}

export function TextField({ label, hint, error, className, value, onChange, ...rest }: TextProps) {
  const id = useId()
  return (
    <Shell id={id} label={label} hint={hint} error={error} className={className}>
      <input
        {...rest}
        id={id}
        className="input"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Shell>
  )
}

type AreaProps = FieldShell & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value' | 'className'> & {
  value: string
  onChange: (value: string) => void
  maxLength?: number
}

export function TextArea({ label, hint, error, className, value, onChange, rows = 3, maxLength, lang = 'fr', ...rest }: AreaProps) {
  const id = useId()
  // Compteur affiché seulement à l'approche de la limite : inutile de distraire avant.
  const near = maxLength !== undefined && value.length > maxLength * 0.8
  return (
    <Shell
      id={id}
      label={label}
      hint={hint}
      error={error}
      className={className}
      counter={near ? <span className={`num text-xs ${value.length >= (maxLength ?? 0) ? 'text-danger' : 'text-faint'}`}>{value.length} / {maxLength}</span> : null}
    >
      <textarea
        {...rest}
        id={id}
        rows={rows}
        maxLength={maxLength}
        lang={lang}
        spellCheck
        className="input"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Shell>
  )
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/**
 * Date d'un parcours : année seule (« 2019 ») ou mois et année (« 2019-03 »), ou vide.
 * Deux champs simples plutôt qu'un sélecteur natif : beaucoup de CV ne précisent que l'année.
 */
export function DateField({ label, value, onChange, className, disabled, error }: {
  label: string
  value: string
  onChange: (v: string) => void
  className?: string
  disabled?: boolean
  error?: string | undefined
}) {
  const id = useId()
  const [year = '', month = ''] = value.split('-')
  // Saisie en cours (année incomplète) : gardée localement jusqu'à la sortie du champ.
  const [draftYear, setDraftYear] = useState<string | null>(null)
  const shownYear = draftYear ?? year

  function emit(y: string, m: string) {
    if (!/^\d{4}$/.test(y)) {
      if (y === '') onChange('')
      return
    }
    onChange(m ? `${y}-${m}` : y)
  }

  return (
    <fieldset className={className} disabled={disabled}>
      <legend className="label">{label}</legend>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-1.5">
        <select
          id={`${id}-m`}
          aria-label={`${label} — mois (facultatif)`}
          className="input"
          value={month}
          onChange={(e) => emit(year, e.target.value)}
          disabled={disabled || !year}
        >
          <option value="">Mois</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={String(i + 1).padStart(2, '0')}>
              {m}
            </option>
          ))}
        </select>
        <input
          id={`${id}-y`}
          aria-label={`${label} — année`}
          className="input num"
          inputMode="numeric"
          placeholder="Année"
          maxLength={4}
          value={disabled ? '' : shownYear}
          aria-invalid={error || (draftYear && !/^\d{4}$/.test(draftYear)) ? true : undefined}
          aria-describedby={error ? `${id}-msg` : undefined}
          onChange={(e) => {
            const y = e.target.value.replace(/\D/g, '').slice(0, 4)
            setDraftYear(y)
            emit(y, month)
          }}
          onBlur={() => setDraftYear(null)}
        />
      </div>
      {error ? (
        <p id={`${id}-msg`} className="mt-1 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

/** @deprecated nom historique : les dates acceptent désormais l'année seule. */
export const MonthField = DateField

/**
 * Liste séparée par des virgules. Le texte brut est conservé localement pour
 * que la saisie d'une virgule finale ne soit pas « mangée » par le découpage.
 */
export function TagsField({ label, hint, items, onChange, className }: {
  label: string
  hint?: string
  items: string[]
  onChange: (items: string[]) => void
  className?: string
}) {
  const id = useId()
  const [text, setText] = useState(items.join(', '))
  return (
    <Shell id={id} label={label} hint={hint} className={className}>
      <input
        id={id}
        className="input"
        value={text}
        aria-describedby={hint ? `${id}-msg` : undefined}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
        }}
        onBlur={() => setText(items.join(', '))}
      />
    </Shell>
  )
}

export function SelectField<T extends string>({ label, value, options, onChange, className, hint }: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
  hint?: string
}) {
  const id = useId()
  return (
    <Shell id={id} label={label} className={className} hint={hint}>
      <select id={id} className="input" value={value} aria-describedby={hint ? `${id}-msg` : undefined} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  )
}

/** Interrupteur accessible (role=switch). */
export function Switch({ checked, onChange, label, description, disabled }: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-[0.93rem] font-semibold text-ink">
          {label}
        </label>
        {description ? (
          <p id={`${id}-d`} className="text-sm text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
          checked ? 'border-accent bg-accent' : 'border-line-input bg-sunken'
        }`}
      >
        <span
          className={`absolute top-[1px] left-[1px] size-4 rounded-full shadow-sm transition-transform ${checked ? 'bg-white' : 'bg-faint'}`}
          style={{ transform: checked ? 'translateX(16px)' : 'none' }}
        />
      </button>
    </div>
  )
}

/** Bloc repliable accessible (bouton + aria-expanded). */
export function Disclosure({ title, meta, open, onToggle, actions, children, level = 3 }: {
  title: ReactNode
  meta?: ReactNode
  open: boolean
  onToggle: () => void
  actions?: ReactNode
  children: ReactNode
  level?: 2 | 3
}) {
  const id = useId()
  const Heading = `h${level}` as 'h2' | 'h3'
  return (
    <div>
      <div className="flex items-center gap-1">
        <Heading className="m-0 min-w-0 flex-1 text-[0.95rem] font-semibold">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={onToggle}
            className="flex w-full items-center gap-2 rounded-md py-1.5 text-left"
          >
            <IconChevron className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
            <span className="min-w-0 truncate">{title}</span>
            {meta ? <span className="truncate text-sm font-normal text-faint">{meta}</span> : null}
          </button>
        </Heading>
        {actions}
      </div>
      <div id={id} hidden={!open}>
        {open ? children : null}
      </div>
    </div>
  )
}
