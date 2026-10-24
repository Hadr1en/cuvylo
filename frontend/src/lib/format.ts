import { ApiError } from '@/api/client'

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })

/** "2026-10-24T09:30:00Z" → "il y a 3 minutes". */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = Math.round((t - now) / 1000)
  const abs = Math.abs(s)
  if (abs < 45) return "à l'instant"
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day')
  return rtf.format(Math.round(s / (86400 * 30)), 'month')
}

/** Message utilisateur pour une erreur d'API : jamais de détail technique brut. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'unauthenticated':
        return 'E-mail ou mot de passe incorrect.'
      case 'rate_limited':
        return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.'
      case 'registration_closed':
        return 'Les inscriptions sont fermées sur cette instance.'
      case 'validation_failed':
        return 'Certaines informations sont invalides.'
      case 'network':
        return 'Impossible de joindre le serveur. Vérifiez votre connexion.'
      case 'conflict':
        return e.message || 'Opération impossible dans l’état actuel.'
      case 'payload_too_large':
        return 'Le contenu est trop volumineux.'
      case 'quota_exceeded':
        return 'Espace de stockage du compte plein. Supprimez d’anciens CV ou versions.'
      case 'blocked':
        return 'Requête refusée par le pare-feu de l’hébergeur. Réessayez ; si cela persiste, prévenez la personne qui gère le site (journal d’erreurs : lignes « ModSecurity »).'
      case 'maintenance':
        return 'Le site est en maintenance. Réessayez dans quelques minutes.'
      case 'invalid_code':
      case 'mfa_invalid':
        return 'Code incorrect ou expiré.'
      case 'invalid_password':
        return 'Mot de passe incorrect.'
      case 'invitation_invalid':
        return 'Ce lien d’invitation n’est plus valable.'
      case 'not_found':
        return 'Élément introuvable (supprimé ou lien expiré).'
      default:
        return e.status >= 500 ? 'Erreur du serveur. Réessayez dans un instant.' : e.message || 'Une erreur est survenue.'
    }
  }
  return 'Une erreur est survenue.'
}

const dateFmt = new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** "2026-10-24T09:30:00Z" → "24 oct. 2026" (ou avec l'heure). */
export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return (withTime ? dateTimeFmt : dateFmt).format(t)
}

/** 1536 → "1,5 Ko". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`
  const units = ['Ko', 'Mo', 'Go']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toLocaleString('fr', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`
}

export function fieldError(e: unknown, field: string): string | undefined {
  if (!(e instanceof ApiError)) return undefined
  const code = e.fields[field]
  if (!code) return undefined
  const map: Record<string, string> = {
    invalid_email: 'Adresse e-mail invalide.',
    already_registered: 'Un compte existe déjà avec cette adresse.',
    too_short: 'Trop court (12 caractères minimum).',
    required: 'Champ obligatoire.',
    invalid_password: 'Mot de passe incorrect.',
    too_long: 'Trop long.',
    invalid: 'Valeur invalide.',
    invalid_code: 'Code incorrect ou expiré.',
    invalid_token: 'Vérification expirée : reconnectez-vous.',
    invalid_image: 'Image JPEG ou PNG attendue.',
    out_of_range: 'Valeur hors limites.',
    same_password: 'Le nouveau mot de passe doit être différent de l’actuel.',
  }
  return map[code] ?? 'Valeur invalide.'
}
