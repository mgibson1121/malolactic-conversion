import type { BottlingAnswer, BottlingOption, BottlingPrompt, PriceData, RetailerReview, ReviewLadder } from '../types'
import { bottlingDifference, modifierName, type BottlingWine } from './bottling-difference'
import { reviewBottlingDifference } from './review-ladder'

export interface PromptInput {
  wine: BottlingWine
  price_data: PriceData | null | undefined
  review_data: RetailerReview[] | null | undefined
  review_ladder: ReviewLadder
  bottling_plain?: boolean | null
  bottling_prompt_dismissed?: string | null
}

/**
 * "Listings name different bottlings — which is yours?" (Phase 12.2 WI-2.5).
 * Derived on every read, never stored.
 *
 * Triggers (any): at least two distinct modifiers appear in the results for
 * the same producer + appellation + vintage; the counted prices split by the
 * 2.5x rule (D10); or review matching reached Tier 3a/3b. It does not show
 * when the developer answered "Plain", and "Not sure" / any answer stores the
 * modifier signature so only a refresh that brings *different* modifiers asks
 * again. Presents one option per modifier found, with the evidence for it.
 */
export function bottlingOptions(input: Pick<PromptInput, 'wine' | 'price_data' | 'review_data'>): BottlingOption[] {
  const options = new Map<string, BottlingOption>()
  const option = (words: string[]): BottlingOption => {
    const name = modifierName(words)
    let o = options.get(name)
    if (!o) {
      o = { name, words, retailers: [], critics: [], price_range: null, links: [], count: 0 }
      options.set(name, o)
    }
    return o
  }

  for (const r of input.price_data?.retailers ?? []) {
    // Judged against the wine as it is now, like the review pages below — the
    // difference stored at fetch time goes stale the moment Edit or an answer
    // changes the vineyard or cuvée (Phase 12.4 WI-4). A listing stored
    // without its title keeps what it has.
    const extra = r.listing_title ? bottlingDifference({ title: r.listing_title }, input.wine).extra : (r.bottling_difference?.extra ?? [])
    if (extra.length === 0) continue
    const o = option(extra)
    o.count += 1
    if (!o.retailers.includes(r.name)) o.retailers.push(r.name)
    if (r.url && !o.links.some(l => l.url === r.url)) o.links.push({ name: r.name, url: r.url })
    const price = r.price_per_750 ?? r.price
    if (price != null) {
      o.price_range = o.price_range
        ? { min: Math.min(o.price_range.min, price), max: Math.max(o.price_range.max, price) }
        : { min: price, max: price }
    }
  }

  for (const review of input.review_data ?? []) {
    const extra = reviewBottlingDifference(review, input.wine).extra
    if (extra.length === 0) continue
    const o = option(extra)
    o.count += 1
    if (!o.retailers.includes(review.name)) o.retailers.push(review.name)
    if (!o.links.some(l => l.url === review.product_url)) o.links.push({ name: review.name, url: review.product_url })
    for (const s of review.critic_scores ?? []) if (!o.critics.includes(s.publication)) o.critics.push(s.publication)
  }

  return [...options.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** The modifiers a prompt was raised for, as a stable string (stored when answered or dismissed). */
export function bottlingSignature(options: BottlingOption[]): string {
  return options.map(o => o.name.toLowerCase()).sort().join('|')
}

export function buildBottlingPrompt(input: PromptInput): BottlingPrompt | null {
  if (input.bottling_plain) return null
  const list = bottlingOptions(input)

  const reasons: BottlingPrompt['reasons'] = []
  if (list.length >= 2) reasons.push('modifiers')
  if (input.price_data?.headline_basis === 'ambiguous') reasons.push('price_split')
  if (input.review_ladder.tier === '3a' || input.review_ladder.tier === '3b') reasons.push('tier3')
  if (reasons.length === 0) return null

  const signature = bottlingSignature(list)
  // Asked and answered (or dismissed): quiet until a refresh brings a word that
  // was not among those shown then. Compared word by word, not by option name
  // (Phase 12.4 WI-4): an answer changes the wine's identity, which regroups
  // the same leftover words into differently named options — Domaine du
  // Pavillon's "Name Albert Bichot Rugiens Guest" came back as "Name Rugiens
  // Guest" the moment it was answered, and the banner with it.
  if (answeredFor(input.bottling_prompt_dismissed, list)) return null

  return { reasons, options: list, signature }
}

function answeredFor(dismissed: string | null | undefined, options: BottlingOption[]): boolean {
  if (dismissed == null) return false
  const known = new Set(dismissed.split(/[|\s]+/).filter(Boolean))
  return options.every(o => o.name.toLowerCase().split(/\s+/).every(w => known.has(w)))
}

/**
 * The quiet "Bottling: Les Rugiens · Change" row (Phase 12.4 WI-4): the wine
 * was answered — Plain, or a vineyard / cuvée it now records — and nothing new
 * is being asked. Carries the current options so Change can reopen the sheet.
 * "Not sure" leaves no row: it keeps its no-re-ask rule and nothing else.
 */
export function buildBottlingAnswer(input: PromptInput, prompt: BottlingPrompt | null): BottlingAnswer | null {
  if (prompt) return null
  const answered = input.bottling_plain === true || input.bottling_prompt_dismissed != null
  if (!answered) return null
  const label = input.bottling_plain ? 'Plain' : [input.wine.vineyard, input.wine.cuvee].filter(Boolean).join(' · ')
  if (!label) return null
  return { label, options: bottlingOptions(input) }
}
