import { TEMPLATE_INFO } from '@/domain/cv'
import type { Rule } from '../types'

/**
 * Modèles à deux colonnes (`ats: 'medium'`) :
 * - titres en marge (Marge) : le titre partage la ligne du début du contenu, certains extracteurs les « collent » ;
 * - barre latérale : la colonne latérale est lue avant ou après le contenu principal, hors de l'ordre affiché.
 */
export const TEMPLATE_RULES: Rule[] = [
  {
    id: 'template-reading-order',
    category: 'structure',
    title: 'Le modèle choisi garde une lecture linéaire (une colonne)',
    run({ settings }) {
      const info = TEMPLATE_INFO[settings.template]
      if (info.ats === 'high') return []
      const sidebar = settings.template === 'sidebar'
      return [
        {
          ruleId: 'template-reading-order',
          severity: 'info',
          message: sidebar
            ? `Le modèle « ${info.label} » place des rubriques dans une colonne latérale : un analyseur la lit séparément, hors de l’ordre affiché.`
            : `Le modèle « ${info.label} » place les titres de rubriques dans la marge : un analyseur peut les fusionner avec le texte voisin.`,
          fix: sidebar
            ? 'Pour un portail de recrutement, envoyez l’export ATS (version une colonne, même contenu). Gardez ce modèle pour un envoi direct à une personne.'
            : 'Pour une candidature passant par un portail de recrutement, préférez un modèle à une colonne (Classique, Moderne, Dossier…). Gardez celui-ci pour un envoi direct à une personne.',
        },
      ]
    },
  },
]
