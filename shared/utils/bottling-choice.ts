import type { BottlingChoice, RetailerPrice, WineEntry } from '../types'
import { bottlingDifference, bottlingWineOf, isExactBottling, type BottlingWine } from './bottling-difference'
import { bottlingOptions, bottlingSignature } from './bottling-prompt'
import { identityKey } from './wine-match'

/** The wine fields this answer can change. */
export interface BottlingChoiceUpdates {
  vineyard?: string | null
  cuvee?: string | null
  bottling_plain: boolean | null
  bottling_prompt_dismissed: string
}

/** Why an answer cannot be applied. */
export class BottlingChoiceError extends Error {}

const clean = (name: string) => name.trim().replace(/\s+/g, ' ')

/**
 * The wine fields "Which bottling is yours?" writes (Phase 12.2 WI-2.5):
 * a vineyard or cuvée name, or the plain flag. Whatever the answer — including
 * "Not sure" — the signature of the modifiers just shown is stored, so the
 * prompt comes back only for *different* modifiers.
 *
 * "Plain" is refused for a wine that records a vineyard or cuvée: the answer
 * would contradict the row, and silently clearing the developer's own data is
 * not this endpoint's job (clear it in Edit first).
 */
export function bottlingChoiceUpdates(wine: WineEntry, choice: BottlingChoice): BottlingChoiceUpdates {
  const shown = bottlingOptions({ wine: bottlingWineOf(wine), price_data: wine.price_data, review_data: wine.review_data })
  // The modifiers just shown, plus the one the developer named: after an
  // answer the others are simply other bottlings, not a question.
  const named = choice.choice === 'vineyard' || choice.choice === 'cuvee' ? clean(choice.name).toLowerCase() : null
  const signature = [bottlingSignature(shown), named].filter(Boolean).join('|')
  switch (choice.choice) {
    case 'not_sure':
      return { bottling_plain: wine.bottling_plain ?? null, bottling_prompt_dismissed: signature }
    case 'plain':
      if (wine.vineyard || wine.cuvee) {
        throw new BottlingChoiceError('This wine records a vineyard or cuvée. Clear it in Edit before choosing "Plain".')
      }
      return { bottling_plain: true, bottling_prompt_dismissed: signature }
    case 'vineyard':
      return { vineyard: clean(choice.name), bottling_plain: null, bottling_prompt_dismissed: signature }
    case 'cuvee':
      return { cuvee: clean(choice.name), bottling_plain: null, bottling_prompt_dismissed: signature }
  }
}

/**
 * Re-scores the stored listings against the wine as it now stands — a local
 * judgement from each listing's stored title, **no network call**. A listing
 * that names a different bottling (an extra or a missing modifier) is marked
 * `outside_bottling` and so leaves the aggregates; it stays in the list,
 * labelled. A listing stored without its title cannot be judged and keeps
 * whatever it had. `mark` false (the "Not sure" answer) refreshes the labels
 * only and excludes nothing.
 */
export function rescoreListings(retailers: RetailerPrice[], wine: BottlingWine, mark: boolean): RetailerPrice[] {
  return retailers.map(r => {
    if (!r.listing_title) return r
    const d = bottlingDifference({ title: r.listing_title }, wine)
    const next: RetailerPrice = { ...r, bottling_difference: { extra: d.extra, missing: d.missing } }
    if (mark) next.outside_bottling = !isExactBottling(d)
    return next
  })
}

/** The identity stamp stored enrichment carries after a local re-score: it now reflects this wine. */
export function restampedIdentity(wine: WineEntry, updates: Partial<WineEntry>): string {
  return identityKey({ ...wine, ...updates })
}
