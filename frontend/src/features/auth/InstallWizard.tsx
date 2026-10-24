import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api, type InstallCheck, type InstallInput, type InstallResult } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { errorMessage, fieldError } from '@/lib/format'
import { SelectField, Switch, TextField } from '@/ui/fields'
import { IconAlert, IconCheck, IconCopy } from '@/ui/Icons'
import { ThemeToggle, Wordmark } from '@/ui/Shell'
import { useDocumentTitle } from '@/ui/useDocumentTitle'

const STEPS = ['Vérifications', 'Base de données', 'Votre compte', 'Le site'] as const

const CHECK_LABELS: Record<string, string> = {
  php: 'PHP 8.1 ou plus récent',
  pdo_mysql: 'Extension PHP pdo_mysql (MySQL)',
  mbstring: 'Extension PHP mbstring',
  openssl: 'Extension PHP openssl',
  ctype: 'Extension PHP ctype',
  json: 'Extension PHP json',
  writable: 'Dossier cuvylo/ modifiable (pour enregistrer la configuration)',
}

/** Causes renvoyées par le serveur, sans le message technique du pilote MySQL. */
const DATABASE_ERRORS: Record<string, string> = {
  access_denied: 'Utilisateur ou mot de passe refusé par le serveur MySQL.',
  unknown_database: 'Cette base n’existe pas sur ce serveur : vérifiez son nom.',
  host_unreachable: 'Serveur injoignable : vérifiez son adresse, telle qu’indiquée par votre hébergeur (c’est rarement « localhost »).',
  driver_missing: 'L’extension PHP pdo_mysql manque : activez-la chez votre hébergeur.',
  connection_failed: 'Connexion impossible avec ces informations.',
}

const FIELD_ERRORS: Record<string, string> = {
  invalid_host: 'Adresse invalide : lettres, chiffres, points et tirets (port facultatif après « : »).',
  invalid_name: 'Nom invalide : lettres, chiffres, « _ » et « - ».',
  https_required: 'Le site doit être en https : activez le certificat SSL chez votre hébergeur, puis rouvrez cette page en https.',
  invalid_url: 'Adresse invalide (exemple : https://cv.exemple.fr, sans chemin).',
}

function installFieldError(error: unknown, path: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined
  const code = error.fields[path]
  return code ? (FIELD_ERRORS[code] ?? fieldError(error, path)) : undefined
}

/** Étape où corriger une erreur renvoyée par l'installation finale. */
function stepOf(error: unknown): number {
  const fields = error instanceof ApiError ? Object.keys(error.fields) : []
  if (fields.some((f) => f === 'database' || f.startsWith('database.'))) return 1
  if (fields.some((f) => f.startsWith('admin.'))) return 2
  return 3
}

function Notice({ tone, children }: { tone: 'info' | 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`notice notice-${tone} text-sm leading-relaxed`}>
      {children}
    </div>
  )
}

/**
 * Assistant d'installation, affiché tant que le serveur n'a aucune configuration (pas de fichier .env).
 * Il vérifie l'hébergement, teste la base, puis crée tables, compte administrateur et configuration :
 * rien à éditer à la main. La personne est ensuite connectée et arrive dans l'administration.
 */
