import type { ProfileData } from '@/domain/profile'
import { describeIssuePath } from '@/domain/validate'
import type { Issue, SaveStatus } from '@/hooks/useAutosave'

/**
 * Bandeau d'explication sous la barre d'outils : champs à corriger (rien n'est perdu, l'envoi
 * reprend dès que c'est corrigé) ou conflit de modification entre deux onglets.
 */
export function SaveProblems({ status, issues, data, onKeepMine, onTakeTheirs }: {
  status: SaveStatus
  issues: Issue[]
  data: ProfileData
  onKeepMine?: () => void
  onTakeTheirs?: () => void
}) {
  if (status === 'conflict') {
    return (
      <div role="alert" className="notice notice-warn mb-4">
        <p className="font-semibold text-ink">Ce document a été modifié ailleurs (autre onglet ou appareil).</p>
        <p className="text-sm text-muted">Vos dernières modifications sont conservées ici. Choisissez la version à garder.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {onKeepMine ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={onKeepMine}>
              Garder mes modifications
            </button>
          ) : null}
          {onTakeTheirs ? (
            <button type="button" className="btn btn-sm" onClick={onTakeTheirs}>
              Recharger l’autre version
            </button>
          ) : null}
        </div>
      </div>
    )
  }
  if ((status !== 'invalid' && status !== 'error') || issues.length === 0) return null
  return (
    <div role="alert" className="notice notice-warn mb-4">
      <p className="font-semibold text-ink">À corriger avant l’enregistrement</p>
      <p className="text-sm text-muted">Vos saisies restent dans cette page et dans un brouillon local ; l’enregistrement reprend dès que c’est corrigé.</p>
      <ul className="mt-2 list-disc pl-5 text-sm">
        {issues.slice(0, 8).map((i) => (
          <li key={i.path}>
            <span className="font-semibold">{describeIssuePath(data, i.path)}</span> : {i.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
