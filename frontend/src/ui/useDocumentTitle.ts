import { useEffect } from 'react'

/** Titre d'onglet « Page · Cuvylo » : utile avec plusieurs onglets et pour les lecteurs d'écran. */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Cuvylo` : 'Cuvylo'
  }, [title])
}
