import type { CvKind, CvSettings } from '@/domain/cv'
import type { ProfileData } from '@/domain/profile'

export interface User {
  id: string
  email: string
  displayName: string | null
  createdAt: string
  /** Présents depuis la v2 (GET /auth/me). */
  isAdmin?: boolean
  mfaEnabled?: boolean
}

export interface CvSummary {
  id: string
  title: string
  kind: CvKind
  template: CvSettings['template']
  createdAt: string
  updatedAt: string
}

export interface Cv extends CvSummary {
  settings: CvSettings
  data: ProfileData
  revision?: number
}

export type VersionKind = 'manual' | 'auto' | 'restore'

export interface VersionSummary {
  id: string
  label: string
  kind?: VersionKind
  createdAt: string
}

export interface VersionDetail extends VersionSummary {
  settings: CvSettings
  data: ProfileData
}

/** Informations publiques de l'instance (GET /api/instance). */
export interface InstanceInfo {
  registration: { open: boolean; inviteRequired: boolean }
  legal: {
    publisher: string | null
    contactEmail: string | null
    host: string | null
    securityEmail: string | null
    policyVersion: string
  }
  retention: { sessionIdleMinutes: number; sessionMaxDays: number; loginAttemptsHours: number }
  maintenance?: boolean
  features?: { registrationByInvite?: boolean; shares?: boolean; mfa?: boolean; passwordResetByEmail?: boolean }
}

export interface SessionInfo {
  id: string
  device: string
  createdAt: string
  lastSeenAt: string
  current: boolean
}

export interface Usage {
  bytes: number
  limitBytes: number
  cvs: number
  versions: number
  letters: number
  applications: number
  shares?: number
}

export interface Share {
  id: string
  slug: string
  url: string
  createdAt: string
  expiresAt: string | null
  views: number
}

export interface PublicCv {
  title: string
  settings: CvSettings
  data: ProfileData
  sharedAt: string
}

