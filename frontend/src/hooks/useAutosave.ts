import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api/client'

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'invalid' | 'conflict'

/** Problème de saisie localisé : `path` suit la structure des données (« experiences.0.startDate »). */
export interface Issue {
  path: string
  message: string
}

interface Options<T> {
  save: (value: T) => Promise<void>
  delay?: number
  /** Validation locale : tant qu'elle signale des problèmes, rien n'est envoyé (et rien n'est perdu). */
  validate?: (value: T) => Issue[]
  /** Clé de brouillon local : la dernière valeur non enregistrée y survit à un rechargement. */
  draftKey?: string
}

interface Draft<T> {
  savedAt: string
  value: T
}

export function readDraft<T>(key: string): Draft<T> | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Draft<T>) : null
  } catch {
    return null
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* stockage indisponible */
  }
}

function writeDraft<T>(key: string | undefined, value: T): void {
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), value } satisfies Draft<T>))
  } catch {
    /* quota dépassé ou stockage indisponible : le brouillon est une sécurité, pas une garantie */
  }
}

/**
 * Sauvegarde différée : `touch(value)` à chaque modification utilisateur.
 * - Une seule requête à la fois ; si l'utilisateur continue d'écrire pendant l'envoi,
 *   la dernière valeur repart juste après.
 * - Une valeur localement invalide n'est pas envoyée : statut `invalid` + `issues`.
 * - Un échec (réseau, session expirée…) garde la valeur pour un nouvel essai et l'écrit en brouillon local.
 * - Un 409 `conflict` (modifié ailleurs) suspend l'envoi : statut `conflict`, à résoudre par l'appelant.
 * - `flush()` attend l'envoi en cours et la file, puis échoue (`not_saved`) si tout n'est pas enregistré ;
 *   `reset()` abandonne ce qui est en attente (après une restauration de version, par exemple).
 * - Quitter l'écran envoie la modification en attente ; fermer l'onglet avec des changements non
 *   enregistrés demande confirmation.
 */
export function useAutosave<T>({ save, delay = 900, validate, draftKey }: Options<T>) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [issues, setIssues] = useState<Issue[]>([])
  const [conflict, setConflict] = useState<{ current: unknown } | null>(null)
  const latest = useRef<{ value: T } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef<Promise<void> | null>(null)
  const blocked = useRef(false)
  const mounted = useRef(true)
  const opts = useRef({ save, validate, draftKey })
  const statusRef = useRef<SaveStatus>('idle')
  // La boucle d'envoi se rappelle elle-même : on la passe par une ref.
  const runRef = useRef<() => Promise<void>>(async () => {})

  const set = useCallback((s: SaveStatus) => {
    statusRef.current = s
    if (mounted.current) setStatus(s)
  }, [])

  useEffect(() => {
    opts.current = { save, validate, draftKey }
    runRef.current = async () => {
      if (current.current || !latest.current || blocked.current) return
      const { value } = latest.current
      const problems = opts.current.validate?.(value) ?? []
      if (mounted.current) setIssues(problems)
      if (problems.length > 0) {
        writeDraft(opts.current.draftKey, value)
        set('invalid')
        return
      }
      latest.current = null
      set('saving')
      const attempt = (async () => {
        try {
          await opts.current.save(value)
          if (latest.current) set('dirty')
          else {
            set('saved')
            if (opts.current.draftKey) clearDraft(opts.current.draftKey)
          }
        } catch (e) {
          // On garde la valeur non enregistrée pour un nouvel essai.
          latest.current ??= { value }
          writeDraft(opts.current.draftKey, latest.current.value)
          if (e instanceof ApiError && e.code === 'conflict') {
            blocked.current = true
            if (mounted.current) setConflict({ current: e.current })
            set('conflict')
          } else {
            if (e instanceof ApiError && e.code === 'validation_failed' && mounted.current) {
              setIssues(Object.entries(e.fields).map(([path, message]) => ({ path, message })))
            }
            set('error')
          }
          throw e
        }
      })()
      current.current = attempt
      try {
        await attempt
      } catch {
        return
      } finally {
        current.current = null
      }
      if (latest.current && statusRef.current === 'dirty') await runRef.current()
    }
  })

  const run = useCallback(() => runRef.current(), [])

  const touch = useCallback(
    (value: T) => {
      latest.current = { value }
      if (!blocked.current) set('dirty')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void run(), delay)
    },
    [delay, run, set],
  )

  /**
   * Barrière avant une action qui dépend du dernier état enregistré (version, copie adaptée, partage) :
   * attend l'envoi en cours ET la file (une modification faite pendant l'envoi repart aussitôt), puis
   * lève une `ApiError` `not_saved` si le document n'est pas enregistré (échec, conflit, saisie invalide).
   * L'action appelante s'arrête alors au lieu de travailler sur l'ancien état du serveur.
   */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    for (;;) {
      const pending = current.current
      if (pending) {
        await pending.catch(() => undefined)
        continue
      }
      if (!latest.current || blocked.current) break
      await run()
      // Rien ne progresse (échec, validation) : inutile d'insister, on rend la main avec l'erreur.
      if (statusRef.current === 'error' || statusRef.current === 'invalid') break
    }
    const reason =
      statusRef.current === 'conflict' || blocked.current
        ? 'Ce document a été modifié ailleurs : choisissez quelle version garder avant de continuer.'
        : statusRef.current === 'invalid'
          ? 'Certaines informations sont invalides : corrigez-les avant de continuer.'
          : statusRef.current === 'error' || latest.current
            ? 'Les dernières modifications ne sont pas enregistrées (connexion ?). Réessayez avant de continuer.'
            : null
    if (reason) throw new ApiError(0, 'not_saved', reason)
  }, [run])

  /** Abandonne la valeur en attente (le document vient d'être remplacé côté serveur). */
  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    latest.current = null
    blocked.current = false
    setConflict(null)
    setIssues([])
    if (opts.current.draftKey) clearDraft(opts.current.draftKey)
    set('idle')
  }, [set])

  /** Conflit résolu par l'appelant : reprend l'envoi (avec la valeur en attente, s'il y en a une). */
  const resume = useCallback(async () => {
    blocked.current = false
    setConflict(null)
    if (latest.current) {
      set('dirty')
      await run()
    } else set('idle')
  }, [run, set])

  useEffect(() => {
    mounted.current = true
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!latest.current && !current.current) return
      if (latest.current) writeDraft(opts.current.draftKey, latest.current.value)
      e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      mounted.current = false
      window.removeEventListener('beforeunload', beforeUnload)
      if (timer.current) clearTimeout(timer.current)
      if (latest.current && !blocked.current) {
        writeDraft(opts.current.draftKey, latest.current.value)
        void run() // envoi final, sans mise à jour d'état
      }
    }
  }, [run])

  return { status, issues, conflict, touch, flush, reset, resume }
}
