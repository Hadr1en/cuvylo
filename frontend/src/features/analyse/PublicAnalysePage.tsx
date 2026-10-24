import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useSetupNeeded } from '@/features/auth/useSetupNeeded'
import { useInstance } from '@/hooks/useInstance'
import { LegalFooter } from '@/ui/LegalFooter'
import { IconCheck } from '@/ui/Icons'
import { ThemeToggle, Wordmark } from '@/ui/Shell'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { AnalyseTool } from './AnalysePage'

const PROMISES = ['Gratuit', 'Sans compte', 'Le fichier ne quitte pas votre navigateur', 'Aucune publicité, aucun e-mail collecté']

const WITH_ACCOUNT = [
  'Un profil principal, autant de CV que de candidatures, en 18 modèles lisibles par les ATS.',
  'Le suivi de vos candidatures et vos lettres de motivation, au même endroit.',
  'Votre adresse e-mail sert uniquement à vous connecter et à réinitialiser votre mot de passe : ni publicité, ni newsletter, ni revente.',
]

/**
 * Page d'accueil publique (/ sans session, ou /analyser) : l'analyse ATS d'un CV PDF, sans compte.
 * Les comptes ne servent qu'à créer des CV et suivre des candidatures.
 */
export default function PublicAnalysePage() {
  useDocumentTitle('Analyser un CV')
  const { status } = useAuth()
  const instance = useInstance()
  const registrationOpen = instance.status === 'ready' && instance.info.registration.open
  const signedIn = status === 'authenticated'
  const setupNeeded = useSetupNeeded()
  // Site pas encore installé : la première visite mène à l'assistant d'installation.
  if (setupNeeded) return <Navigate to="/installation" replace />

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <Link to="/analyser" aria-label="Cuvylo, accueil">
            <Wordmark />
          </Link>
          <nav aria-label="Compte" className="flex items-center gap-1.5">
            {signedIn ? (
              <Link to="/" className="btn btn-primary btn-sm">
                Mon espace
              </Link>
            ) : (
              <>
                <Link to="/connexion" className="btn btn-ghost btn-sm">
                  Se connecter
                </Link>
                {registrationOpen ? (
                  <Link to="/inscription" className="btn btn-primary btn-sm">
                    Créer un compte
                  </Link>
                ) : null}
              </>
            )}
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <h1 className="text-[1.8rem] leading-tight sm:text-[2.1rem]">Votre CV est-il bien lu par les logiciels de recrutement ?</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Déposez votre CV en PDF : Cuvylo montre ce qu’un logiciel de recrutement (ATS) en extrait, signale ce qui risque d’être mal lu, et le compare à
          une offre si vous le souhaitez.
        </p>
        <ul className="mb-7 mt-4 flex list-none flex-wrap gap-x-5 gap-y-1.5 p-0 text-sm text-muted" aria-label="Engagements">
          {PROMISES.map((p) => (
            <li key={p} className="flex items-center gap-1.5">
              <IconCheck className="shrink-0 text-ok" />
              {p}
            </li>
          ))}
        </ul>

        <AnalyseTool next={() => null} />

        <section className="card mt-10 p-5 sm:p-6" aria-labelledby="with-account">
          <h2 id="with-account" className="text-lg">
            {/* Inscriptions fermées : on le dit tout de suite, pas après la liste des avantages. */}
            {instance.status === 'ready' && !registrationOpen ? 'Aller plus loin avec un compte, gratuit et sur invitation' : 'Aller plus loin avec un compte, gratuit'}
          </h2>
          <ul className="mt-3 grid list-none gap-2 p-0">
            {WITH_ACCOUNT.map((p) => (
              <li key={p} className="flex gap-2 text-[0.93rem]">
                <IconCheck className="mt-1 shrink-0 text-ok" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          {signedIn ? null : (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {registrationOpen ? (
                <Link to="/inscription" className="btn btn-primary">
                  Créer un compte
                </Link>
              ) : null}
              <Link to="/connexion" className={registrationOpen ? 'btn' : 'btn btn-primary'}>
                Se connecter
              </Link>
              {instance.status === 'ready' && !registrationOpen ? (
                <p className="m-0 text-sm text-muted">Les comptes sont créés sur invitation de la personne qui gère ce site.</p>
              ) : null}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-3xl px-4 py-4 sm:px-8">
          <LegalFooter />
        </div>
      </footer>
    </div>
  )
}