export function InstallWizard() {
  const { login } = useAuth()
  const navigate = useNavigate()
  useDocumentTitle('Installation')
  const [step, setStep] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)

  const [checks, setChecks] = useState<InstallCheck[] | null>(null)
  const [checksFailed, setChecksFailed] = useState(false)
  const [db, setDb] = useState({ host: '', name: '', user: '', password: '' })
  const [admin, setAdmin] = useState({ displayName: '', email: '', password: '', confirm: '' })
  const [site, setSite] = useState({ appUrl: window.location.origin, publisher: '', contactEmail: '', host: '' })
  const [mailOn, setMailOn] = useState(false)
  const [mail, setMail] = useState({ host: '', port: '465', secure: 'ssl' as 'ssl' | 'starttls', user: '', password: '', from: '' })
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<InstallResult | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.install
      .status()
      .then((r) => !cancelled && setChecks(r.checks))
      .catch(() => !cancelled && setChecksFailed(true))
    return () => {
      cancelled = true
    }
  }, [])

  // Changement d'étape : le titre reçoit le focus (lecteurs d'écran, clavier).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    heading.current?.focus()
  }, [step, result])

  const blocking = checks?.some((c) => !c.ok && c.id !== 'writable') ?? true

  function go(next: number) {
    setError(null)
    setStep(next)
  }

  async function testDatabase(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.install.testDatabase({ host: db.host.trim(), name: db.name.trim(), user: db.user.trim(), password: db.password })
      go(2)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  function account(e: FormEvent) {
    e.preventDefault()
    if (admin.password !== admin.confirm || admin.password.length < 12) return
    if (!site.contactEmail) setSite((s) => ({ ...s, contactEmail: admin.email.trim() }))
    go(3)
  }

  async function install(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const input: InstallInput = {
      appUrl: site.appUrl.trim(),
      database: { host: db.host.trim(), name: db.name.trim(), user: db.user.trim(), password: db.password },
      admin: { email: admin.email.trim(), password: admin.password, ...(admin.displayName.trim() ? { displayName: admin.displayName.trim() } : {}) },
      legal: { publisher: site.publisher.trim(), contactEmail: site.contactEmail.trim(), host: site.host.trim() },
      ...(mailOn
        ? {
            mail: {
              host: mail.host.trim(),
              port: Number(mail.port) || 0,
              secure: mail.secure,
              user: mail.user.trim(),
              password: mail.password,
              from: mail.from.trim(),
            },
          }
        : {}),
    }
    try {
      const r = await api.install.run(input)
      if (r.written && !r.existingAccounts) {
        try {
          await login(input.admin.email, input.admin.password)
          navigate('/admin', { replace: true })
          return
        } catch {
          /* configuration écrite mais connexion impossible : l'écran final propose la page de connexion */
        }
      }
      setResult(r)
    } catch (err) {
      setError(err)
      const target = stepOf(err)
      if (target !== 3) setStep(target)
    } finally {
      setBusy(false)
    }
  }

  async function copyEnv() {
    if (!result?.envFile) return
    try {
      await navigator.clipboard.writeText(result.envFile)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const general = error && error instanceof ApiError && Object.keys(error.fields).length === 0 ? errorMessage(error) : null
  const dbError = error instanceof ApiError ? error.fields.database : undefined

  return (
    <div className="min-h-dvh bg-paper">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 sm:px-6">
        <Wordmark />
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 sm:py-12">
        {result ? null : (
          <ol className="mb-6 grid grid-cols-4 gap-2 text-xs sm:text-sm" aria-label="Étapes de l’installation">
            {STEPS.map((label, i) => (
              <li
                key={label}
                aria-current={i === step ? 'step' : undefined}
                className={`border-t-2 pt-2 ${i < step ? 'border-ok text-muted' : i === step ? 'border-accent font-semibold text-ink' : 'border-line text-faint'}`}
              >
                <span className="num">{i + 1}.</span> {label}
              </li>
            ))}
          </ol>
        )}

        <section className="card grid gap-5 p-5 sm:p-8">
          {result ? (
            <Done result={result} heading={heading} copied={copied} onCopy={copyEnv} />
          ) : step === 0 ? (
            <>
              <div>
                <h1 ref={heading} tabIndex={-1} className="text-[1.6rem] outline-none">
                  Bienvenue dans Cuvylo
                </h1>
                <p className="mt-1 text-muted">
                  Quatre étapes pour installer le site : rien à modifier à la main, l’assistant crée lui-même les tables et la configuration.
                </p>
              </div>
              <Notice tone="info">
                Préparez les accès à votre base MySQL : ils figurent dans l’espace client de votre hébergeur, rubrique <strong>Bases de données</strong>.
              </Notice>

              <div>
                <h2 className="mb-2 text-base">Votre hébergement</h2>
                {checksFailed ? <Notice tone="danger">Vérification impossible : rechargez la page.</Notice> : null}
                {checks === null && !checksFailed ? (
                  <p role="status" className="text-muted">
                    Vérification…
                  </p>
                ) : null}
                {checks ? (
                  <ul className="grid gap-1.5">
                    {checks.map((c) => (
                      <li key={c.id} className="flex items-start gap-2 text-[0.93rem]">
                        {c.ok ? <IconCheck className="mt-0.5 shrink-0 text-ok" /> : <IconAlert className={`mt-0.5 shrink-0 ${c.id === 'writable' ? 'text-warn' : 'text-danger'}`} />}
                        <span>
                          {CHECK_LABELS[c.id] ?? c.id}
                          {c.detail ? <span className="text-faint"> ({c.detail})</span> : null}
                          <span className="sr-only">{c.ok ? ' : correct' : ' : à corriger'}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {checks && blocking ? (
                  <div className="mt-3">
                    <Notice tone="danger">
                      Corrigez les points en rouge chez votre hébergeur (version de PHP, extensions), puis rechargez cette page.
                    </Notice>
                  </div>
                ) : null}
                {checks?.some((c) => c.id === 'writable' && !c.ok) ? (
                  <div className="mt-3">
                    <Notice tone="warn">
                      Le dossier cuvylo/ n’est pas modifiable par PHP : l’installation fonctionnera, mais vous devrez déposer vous-même le fichier de
                      configuration affiché à la fin.
                    </Notice>
                  </div>
                ) : null}
              </div>

              <p className="text-sm text-muted">
                Faites l’installation maintenant : tant qu’elle n’est pas terminée, toute personne qui ouvre le site verrait cet écran.
              </p>
              <div className="flex justify-end">
                <button type="button" className="btn btn-primary min-h-10" disabled={blocking} onClick={() => go(1)}>
                  Commencer
                </button>
              </div>
            </>
          ) : step === 1 ? (
            <form onSubmit={testDatabase} className="grid gap-4" noValidate>
              <div>
                <h1 ref={heading} tabIndex={-1} className="text-[1.6rem] outline-none">
                  Base de données
                </h1>
                <p className="mt-1 text-muted">Les tables y seront créées automatiquement. La base peut être vide.</p>
              </div>
              <Notice tone="info">
                Tout est dans l’espace client de votre hébergeur, rubrique <strong>Bases de données</strong> : l’adresse du serveur (rarement « localhost »
                sur un mutualisé), le nom de la base et l’utilisateur (souvent identiques), et le mot de passe choisi à la création (il peut être changé au
                même endroit).
              </Notice>
              <TextField
                label="Serveur"
                placeholder="sql.votre-hebergeur.net"
                autoComplete="off"
                spellCheck={false}
                value={db.host}
                onChange={(v) => setDb({ ...db, host: v })}
                error={installFieldError(error, 'database.host')}
                required
              />
              <TextField label="Nom de la base" autoComplete="off" spellCheck={false} value={db.name} onChange={(v) => setDb({ ...db, name: v })} error={installFieldError(error, 'database.name')} required />
              <TextField label="Utilisateur" autoComplete="off" spellCheck={false} value={db.user} onChange={(v) => setDb({ ...db, user: v })} error={installFieldError(error, 'database.user')} required />
              <TextField
                label="Mot de passe de la base"
                type="password"
                autoComplete="off"
                value={db.password}
                onChange={(v) => setDb({ ...db, password: v })}
                error={installFieldError(error, 'database.password')}
              />
              {dbError ? <Notice tone="danger">{DATABASE_ERRORS[dbError] ?? DATABASE_ERRORS.connection_failed}</Notice> : null}
              {general ? <Notice tone="danger">{general}</Notice> : null}
              <div className="flex justify-between gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => go(0)}>
                  Retour
                </button>
                <button type="submit" className="btn btn-primary min-h-10" disabled={busy || !db.host.trim() || !db.name.trim() || !db.user.trim()}>
                  {busy ? 'Connexion…' : 'Tester et continuer'}
                </button>
              </div>
            </form>
          ) : step === 2 ? (
            <form onSubmit={account} className="grid gap-4" noValidate>
              <div>
                <h1 ref={heading} tabIndex={-1} className="text-[1.6rem] outline-none">
                  Votre compte administrateur
                </h1>
                <p className="mt-1 text-muted">Vous gérerez le site avec ce compte : invitations, comptes, espace utilisé. Il a aussi ses propres CV.</p>
              </div>
              <TextField label="Nom affiché (facultatif)" autoComplete="nickname" value={admin.displayName} onChange={(v) => setAdmin({ ...admin, displayName: v })} maxLength={80} />
              <TextField
                label="Adresse e-mail"
                type="email"
                autoComplete="email"
                value={admin.email}
                onChange={(v) => setAdmin({ ...admin, email: v })}
                error={installFieldError(error, 'admin.email')}
                required
              />
              <TextField
                label="Mot de passe"
                type="password"
                autoComplete="new-password"
                value={admin.password}
                onChange={(v) => setAdmin({ ...admin, password: v })}
                hint="12 caractères minimum. Une phrase de passe fonctionne très bien."
                error={installFieldError(error, 'admin.password')}
                required
              />
              <TextField
                label="Confirmer le mot de passe"
                type="password"
                autoComplete="new-password"
                value={admin.confirm}
                onChange={(v) => setAdmin({ ...admin, confirm: v })}
                error={admin.confirm && admin.password !== admin.confirm ? 'Les deux saisies diffèrent.' : undefined}
                required
              />
              <div className="flex justify-between gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => go(1)}>
                  Retour
                </button>
                <button
                  type="submit"
                  className="btn btn-primary min-h-10"
                  disabled={!admin.email.trim() || admin.password.length < 12 || admin.password !== admin.confirm}
                >
                  Continuer
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={install} className="grid gap-4" noValidate>
              <div>
                <h1 ref={heading} tabIndex={-1} className="text-[1.6rem] outline-none">
                  Le site
                </h1>
                <p className="mt-1 text-muted">Ces informations alimentent les pages « Mentions légales » et « Confidentialité ».</p>
              </div>
              <TextField
                label="Adresse du site"
                type="url"
                autoComplete="off"
                spellCheck={false}
                value={site.appUrl}
                onChange={(v) => setSite({ ...site, appUrl: v })}
                hint="Remplie automatiquement : l’adresse de cette page."
                error={installFieldError(error, 'appUrl')}
                required
              />
              <TextField
                label="Éditeur du site (facultatif)"
                autoComplete="name"
                value={site.publisher}
                onChange={(v) => setSite({ ...site, publisher: v })}
                hint="Votre nom. Laissez vide si vous êtes un particulier qui préfère rester anonyme."
                error={installFieldError(error, 'legal.publisher')}
              />
              <TextField
                label="E-mail de contact"
                type="email"
                autoComplete="email"
                value={site.contactEmail}
                onChange={(v) => setSite({ ...site, contactEmail: v })}
                hint="Affiché dans les mentions légales : les utilisateurs l’emploient pour exercer leurs droits."
                error={installFieldError(error, 'legal.contactEmail')}
              />
              <TextField
                label="Hébergeur"
                autoComplete="off"
                value={site.host}
                onChange={(v) => setSite({ ...site, host: v })}
                hint="Nom, adresse et téléphone de votre hébergeur, recopiés depuis ses propres mentions légales."
                error={installFieldError(error, 'legal.host')}
              />

              <div className="border-t border-line pt-4">
                <Switch
                  checked={mailOn}
                  onChange={setMailOn}
                  label="Envoyer les e-mails « Mot de passe oublié »"
                  description="Facultatif. Sans envoi, les demandes vous parviennent dans l’administration."
                />
              </div>
              {mailOn ? (
                <div className="grid gap-4">
                  <TextField
                    label="Serveur SMTP"
                    placeholder="smtp.votre-domaine.fr"
                    autoComplete="off"
                    spellCheck={false}
                    value={mail.host}
                    onChange={(v) => setMail({ ...mail, host: v })}
                    hint="Celui de votre boîte e-mail, indiqué par votre hébergeur ou votre messagerie."
                    error={installFieldError(error, 'mail.host')}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      label="Sécurité"
                      value={mail.secure}
                      options={[
                        { value: 'ssl', label: 'SSL/TLS (port 465)' },
                        { value: 'starttls', label: 'STARTTLS (port 587)' },
                      ]}
                      onChange={(v) => setMail({ ...mail, secure: v, port: v === 'ssl' ? '465' : '587' })}
                    />
                    <TextField label="Port" inputMode="numeric" value={mail.port} onChange={(v) => setMail({ ...mail, port: v })} error={installFieldError(error, 'mail.port')} />
                  </div>
                  <TextField
                    label="Identifiant"
                    autoComplete="off"
                    spellCheck={false}
                    value={mail.user}
                    onChange={(v) => setMail({ ...mail, user: v })}
                    hint="Souvent l’adresse e-mail complète."
                    error={installFieldError(error, 'mail.user')}
                  />
                  <TextField
                    label="Mot de passe de la boîte e-mail"
                    type="password"
                    autoComplete="off"
                    value={mail.password}
                    onChange={(v) => setMail({ ...mail, password: v })}
                    error={installFieldError(error, 'mail.password')}
                  />
                  <TextField
                    label="Adresse d’expéditeur"
                    type="email"
                    autoComplete="off"
                    value={mail.from}
                    onChange={(v) => setMail({ ...mail, from: v })}
                    hint="Une adresse de votre domaine, pour ne pas finir en indésirables."
                    error={installFieldError(error, 'mail.from')}
                  />
                </div>
              ) : null}

              {general ? <Notice tone="danger">{general}</Notice> : null}
              <div className="flex justify-between gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => go(2)}>
                  Retour
                </button>
                <button type="submit" className="btn btn-primary min-h-10" disabled={busy || !site.appUrl.trim()}>
                  {busy ? 'Installation…' : 'Installer Cuvylo'}
                </button>
              </div>
            </form>
          )}
        </section>
      </main>
    </div>
  )
}

/** Fin de l'installation quand la connexion automatique n'a pas eu lieu. */
function Done({ result, heading, copied, onCopy }: { result: InstallResult; heading: RefObject<HTMLHeadingElement | null>; copied: boolean; onCopy: () => void }) {
  if (!result.written && result.envFile) {
    return (
      <>
        <div>
          <h1 ref={heading} tabIndex={-1} className="text-[1.6rem] outline-none">
            Dernière étape : le fichier de configuration
          </h1>
          <p className="mt-1 text-muted">
            Tables et compte sont prêts, mais le serveur n’a pas pu écrire sa configuration (dossier cuvylo/ non modifiable).
          </p>
        </div>
        <ol className="grid list-decimal gap-1.5 pl-5 text-[0.93rem]">
          <li>Copiez le contenu ci-dessous.</li>
          <li>
            Sur votre ordinateur, collez-le dans un fichier nommé exactement <code>.env</code> (avec le point, sans extension).
          </li>
          <li>
            Envoyez ce fichier par FTP dans le dossier <code>cuvylo/</code>, puis ouvrez la page de connexion.
          </li>
        </ol>
        <Notice tone="warn">Ce contenu donne accès à votre base : ne le partagez pas et ne le laissez pas dans un dossier public.</Notice>
        <textarea readOnly className="input min-h-48 font-mono text-xs" value={result.envFile} aria-label="Contenu du fichier .env" />
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className="btn" onClick={onCopy}>
            <IconCopy /> {copied ? 'Copié' : 'Copier'}
          </button>
          <a href="/connexion" className="btn btn-primary">
            J’ai déposé le fichier
          </a>
        </div>
      </>
    )
  }
  return (
    <>
      <div>
        <h1 ref={heading} tabIndex={-1} className="text-[1.6rem] outline-none">
          Cuvylo est installé
        </h1>
        <p className="mt-1 text-muted">
          {result.existingAccounts
            ? 'Cette base contenait déjà des comptes : ils sont conservés, aucun nouveau compte n’a été créé. Connectez-vous avec un compte existant.'
            : 'Connectez-vous avec le compte que vous venez de créer.'}
        </p>
      </div>
      <div className="flex justify-end">
        <a href="/connexion" className="btn btn-primary">
          Aller à la connexion
        </a>
      </div>
    </>
  )
}
