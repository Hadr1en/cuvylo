import { useEffect, useId, useRef, type ReactNode } from 'react'
import { IconX } from './Icons'

/**
 * Fenêtre modale sur l'élément natif <dialog> : piège du focus, touche Échap et fond inerte
 * fournis par le navigateur. `onClose` est appelé sur Échap, sur le bouton de fermeture
 * et (si `dismissable`) sur un clic dans le fond.
 */
export function Dialog({ open, title, description, onClose, children, dismissable = true, width = 'max-w-md' }: {
  open: boolean
  title: string
  description?: ReactNode
  onClose: () => void
  children: ReactNode
  dismissable?: boolean
  width?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      // jsdom n'implémente pas showModal : repli sur l'attribut open.
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
      // Le navigateur place le focus sur le premier élément (le bouton Fermer) : on préfère le
      // premier champ du formulaire, s'il y en a un.
      d.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)')?.focus()
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close()
      else d.removeAttribute('open')
    }
  }, [open])

  return (
    // Le clic sur le fond (hors boîte) ferme la fenêtre ; l'équivalent clavier est Échap (onCancel natif).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault()
        if (dismissable) onClose()
      }}
      onClick={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose()
      }}
      className={`m-auto w-[calc(100%-2rem)] ${width} rounded-lg border border-line bg-surface p-0 text-text shadow-float backdrop:bg-[rgb(10_16_29/0.5)]`}
    >
      {open ? (
        <div className="p-5">
          <div className="mb-3 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-lg">
              {title}
            </h2>
            {dismissable ? (
              <button type="button" className="btn btn-ghost btn-icon -mr-2 -mt-1" aria-label="Fermer" onClick={onClose}>
                <IconX />
              </button>
            ) : null}
          </div>
          {description ? (
            <div id={descId} className="mb-4 text-sm text-muted">
              {description}
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
    </dialog>
  )
}