export const APPLICATION_STATUSES = ['draft', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

export interface ApplicationInput {
  company: string
  position: string
  url: string
  posting: string
  cvId: string | null
  status: ApplicationStatus
  appliedAt: string | null
  nextActionAt: string | null
  notes: string
}

export interface Application extends ApplicationInput {
  /** Listes : le texte d'annonce n'est pas renvoyé, seulement sa présence. */
  hasPosting?: boolean
  id: string
  createdAt: string
  updatedAt: string
  revision: number
}

export interface LetterData {
  recipient: { name: string; company: string; address: string }
  subject: string
  opening: string
  paragraphs: string[]
  closing: string
  signature: string
  place: string
  date: string
}

export interface LetterSettings {
  template: CvSettings['template']
  accent: string
  locale: CvSettings['locale']
}

export interface LetterSummary {
  id: string
  title: string
  cvId: string | null
  createdAt: string
  updatedAt: string
}

export interface Letter extends LetterSummary {
  settings: LetterSettings
  data: LetterData
  revision: number
}

export interface AdminUser {
  id: string
  email: string
  displayName: string | null
  createdAt: string
  lastLoginAt: string | null
  bytes: number
  cvs: number
  mfaEnabled: boolean
  isAdmin?: boolean
  /** Demande « Mot de passe oublié » en cours (7 jours) : seule condition pour générer un lien. */
  resetRequestedAt?: string | null
}

export interface AdminOverview {
  users: AdminUser[]
  totals: { users: number; cvs: number; versions: number; bytes: number }
  databaseBytes: number | null
}

export interface Invitation {
  id: string
  note: string
  createdAt: string
  expiresAt: string
  usedAt: string | null
  usedBy?: string | null
  status?: 'pending' | 'used' | 'expired'
  url?: string
}

/** Assistant d'installation (serveur sans configuration) : vérifications de l'hébergement. */
export interface InstallCheck {
  id: string
  ok: boolean
  detail?: string
}

export interface InstallDatabase {
  host: string
  name: string
  user: string
  password: string
}

export interface InstallInput {
  appUrl: string
  database: InstallDatabase
  admin: { email: string; password: string; displayName?: string }
  legal?: { publisher?: string; contactEmail?: string; host?: string }
  mail?: { host: string; port: number; secure: 'ssl' | 'starttls'; user: string; password: string; from: string }
}

/** `envFile` : contenu à déposer à la main quand le serveur n'a pas pu écrire le fichier. */
export interface InstallResult {
  written: boolean
  existingAccounts: boolean
  envFile?: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    /** État serveur renvoyé avec un 409 `conflict`. */
    readonly current: unknown = undefined,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

let csrfToken: string | null = null

async function fetchCsrf(): Promise<string> {
  const res = await fetch('/api/csrf', { credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status, 'csrf_unavailable', 'Jeton CSRF indisponible')
  const body = (await res.json()) as { csrfToken: string }
  csrfToken = body.csrfToken
  return csrfToken
}

/** À appeler après login/logout : le serveur renouvelle le jeton avec la session. */
export function resetCsrf(): void {
  csrfToken = null
}

/**
 * Session expirée pendant l'utilisation : l'application affiche une fenêtre de reconnexion
 * au lieu de perdre la page en cours. Les routes d'authentification ne déclenchent pas l'évènement.
 */
export const UNAUTHORIZED_EVENT = 'cuvylo:unauthorized'
const SILENT_401 = ['/auth/me', '/auth/login', '/auth/mfa', '/auth/register', '/account']

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; fields?: Record<string, string>; current?: unknown }
      current?: unknown
    }
    return new ApiError(
      res.status,
      body.error?.code ?? 'error',
      body.error?.message ?? res.statusText,
      body.error?.fields,
      body.error?.current ?? body.current,
    )
  } catch {
    // Réponse non JSON : un 403 vient alors du pare-feu de l'hébergeur (ModSecurity), pas de l'application.
    const code = res.status === 413 ? 'payload_too_large' : res.status === 403 ? 'blocked' : 'error'
    return new ApiError(res.status, code, res.statusText || 'Erreur réseau')
  }
}

async function request<T>(method: Method, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json'
    headers['X-CSRF-Token'] = csrfToken ?? (await fetchCsrf())
  }
  // Les pare-feu des mutualisés (ModSecurity, par exemple) refusent souvent PUT et DELETE : envoi en POST,
  // la méthode voulue passe dans X-HTTP-Method-Override (le serveur l'applique, CSRF compris).
  if (method === 'PUT' || method === 'DELETE') headers['X-HTTP-Method-Override'] = method

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: method === 'PUT' || method === 'DELETE' ? 'POST' : method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'network', 'Impossible de joindre le serveur')
  }

  if (res.status === 204) return undefined as T
  if (!res.ok) {
    const err = await parseError(res)
    // Jeton CSRF périmé : on le renouvelle une fois et on rejoue.
    if (err.status === 403 && err.code === 'forbidden' && method !== 'GET' && !retried) {
      csrfToken = null
      return request<T>(method, path, body, true)
    }
    if (err.status === 401 && !SILENT_401.some((p) => path === p) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    }
    throw err
  }
  return (await res.json()) as T
}

/** Assistant d'installation : ni session ni jeton CSRF à ce stade (le serveur impose la même origine). */
async function installRequest<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'network', 'Impossible de joindre le serveur')
  }
  if (res.status === 204) return undefined as T
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as T
}

const enc = encodeURIComponent

export type LoginResult = { user: User; csrfToken?: string } | { mfaRequired: true; mfaToken: string }

