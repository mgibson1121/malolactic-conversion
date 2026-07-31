import type { CriticScore, RetailerReview } from '@shared/types'

// Deduped by publication — first occurrence wins. Carries the full citation
// through (score, drinking_window, vintage_character, deal) rather than
// truncating to {publication, score} — those Phase 8 fields are the whole
// point of showing a citation instead of just a bare number.
export function getDedupedCriticScores(reviewData: RetailerReview[] | null | undefined): CriticScore[] {
  const seen = new Set<string>()
  const scores: CriticScore[] = []
  for (const retailer of reviewData ?? []) {
    for (const s of retailer.critic_scores) {
      if (seen.has(s.publication)) continue
      seen.add(s.publication)
      scores.push(s)
    }
  }
  return scores
}
