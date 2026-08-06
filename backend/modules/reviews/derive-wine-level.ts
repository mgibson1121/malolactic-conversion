import type { CriticDrinkingWindow, DrinkingWindow, FieldProvenance, RetailerReview, VintageRating } from '@shared/types'

export interface DeriveWineLevelInput {
  drinking_window_source: FieldProvenance
  vintage_rating_source: FieldProvenance
}

export interface DeriveWineLevelUpdates {
  drinking_window?: DrinkingWindow | null
  drinking_window_source?: FieldProvenance
  vintage_rating?: VintageRating | null
  vintage_rating_source?: FieldProvenance
}

function yearToIsoDate(year: number): string {
  return `${year}-01-01`
}

function windowsEqual(a: CriticDrinkingWindow, b: CriticDrinkingWindow): boolean {
  return a.start === b.start && a.end === b.end
}

/**
 * Reduces a list of values down to a single agreeing one, applying the
 * non-blending rule (CLAUDE.md §15): zero values found means no signal
 * either way (`undefined` — caller should leave the existing field alone,
 * so a transient extraction gap doesn't clobber a previously-derived value);
 * exactly one distinct value is the value to use; more than one distinct
 * value is an explicit disagreement (`null` — caller should clear a stale
 * single-critic derivation from an earlier, less-complete run).
 *
 * OPEN QUESTION (raised 2026-08-04, deliberately not changed here — it needs
 * a product decision, not a code one). Unanimity was a reasonable no-blending
 * guard when coverage was thin, but it inverts as coverage improves: with 12
 * retailers and an open-web fallback, *more* data makes the field *less*
 * likely to populate. Mangot carries 12 critic scores and derived
 * vintage_rating 'very_good' from a single critic, while any wine where two
 * critics differ at all gets null. The vintage gate above removes the worst
 * of the noise feeding this, but not the rule itself. Revisit before the UI
 * depends on drinking_window / vintage_rating — see
 * docs/specs/2026-08-04-phase-9.1-identity-matching-remediation.md WI-3.
 */
function pickSingleAgreeing<T>(values: T[], equals: (a: T, b: T) => boolean): T | null | undefined {
  if (values.length === 0) return undefined
  const distinct: T[] = []
  for (const v of values) {
    if (!distinct.some((d) => equals(d, v))) distinct.push(v)
  }
  return distinct.length === 1 ? distinct[0] : null
}

/**
 * Computes wine-level drinking_window/vintage_rating updates from review_data,
 * per Phase 8: populate only when exactly one critic across all retailers
 * states a value; disagreement leaves the field null; a manually-set value
 * (drinking_window_source/vintage_rating_source === 'manual') is never
 * touched by this function at all, regardless of what review_data says.
 * Pure function — the caller (routes/wines.ts) merges the returned object
 * into the update passed to storage.updateWine.
 */
export function deriveWineLevelFields(
  reviewData: RetailerReview[],
  current: DeriveWineLevelInput
): DeriveWineLevelUpdates {
  const updates: DeriveWineLevelUpdates = {}
  // Phase 9.1 — only scores from a page confirmed to be *this* vintage may
  // derive wine-level fields. drinking_window and vintage_rating are
  // statements about a specific year: a 2020's drink-from window and a 2020's
  // vintage character are simply not facts about the 2022, however good the
  // source. The wrong-vintage scores are still stored and still shown,
  // badged with their gap — this gate gets them out of derivation, not out
  // of the record. 'unknown' is excluded alongside 'mismatch': a page that
  // never stated a year cannot establish which year these fields describe.
  //
  // Mangot derived vintage_rating 'very_good' from a single critic, on a set
  // that included a wrong-vintage source. This removes the second half of
  // that problem; the first half is pickSingleAgreeing below.
  const allScores = reviewData
    .filter((r) => r.match.vintage === 'match')
    .flatMap((r) => r.critic_scores)

  if (current.drinking_window_source !== 'manual') {
    const windows = allScores
      .map((s) => s.drinking_window)
      .filter((w): w is CriticDrinkingWindow => w !== null && w.start !== null && w.end !== null)
    const picked = pickSingleAgreeing(windows, windowsEqual)
    if (picked !== undefined) {
      updates.drinking_window = picked ? { start: yearToIsoDate(picked.start as number), end: yearToIsoDate(picked.end as number) } : null
      updates.drinking_window_source = 'derived'
    }
  }

  if (current.vintage_rating_source !== 'manual') {
    const characters = allScores
      .map((s) => s.vintage_character)
      .filter((v): v is VintageRating => v !== null)
    const picked = pickSingleAgreeing(characters, (a, b) => a === b)
    if (picked !== undefined) {
      updates.vintage_rating = picked
      updates.vintage_rating_source = 'derived'
    }
  }

  return updates
}
