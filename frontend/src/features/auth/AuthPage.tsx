import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { useInstance } from '@/hooks/useInstance'
import { errorMessage, fieldError } from '@/lib/format'
import { LegalFooter } from '@/ui/LegalFooter'
import { TextField } from '@/ui/fields'
import { IconCheck } from '@/ui/Icons'
import { InstallWizard } from './InstallWizard'
import { useSetupNeeded } from './useSetupNeeded'
import { ThemeToggle, Wordmark } from '@/ui/Shell'
import { useDocumentTitle } from '@/ui/useDocumentTitle'

const POINTS = [
  'Un profil principal, autant de CV que de candidatures.',
  'Suivi des candidatures et lettres de motivation au même endroit.',
  'Analyse de lisibilité ATS d’un PDF, même sans compte.',
  'Gratuit, sans publicité : votre e-mail sert uniquement à vous connecter.',
]

/** Mise en page commune aux écrans publics d'accès (connexion, inscription, réinitialisation). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden flex-col justify-between bg-nav p-10 text-nav-text lg:flex xl:p-14">
        <span className="text-nav-strong">
          <Wordmark inverse />
        </span>
        <div className="max-w-md">
          <p className="text-[1.75rem] font-semibold leading-snug tracking-[-0.01em] text-nav-strong">
            Rédigez, adaptez et exportez vos CV depuis un seul profil.
          </p>
          <ul className="mt-8 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3">
                <IconCheck className="mt-1 shrink-0 text-[#8fb2f4]" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <LegalFooter className="!text-nav-text [&_a:hover]:!text-nav-strong" />
      </aside>

      <main className="flex flex-col px-6 py-5 sm:px-12">
        <div className="flex items-center justify-between">
          <span className="lg:invisible">
            <Wordmark />
          </span>
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
        <LegalFooter className="pb-1 lg:hidden" />
      </main>
    </div>
  )
}

function Alert({ tone, children }: { tone: 'info' | 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`notice notice-${tone} mb-5 text-sm`}>
      {children}
    </div>
  )
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { status, login, verifyMfa, register, notice } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const { token: pathToken } = useParams()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const instance = useInstance()
  const isRegister = mode === 'register'
  useDocumentTitle(isRegister ? 'Créer un compte' : 'Connexion')

  // Lien d'invitation : /invitation/<jeton> (ou /inscription?invitation=<jeton>)
  const inviteToken = isRegister ? (pathToken ?? params.get('invitation')) : null
  const [invite, setInvite] = useState<{ state: 'checking' | 'valid' | 'invalid'; note?: string } | null>(inviteToken ? { state: 'checking' } : null)
  useEffect(() => {
    if (!inviteToken) return
    let cancelled = false
    api
      .invitation(inviteToken)
      .then((r) => !cancelled && setInvite(r.valid ? { state: 'valid', ...(r.note ? { note: r.note } : {}) } : { state: 'invalid' }))
      .catch(() => !cancelled && setInvite({ state: 'invalid' }))
    return () => {
      cancelled = true
    }
  }, [inviteToken])

  const ready = instance.status === 'ready'
  const inviteValid = invite?.state === 'valid'
  // Tant que la configuration n'est pas connue, on affiche le champ de code par prudence.
  const inviteCodeField = !inviteValid && (!ready || instance.info.registration.inviteRequired)
  const registrationClosed = ready && !instance.info.registration.open && !inviteValid
  const maintenance = ready && instance.info.maintenance === true

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  // Instance neuve (aucun compte, ou serveur sans configuration) : l'installation remplace connexion et inscription.
  const setupNeeded = useSetupNeeded()

  if (status === 'authenticated') return <Navigate to={from} replace />
  if (setupNeeded) return <Navigate to="/installation" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (mfaToken) {
        await verifyMfa(mfaToken, code.trim())
      } else if (isRegister) {
        await register({
          email: email.trim(),
          password,
          displayName: displayName.trim() || undefined,
          inviteCode: inviteCode.trim() || undefined,
          inviteToken: inviteValid && inviteToken ? inviteToken : undefined,
        })
      } else {
        const r = await login(email.trim(), password)
        if (!r.done) {
          setMfaToken(r.mfaToken)
          setPassword('')
          // Deuxième étape : le champ du code reçoit le focus dès qu'il est affiché.
          setTimeout(() => document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')?.focus(), 0)
          return
        }
      }
      navigate(from, { replace: true })
    } catch (err) {
      setError(err)
      if (!mfaToken) setPassword('')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const emailError = fieldError(error, 'email')
  const passwordError = fieldError(error, 'password')
  const general = error && !emailError && !passwordError ? errorMessage(error) : null

  if (mfaToken) {
    return (
      <AuthLayout>
        <h1 className="text-[1.6rem]">Double authentification</h1>
        <p className="mb-7 mt-1 text-muted">Saisissez le code à 6 chiffres affiché par votre application, ou l’un de vos codes de secours.</p>
        {error && !fieldError(error, 'code') ? (
          <Alert tone="danger">{fieldError(error, 'mfaToken') ? 'La vérification a expiré : reconnectez-vous.' : errorMessage(error)}</Alert>
        ) : null}
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <TextField label="Code" value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" required maxLength={20} error={fieldError(error, 'code')} />
          <button type="submit" className="btn btn-primary min-h-10" disabled={busy || code.trim().length < 6}>
            {busy ? 'Vérification…' : 'Valider'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => { setMfaToken(null); setError(null) }}>
            Revenir à la connexion
          </button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <h1 className="text-[1.6rem]">{isRegister ? 'Créer un compte' : 'Connexion'}</h1>
      <p className="mb-7 mt-1 text-muted">{isRegister ? 'Un compte suffit pour gérer tous vos CV.' : 'Retrouvez vos CV et votre profil.'}</p>

      {maintenance ? <Alert tone="warn">Le site est en maintenance. Réessayez dans quelques minutes.</Alert> : null}
      {notice === 'deleted' ? <Alert tone="ok">Votre compte et toutes ses données ont été supprimés.</Alert> : null}
      {notice === 'reset' ? <Alert tone="ok">Mot de passe modifié. Connectez-vous avec le nouveau.</Alert> : null}
      {notice === 'signedOut' && !isRegister ? <Alert tone="info">Vous êtes déconnecté.</Alert> : null}
      {invite?.state === 'invalid' ? <Alert tone="warn">Ce lien d’invitation n’est plus valable. Demandez-en un nouveau à la personne qui gère ce site.</Alert> : null}
      {inviteValid ? <Alert tone="info">Invitation valide{invite?.note ? ` : ${invite.note}` : ''}. Choisissez votre adresse et votre mot de passe.</Alert> : null}
      {isRegister && registrationClosed && invite?.state !== 'checking' ? (
        <Alert tone="warn">Les inscriptions se font sur invitation. Demandez un lien à la personne qui gère ce site.</Alert>
      ) : null}

      <form onSubmit={submit} className="grid gap-4" noValidate>
        {isRegister ? (
          <TextField label="Nom affiché (facultatif)" autoComplete="nickname" value={displayName} onChange={setDisplayName} maxLength={80} />
        ) : null}
        <TextField label="Adresse e-mail" type="email" autoComplete="email" required value={email} onChange={setEmail} error={emailError} />
        <TextField
          label="Mot de passe"
          type="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          required
          value={password}
          onChange={setPassword}
          hint={isRegister ? '12 caractères minimum. Une phrase de passe fonctionne très bien.' : undefined}
          error={passwordError}
        />
        {!isRegister ? (
          <Link to="/mot-de-passe-oublie" state={{ email: email.trim() }} className="link -mt-2 justify-self-end text-sm">
            Mot de passe oublié ?
          </Link>
        ) : null}
        {isRegister && inviteCodeField ? (
          <TextField label="Code d’invitation" hint="Remis par la personne qui gère ce site." autoComplete="off" value={inviteCode} onChange={setInviteCode} />
        ) : null}

        {general ? <Alert tone="danger">{general}</Alert> : null}

        <button type="submit" className="btn btn-primary min-h-10" disabled={busy || !email || !password}>
          {busy ? 'Patientez…' : isRegister ? 'Créer mon compte' : 'Se connecter'}
        </button>
        {isRegister ? (
          <p className="text-sm leading-relaxed text-muted">
            Gratuit. Vos données servent uniquement à rédiger vos CV et suivre vos candidatures ; votre e-mail, uniquement à vous connecter : ni
            publicité, ni newsletter, ni traceur, ni transmission à des tiers.{' '}
            <Link to="/confidentialite" className="link">
              Politique de confidentialité
            </Link>
          </p>
        ) : null}
      </form>

      <p className="mt-8 border-t border-line pt-5 text-sm text-muted">
        {isRegister ? 'Déjà un compte ?' : 'Pas encore de compte ?'}{' '}
        <Link to={isRegister ? '/connexion' : '/inscription'} className="link font-semibold">
          {isRegister ? 'Se connecter' : 'Créer un compte'}
        </Link>
      </p>
      <p className="mt-2 text-sm text-muted">
        Juste vérifier un CV ?{' '}
        <Link to="/analyser" className="link font-semibold">
          Analyser un PDF sans compte
        </Link>
      </p>
    </AuthLayout>
  )
}

/**
 * /mot-de-passe-oublie — parcours classique : l'adresse du compte reçoit un lien (1 h, usage unique) pour
 * choisir un nouveau mot de passe. Si l'instance n'envoie pas d'e-mails, la demande est transmise à la
 * personne qui gère le site. Le message affiché est le même que l'adresse corresponde à un compte ou non.
 */
