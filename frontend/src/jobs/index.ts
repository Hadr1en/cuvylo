import { emptyProfile, type ProfileData } from '@/domain/profile'
import { extractKeywords } from './extract'
import { analyzeMatches, corpusFromText, type JobAnalysis } from './match'

export type { Coverage, JobAnalysis, KeywordMatch, MatchSection, MatchStatus, Suggestion, SuggestionKind } from './match'
export type { ExtractedJob, Importance, JobKeyword } from './extract'
export { extractKeywords } from './extract'
export { canonicalKey, normalizeJob } from './dictionary'

/**
 * Compare une fiche de poste (texte collé) au contenu d'un CV. Déterministe, local au navigateur,
 * sans IA ni appel réseau. Le résultat est une aide à la relecture, pas une note d'éligibilité.
 */
export function analyzeJob(posting: string, data: ProfileData): JobAnalysis {
  const { title, keywords } = extractKeywords(posting)
  return analyzeMatches(title, keywords, data)
}

/** Même comparaison, avec tout le texte extrait d'un PDF (analyse publique) au lieu d'un profil structuré. */
export function analyzeJobText(posting: string, text: string): JobAnalysis {
  const { title, keywords } = extractKeywords(posting)
  return analyzeMatches(title, keywords, emptyProfile(), corpusFromText(text))
}
