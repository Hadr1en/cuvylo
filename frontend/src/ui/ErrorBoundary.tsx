import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Filet de sécurité : une erreur de rendu n'efface plus toute l'application.
 * Les données saisies sont déjà enregistrées (ou en brouillon local) ; on propose de recharger.
 * `resetKey` (le chemin courant) réinitialise l'écran d'erreur quand on change de page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erreur d’affichage', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="mx-auto my-12 max-w-lg px-5">
        <div className="card p-6">
          <h1 className="text-xl">Cette page n’a pas pu s’afficher</h1>
          <p className="mt-2 text-muted">
            Vos modifications enregistrées ne sont pas perdues. Rechargez la page ; si le problème persiste, exportez votre profil
            depuis la page Compte et signalez-le à l’administrateur de l’instance.
          </p>
          <p className="mt-3 rounded-md bg-sunken px-3 py-2 font-mono text-xs text-muted">{this.state.error.message}</p>
          <div className="mt-5 flex gap-2">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Recharger
            </button>
            <a href="/" className="btn">
              Retour à l’accueil
            </a>
          </div>
        </div>
      </div>
    )
  }
}