export function ForgotPasswordPage() {
  const { status } = useAuth()
  const location = useLocation()
  const instance = useInstance()
  useDocumentTitle('Mot de passe oublié')
  const [email, setEmail] = useState(() => (location.state as { email?: string } | null)?.email ?? '')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const byEmail = instance.status === 'ready' && instance.info.features?.passwordResetByEmail === true

  if (status === 'authenticated') return <Navigate to="/compte" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.resetRequest(email.trim())
      setSentTo(email.trim())
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <AuthLayout>
        <h1 className="text-[1.6rem]">{byEmail ? 'Vérifiez votre boîte e-mail' : 'Demande enregistrée'}</h1>
        {byEmail ? (
          <>
            <p className="mb-6 mt-2 text-muted">
              Si un compte existe pour <strong className="font-semibold text-ink">{sentTo}</strong>, un e-mail avec un lien de réinitialisation vient d’être
              envoyé. Le lien est valable une heure et ne sert qu’une fois.
            </p>
            <p className="mb-6 text-sm text-muted">Rien reçu après quelques minutes ? Regardez dans les indésirables, puis recommencez si besoin.</p>
          </>
        ) : (
          <p className="mb-6 mt-2 text-muted">
            Cette instance n’envoie pas d’e-mails. Si un compte existe pour <strong className="font-semibold text-ink">{sentTo}</strong>, prévenez la personne
            qui gère le site : elle peut désormais vous transmettre un lien de réinitialisation, valable 24 heures.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Link to="/connexion" className="btn btn-primary">
            Retour à la connexion
          </Link>
          <button type="button" className="btn" onClick={() => setSentTo(null)}>
            Recommencer
          </button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <h1 className="text-[1.6rem]">Mot de passe oublié</h1>
      <p className="mb-7 mt-1 text-muted">
        {byEmail
          ? 'Indiquez l’adresse de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.'
          : 'Indiquez l’adresse de votre compte : la personne qui gère ce site pourra vous transmettre un lien de réinitialisation.'}
      </p>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <TextField label="Adresse e-mail" type="email" autoComplete="email" value={email} onChange={setEmail} error={fieldError(error, 'email')} required />
        {error && !fieldError(error, 'email') ? <Alert tone="danger">{errorMessage(error)}</Alert> : null}
        <button type="submit" className="btn btn-primary min-h-10" disabled={busy || !email.trim()}>
          {busy ? 'Envoi…' : byEmail ? 'Recevoir un lien' : 'Envoyer la demande'}
        </button>
      </form>
      <p className="mt-8 border-t border-line pt-5 text-sm text-muted">
        Vous vous en souvenez ?{' '}
        <Link to="/connexion" className="link font-semibold">
          Se connecter
        </Link>
      </p>
    </AuthLayout>
  )
}

/**
 * /installation — serveur sans configuration : assistant complet (base, compte, configuration écrite par le
 * serveur). Configuration déjà présente mais aucun compte : création du premier compte, protégée par le code
 * SETUP_CODE du fichier .env. L'écran se ferme définitivement dès qu'un compte existe.
 */
export function SetupPage() {
  const { status, install } = useAuth()
  const navigate = useNavigate()
  useDocumentTitle('Installation')
  const [state, setState] = useState<{ needed: boolean; configured: boolean; installer?: boolean } | null>(null)
  const [loadFailed, setLoadFailed] = useState<unknown>(null)
  const [setupCode, setSetupCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .setupStatus()
      .then((r) => !cancelled && setState(r))
      .catch((e: unknown) => !cancelled && setLoadFailed(e))
    return () => {
      cancelled = true
    }
  }, [])

  if (state?.installer) return <InstallWizard />
  if (status === 'authenticated' && !busy) return <Navigate to="/" replace />
  if (state && !state.needed) return <Navigate to="/connexion" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || password !== confirm) return
    setBusy(true)
    setError(null)
    try {
      await install({ setupCode: setupCode.trim(), email: email.trim(), password, displayName: displayName.trim() || undefined })
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  const codeError = fieldError(error, 'setupCode')
  const emailError = fieldError(error, 'email')
  const passwordError = fieldError(error, 'password')
  const general = error && !codeError && !emailError && !passwordError ? errorMessage(error) : null

  return (
    <AuthLayout>
      <h1 className="text-[1.6rem]">Installation</h1>
      <p className="mb-7 mt-1 text-muted">Créez le compte administrateur de cette instance. Cet écran disparaît dès que ce compte existe.</p>

      {loadFailed instanceof ApiError && loadFailed.code === 'code_missing' ? (
        <Alert tone="danger">
          Le dossier <code>cuvylo/</code> est introuvable sur le serveur. Envoyez-le par FTP <strong>à côté</strong> du dossier du site (à la racine FTP,
          au même niveau que <code>www/</code>), puis rechargez cette page.
        </Alert>
      ) : loadFailed ? (
        <Alert tone="danger">
          {loadFailed instanceof ApiError && loadFailed.code === 'database_unavailable'
            ? 'La base de données ne répond pas : vérifiez ses accès dans le fichier cuvylo/.env, puis rechargez.'
            : 'Le serveur ne répond pas correctement. Le journal d’erreurs de votre hébergeur indique la cause (lignes « cuvylo »).'}
        </Alert>
      ) : null}
      {state === null && !loadFailed ? (
        <p role="status" className="text-muted">
          Vérification…
        </p>
      ) : null}
      {state && !state.configured ? (
        <Alert tone="warn">
          Ajoutez une ligne <code>SETUP_CODE=…</code> (16 caractères au moins, choisis par vous) dans le fichier <code>.env</code> du serveur, puis rechargez
          cette page. Ce code empêche quelqu’un d’autre de créer le compte administrateur avant vous.
        </Alert>
      ) : null}

      {state?.configured ? (
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <TextField
            label="Code d’installation"
            hint="La valeur de SETUP_CODE dans le fichier .env."
            type="password"
            autoComplete="off"
            value={setupCode}
            onChange={setSetupCode}
            error={codeError}
            required
          />
          <TextField label="Nom affiché (facultatif)" autoComplete="nickname" value={displayName} onChange={setDisplayName} maxLength={80} />
          <TextField label="Adresse e-mail" type="email" autoComplete="email" value={email} onChange={setEmail} error={emailError} required />
          <TextField
            label="Mot de passe"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            hint="12 caractères minimum."
            error={passwordError}
            required
          />
          <TextField
            label="Confirmer le mot de passe"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
            error={confirm && password !== confirm ? 'Les deux saisies diffèrent.' : undefined}
            required
          />
          {general ? <Alert tone="danger">{general}</Alert> : null}
          <button type="submit" className="btn btn-primary min-h-10" disabled={busy || !setupCode || !email || password.length < 12 || password !== confirm}>
            {busy ? 'Création…' : 'Créer le compte administrateur'}
          </button>
          <p className="text-sm text-muted">
            Ensuite, invitez vos proches depuis Administration → Inviter. Vous pouvez vider SETUP_CODE dans le fichier .env : il ne sert plus.
          </p>
        </form>
      ) : null}
    </AuthLayout>
  )
}

