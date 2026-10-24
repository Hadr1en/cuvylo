import { useState, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { ErrorBoundary } from './ErrorBoundary'
import { IconBriefcase, IconFile, IconLogout, IconMail, IconMenu, IconMoon, IconSettings, IconShield, IconSun, IconUser, IconX } from './Icons'
import { LegalFooter } from './LegalFooter'
import { LogoMark } from './Logo'
import { ReconnectDialog } from './ReconnectDialog'
import { useTheme } from './theme'

/** Symbole + nom : sobre, lisible à toutes les tailles. `inverse` : sur fond marine. */
export function Wordmark({ className = '', inverse = false }: { className?: string; inverse?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap leading-none ${className}`}>
      <LogoMark size={28} tone={inverse ? 'light' : 'dark'} />
      <span className="text-[1.1rem] font-semibold tracking-[-0.015em]">Cuvylo</span>
    </span>
  )
}

export function ThemeToggle({ className = 'btn btn-ghost btn-icon' }: { className?: string }) {
  const { resolved, cycle } = useTheme()
  return (
    <button
      type="button"
      className={className}
      onClick={cycle}
      aria-label={resolved === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
      title={resolved === 'dark' ? 'Thème clair' : 'Thème sombre'}
    >
      {resolved === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  )
}

interface NavItem {
  to: string
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  end?: boolean
}

const MAIN_NAV: NavItem[] = [
  { to: '/', label: 'Mes CV', icon: IconFile, end: true },
  { to: '/profil', label: 'Profil', icon: IconUser },
  { to: '/candidatures', label: 'Candidatures', icon: IconBriefcase },
  { to: '/lettres', label: 'Lettres', icon: IconMail },
]

function NavEntry({ item, compact, onNavigate }: { item: NavItem; compact: boolean; onNavigate?: () => void }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      onClick={onNavigate}
      title={compact ? item.label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-md px-2.5 py-2 text-[0.93rem] font-medium transition-colors ${
          compact ? 'justify-center' : ''
        } ${isActive ? 'bg-nav-active text-nav-strong' : 'text-nav-text hover:bg-nav-hover hover:text-nav-strong'}`
      }
    >
      <Icon width={18} height={18} className="shrink-0" />
      <span className={compact ? 'sr-only' : ''}>{item.label}</span>
    </NavLink>
  )
}

function SidebarContent({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const secondary: NavItem[] = [
    { to: '/compte', label: 'Compte', icon: IconSettings },
    ...(user?.isAdmin ? [{ to: '/admin', label: 'Administration', icon: IconShield }] : []),
  ]
  return (
    <div className="flex h-full flex-col">
      <NavLink to="/" onClick={onNavigate} aria-label="Cuvylo — accueil" className={`flex h-14 items-center text-nav-strong ${compact ? 'justify-center' : 'px-4'}`}>
        {compact ? (
          <LogoMark size={28} tone="light" />
        ) : (
          <Wordmark inverse />
        )}
      </NavLink>
      <nav aria-label="Principale" className={`flex flex-1 flex-col gap-0.5 ${compact ? 'px-2' : 'px-3'} pt-2`}>
        {MAIN_NAV.map((item) => (
          <NavEntry key={item.to} item={item} compact={compact} onNavigate={onNavigate} />
        ))}
        <div className="my-3 border-t border-white/10" />
        {secondary.map((item) => (
          <NavEntry key={item.to} item={item} compact={compact} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className={`border-t border-white/10 py-3 ${compact ? 'px-2' : 'px-3'}`}>
        {!compact ? (
          <p className="mb-2 truncate px-2.5 text-sm text-nav-text" title={user?.email}>
            {user?.displayName?.trim() || user?.email}
          </p>
        ) : null}
        <div className={`flex ${compact ? 'flex-col items-center' : 'items-center'} gap-1`}>
          <ThemeToggle className="btn btn-icon border-transparent bg-transparent text-nav-text hover:!bg-nav-hover hover:!text-nav-strong" />
          <button
            type="button"
            className={`btn btn-sm border-transparent bg-transparent text-nav-text hover:!bg-nav-hover hover:!text-nav-strong ${compact ? 'btn-icon' : ''}`}
            onClick={() => void logout().then(() => navigate('/connexion', { replace: true }))}
            title="Se déconnecter"
          >
            <IconLogout />
            <span className={compact ? 'sr-only' : ''}>Se déconnecter</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export function Shell() {
  const { pathname } = useLocation()
  const [drawer, setDrawer] = useState(false)
  // L'éditeur a besoin de largeur : la barre latérale s'y réduit aux icônes.
  const compact = pathname.startsWith('/cv/') || pathname.startsWith('/lettres/')

  return (
    <div className="flex min-h-dvh">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent"
      >
        Aller au contenu
      </a>

      <aside className={`sticky top-0 hidden h-dvh shrink-0 bg-nav lg:block ${compact ? 'w-16' : 'w-60'}`}>
        <SidebarContent compact={compact} />
      </aside>

      {/* Mobile : barre du haut + tiroir. */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 bg-nav px-3 text-nav-strong lg:hidden">
        <button type="button" className="btn btn-icon border-transparent bg-transparent text-nav-strong hover:!bg-nav-hover" aria-label="Ouvrir le menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
          <IconMenu width={20} height={20} />
        </button>
        <Wordmark inverse />
      </div>
      {drawer ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Fermer le menu" className="absolute inset-0 bg-[rgb(10_16_29/0.5)]" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-nav shadow-float">
            <button type="button" className="btn btn-icon absolute right-2 top-3 border-transparent bg-transparent text-nav-strong hover:!bg-nav-hover" aria-label="Fermer le menu" onClick={() => setDrawer(false)}>
              <IconX />
            </button>
            <SidebarContent compact={false} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col pt-14 lg:pt-0">
        <main id="contenu" className="flex-1">
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
        {compact ? null : (
          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
              <LegalFooter />
              <span className="text-sm text-faint">Sans traceur · sans IA</span>
            </div>
          </footer>
        )}
      </div>
      <ReconnectDialog />
    </div>
  )
}

/** En-tête de page commun : titre, sous-titre, actions alignées à droite. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.6rem]">{title}</h1>
        {description ? <p className="mt-1 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
