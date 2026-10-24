import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { IconDown } from './Icons'

export interface MenuItem {
  label: string
  description?: string
  onSelect: () => void
  disabled?: boolean
}

/**
 * Menu déroulant (motif « menu button ») : flèches haut/bas, Échap pour fermer,
 * clic extérieur pour fermer, focus rendu au bouton.
 */
export function Menu({ label, items, className = 'btn btn-sm', icon, align = 'right' }: {
  label: ReactNode
  items: MenuItem[]
  className?: string
  icon?: ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    const first = list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    first?.focus()
    const onDown = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function close() {
    setOpen(false)
    button.current?.focus()
  }

  return (
    <div className="relative">
      <button ref={button} type="button" className={className} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {icon}
        {label}
        <IconDown width={14} height={14} />
      </button>
      {open ? (
        <ul
          ref={list}
          id={id}
          role="menu"
          className={`absolute top-full z-40 mt-1 w-72 rounded-lg border border-line bg-surface p-1 shadow-float ${align === 'right' ? 'right-0' : 'left-0'}`}
          onKeyDown={(e) => {
            const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
            if (e.key === 'Escape') {
              e.preventDefault()
              close()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              buttons[(i + 1) % buttons.length]?.focus()
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              buttons[(i - 1 + buttons.length) % buttons.length]?.focus()
            } else if (e.key === 'Tab') setOpen(false)
          }}
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className="block w-full rounded-md px-3 py-2 text-left hover:bg-sunken focus:bg-sunken focus:outline-none disabled:opacity-50"
                onClick={() => {
                  close()
                  item.onSelect()
                }}
              >
                <span className="block text-[0.93rem] font-semibold text-ink">{item.label}</span>
                {item.description ? <span className="block text-sm text-muted">{item.description}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