/** /reinitialisation/:token — lien remis par l'administrateur (valable 24 h, usage unique). */
export function ResetPasswordPage() {
  const { token = '' } = useParams()
  const { setNotice } = useAuth()
  const navigate = useNavigate()
  useDocumentTitle('Nouveau mot de passe')
  const [valid, setValid] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .resetCheck(token)
      .then((r) => !cancelled && setValid(r.valid))
      .catch(() => !cancelled && setValid(false))
    return () => {
      cancelled = true
    }
  }, [token])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || password !== confirm) return
    setBusy(true)
    setError(null)
    try {
      await api.resetPassword(token, password)
      setNotice('reset')
      navigate('/connexion', { replace: true })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const mismatch = confirm.length > 0 && password !== confirm
  return (
    <AuthLayout>
      <h1 className="text-[1.6rem]">Nouveau mot de passe</h1>
      {valid === null ? (
        <p role="status" className="mt-3 text-muted">
          Vérification du lien…
        </p>
      ) : !valid ? (
        <div className="mt-5">
          <Alert tone="warn">Ce lien n’est plus valable : il a déjà servi, a expiré, ou un lien plus récent a été envoyé.</Alert>
          <div className="flex flex-wrap gap-2">
            <Link to="/mot-de-passe-oublie" className="btn btn-primary">
              Demander un nouveau lien
            </Link>
            <Link to="/connexion" className="btn">
              Retour à la connexion
            </Link>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-7 mt-1 text-muted">Toutes les sessions ouvertes seront fermées.</p>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <TextField label="Nouveau mot de passe" type="password" autoComplete="new-password" value={password} onChange={setPassword} hint="12 caractères minimum." error={fieldError(error, 'password')} required />
            <TextField label="Confirmer" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={mismatch ? 'Les deux saisies diffèrent.' : undefined} required />
            {error && !fieldError(error, 'password') ? <Alert tone="danger">{errorMessage(error)}</Alert> : null}
            <button type="submit" className="btn btn-primary min-h-10" disabled={busy || password.length < 12 || password !== confirm}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  )
}
