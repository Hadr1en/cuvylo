import { Link } from 'react-router-dom'

export const LEGAL_LINKS = [
  { to: '/mentions-legales', label: 'Mentions légales' },
  { to: '/confidentialite', label: 'Confidentialité' },
  { to: '/securite', label: 'Sécurité' },
] as const

/** Dépôt d'origine : affiché sur toute instance, où qu'elle soit installée (licence PolyForm Noncommercial). */
export const SOURCE_URL = 'https://github.com/Hadr1en/cuvylo'

/** Liens vers les pages légales et le code source, présents sur toutes les pages (connexion comprise). */
export function LegalFooter({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Informations légales" className={`flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted ${className}`}>
      {LEGAL_LINKS.map((l) => (
        <Link key={l.to} to={l.to} className="hover:text-ink hover:underline underline-offset-2">
          {l.label}
        </Link>
      ))}
      <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-ink hover:underline underline-offset-2">
        Cuvylo · code source
      </a>
    </nav>
  )
}
