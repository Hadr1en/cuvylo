import type { SaveStatus } from '@/hooks/useAutosave'
import { IconAlert, IconCheck } from '@/ui/Icons'

/** Indicateur d'enregistrement (région live polie, lue par les lecteurs d'écran). */
export function SaveIndicator({ status, onRetry, issueCount = 0 }: { status: SaveStatus; onRetry?: () => void; issueCount?: number }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-sm text-muted">
      {status === 'saving' || status === 'dirty' ? <>Enregistrement…</> : null}
      {status === 'saved' ? (
        <>
          <IconCheck className="text-ok" /> Enregistré
        </>
      ) : null}
      {status === 'invalid' ? (
        <>
          <IconAlert className="text-warn" />
          <span className="text-warn">
            Non enregistré : {issueCount} champ{issueCount > 1 ? 's' : ''} à corriger
          </span>
        </>
      ) : null}
      {status === 'conflict' ? (
        <>
          <IconAlert className="text-warn" /> <span className="text-warn">Modifié ailleurs</span>
        </>
      ) : null}
      {status === 'error' ? (
        <>
          <IconAlert className="text-danger" /> <span className="text-danger">Échec de l’enregistrement</span>
          {onRetry ? (
            <button type="button" className="link font-semibold" onClick={onRetry}>
              Réessayer
            </button>
          ) : null}
        </>
      ) : null}
    </span>
  )
}