export const api = {
  health: () => request<{ status: string }>('GET', '/health'),
  instance: () => request<InstanceInfo>('GET', '/instance'),

  /** Export complet du compte (droit à la portabilité) : objet JSON prêt à être téléchargé. */
  exportAccount: () => request<Record<string, unknown>>('GET', '/account/export'),
  /** Suppression définitive : le mot de passe est redemandé côté serveur. */
  async deleteAccount(password: string) {
    await request<void>('DELETE', '/account', { password })
    resetCsrf()
  },
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('POST', '/account/password', { currentPassword, newPassword }),
  listSessions: () => request<{ sessions: SessionInfo[] }>('GET', '/account/sessions'),
  revokeSession: (id: string) => request<void>('DELETE', `/account/sessions/${enc(id)}`),
  revokeOtherSessions: () => request<void>('POST', '/account/sessions/revoke-others'),
  totpSetup: () => request<{ secret: string; otpauthUri: string }>('POST', '/account/totp/setup'),
  totpEnable: (code: string) => request<{ recoveryCodes: string[] }>('POST', '/account/totp/enable', { code }),
  totpDisable: (password: string) => request<void>('POST', '/account/totp/disable', { password }),
  usage: () => request<Usage>('GET', '/account/usage'),

  me: () => request<{ user: User }>('GET', '/auth/me'),
  async register(input: { email: string; password: string; displayName?: string | undefined; inviteCode?: string | undefined; inviteToken?: string | undefined }) {
    const r = await request<{ user: User; csrfToken?: string }>('POST', '/auth/register', input)
    // La connexion fait tourner le jeton CSRF (lié à la session) : on adopte celui de la réponse.
    csrfToken = r.csrfToken ?? null
    return r
  },
  async login(input: { email: string; password: string }): Promise<LoginResult> {
    const r = await request<LoginResult>('POST', '/auth/login', input)
    if ('user' in r) csrfToken = r.csrfToken ?? null
    return r
  },
  async mfa(mfaToken: string, code: string) {
    const r = await request<{ user: User; csrfToken?: string }>('POST', '/auth/mfa', { mfaToken, code })
    csrfToken = r.csrfToken ?? null
    return r
  },
  async logout() {
    await request<void>('POST', '/auth/logout')
    resetCsrf()
  },
  invitation: (token: string) => request<{ valid: boolean; note?: string }>('GET', `/auth/invitation/${enc(token)}`),
  resetCheck: (token: string) => request<{ valid: boolean }>('GET', `/auth/reset/${enc(token)}`),
  resetPassword: (token: string, password: string) => request<void>('POST', '/auth/reset', { token, password }),
  /** « Mot de passe oublié » : réponse identique que le compte existe ou non. */
  resetRequest: (email: string) => request<void>('POST', '/auth/reset-request', { email }),

  /**
   * Installation : `needed` tant qu'aucun compte n'existe ; `configured` si SETUP_CODE est défini ;
   * `installer` quand le serveur n'a encore aucune configuration (assistant complet).
   */
  setupStatus: () => request<{ needed: boolean; configured: boolean; installer?: boolean }>('GET', '/setup'),
  install: {
    status: () => request<{ checks: InstallCheck[] }>('GET', '/install'),
    testDatabase: (database: InstallDatabase) => installRequest<void>('/install/database', { database }),
    run: (input: InstallInput) => installRequest<InstallResult>('/install', input),
  },
  async setup(input: { setupCode: string; email: string; password: string; displayName?: string | undefined }) {
    const r = await request<{ user: User; csrfToken?: string }>('POST', '/setup', input)
    csrfToken = r.csrfToken ?? null
    return r
  },

  getProfile: () => request<{ data: ProfileData; updatedAt: string; revision?: number }>('GET', '/profile'),
  putProfile: (data: ProfileData, revision?: number) =>
    request<{ data: ProfileData; updatedAt: string; revision?: number }>('PUT', '/profile', revision === undefined ? { data } : { data, revision }),

  listCvs: () => request<{ cvs: CvSummary[] }>('GET', '/cvs'),
  createCv: (input: {
    title: string
    kind?: CvKind
    source?: { type: 'profile' } | { type: 'cv'; id: string }
    settings?: CvSettings
    data?: ProfileData
  }) => request<{ cv: Cv }>('POST', '/cvs', input),
  getCv: (id: string) => request<{ cv: Cv }>('GET', `/cvs/${enc(id)}`),
  putCv: (id: string, input: { title: string; settings: CvSettings; data: ProfileData; revision?: number }) =>
    request<{ cv: Cv }>('PUT', `/cvs/${enc(id)}`, input),
  deleteCv: (id: string) => request<void>('DELETE', `/cvs/${enc(id)}`),

  listVersions: (id: string) => request<{ versions: VersionSummary[] }>('GET', `/cvs/${enc(id)}/versions`),
  getVersion: (id: string, versionId: string) => request<{ version: VersionDetail }>('GET', `/cvs/${enc(id)}/versions/${enc(versionId)}`),
  createVersion: (id: string, label: string) => request<{ version: VersionSummary }>('POST', `/cvs/${enc(id)}/versions`, { label }),
  restoreVersion: (id: string, versionId: string) => request<{ cv: Cv }>('POST', `/cvs/${enc(id)}/versions/${enc(versionId)}/restore`),

  listShares: (cvId: string) => request<{ shares: Share[] }>('GET', `/cvs/${enc(cvId)}/shares`),
  createShare: (cvId: string, expiresInDays: number | null) => request<{ share: Share }>('POST', `/cvs/${enc(cvId)}/shares`, { expiresInDays }),
  revokeShare: (id: string) => request<void>('DELETE', `/shares/${enc(id)}`),
  publicCv: (slug: string) => request<PublicCv>('GET', `/public/cv/${enc(slug)}`),

  listApplications: () => request<{ applications: Application[] }>('GET', '/applications'),
  createApplication: (input: ApplicationInput) => request<{ application: Application }>('POST', '/applications', input),
  getApplication: (id: string) => request<{ application: Application }>('GET', `/applications/${enc(id)}`),
  putApplication: (id: string, input: ApplicationInput & { revision?: number }) =>
    request<{ application: Application }>('PUT', `/applications/${enc(id)}`, input),
  deleteApplication: (id: string) => request<void>('DELETE', `/applications/${enc(id)}`),

  listLetters: () => request<{ letters: LetterSummary[] }>('GET', '/letters'),
  createLetter: (input: { title: string; cvId: string | null; settings: LetterSettings; data: LetterData }) =>
    request<{ letter: Letter }>('POST', '/letters', input),
  getLetter: (id: string) => request<{ letter: Letter }>('GET', `/letters/${enc(id)}`),
  putLetter: (id: string, input: { title: string; cvId: string | null; settings: LetterSettings; data: LetterData; revision?: number }) =>
    request<{ letter: Letter }>('PUT', `/letters/${enc(id)}`, input),
  deleteLetter: (id: string) => request<void>('DELETE', `/letters/${enc(id)}`),

  admin: {
    overview: () => request<AdminOverview>('GET', '/admin/overview'),
    /** Réglages enregistrés en base, prioritaires sur le fichier .env. */
    settings: () => request<{ registrationOpen: boolean }>('GET', '/admin/settings'),
    updateSettings: (input: { registrationOpen: boolean }) => request<{ registrationOpen: boolean }>('PUT', '/admin/settings', input),
    invitations: () => request<{ invitations: Invitation[] }>('GET', '/admin/invitations'),
    createInvitation: (note: string, expiresInDays: number) =>
      request<{ invitation: Invitation & { url: string } }>('POST', '/admin/invitations', { note, expiresInDays }),
    deleteInvitation: (id: string) => request<void>('DELETE', `/admin/invitations/${enc(id)}`),
    resetLink: (userId: string) => request<{ url: string; expiresAt: string }>('POST', `/admin/users/${enc(userId)}/reset-link`),
    revokeSessions: (userId: string) => request<void>('POST', `/admin/users/${enc(userId)}/revoke-sessions`),
    deleteUser: (userId: string, password: string) => request<void>('DELETE', `/admin/users/${enc(userId)}`, { password }),
  },
}
