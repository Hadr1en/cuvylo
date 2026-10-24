/**
 * Symbole Cuvylo : un « C » dont l'ouverture laisse voir trois lignes de texte, comme sur un CV.
 * - `dark`  : carré marine (sur fond clair) ;
 * - `light` : carré blanc (sur la navigation marine).
 * Même dessin que public/favicon.svg et docs/logo/.
 */
export function LogoMark({ size = 28, tone = 'dark', className = '' }: { size?: number; tone?: 'dark' | 'light'; className?: string }) {
  const square = tone === 'dark' ? '#13213d' : '#ffffff'
  const letter = tone === 'dark' ? '#ffffff' : '#13213d'
  const lines = tone === 'dark' ? '#8fb2f4' : '#1f4fa3'
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" className={className}>
      <rect width="64" height="64" rx="14" fill={square} />
      <path d="M37.6 19.4A15.5 15.5 0 1 0 37.6 44.6" fill="none" stroke={letter} strokeWidth="7" strokeLinecap="round" />
      <path d="M41 26h10M41 32h7M41 38h10" fill="none" stroke={lines} strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}
