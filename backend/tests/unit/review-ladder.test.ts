import type { PriceData, RetailerPrice, RetailerReview } from '@shared/types'
import { buildReviewLadder, rungOf, vintageDelta } from '@shared/utils/review-ladder'
import { buildCriticSummary } from '@shared/utils/critic-summary'
import { buildBottlingPrompt } from '@shared/utils/bottling-prompt'
import type { BottlingWine } from '@shared/utils/bottling-difference'

const vietti: BottlingWine = { producer: 'Vietti', denomination: 'Barolo', vintage: 2021, cuvee: null, vineyard: null, quality_classification: null }

const crit = (publication: string, score: number, known = true) => ({
  publication, score, known_publication: known, drinking_window: null, vintage_character: null, deal: false,
})
function review(slug: string, url: string, pageVintage: number | null, scores: ReturnType<typeof crit>[], extra: Partial<RetailerReview> = {}): RetailerReview {
  return {
    slug, name: slug, product_url: url, critic_scores: scores, fetched_at: '2026-10-02T00:00:00.000Z', source: 'configured',
    page_vintage: pageVintage, vintage_gap: pageVintage == null ? null : Math.abs(pageVintage - 2021),
    match: { producer: 'match', denomination: 'match', bottling: 'unknown', vintage: 'match', candidateVintage: pageVintage, vintageGap: 0 },
    page_price: null, ...extra,
  } as RetailerReview
}

// The three pages stored for Vietti on 2026-10-02.
const CASTIGLIONE = review('woodland', 'https://whwc.com/vietti-barolo-castiglione-2021/', 2021,
  [crit('Decanter', 95), crit('James Suckling', 95), crit('Wine Advocate', 94), crit('Vinous', 94)])
const PLAIN = review('winelibrary', 'https://winelibrary.com/wines/nebbiolo/2021-vietti-barolo-147735', 2021, [crit('James Suckling', 95)])
const MONVIGLIERO = review('jjbuckley', 'https://www.jjbuckley.com/wine/2021-vietti-barolo-monvigliero/2021-1879291-1500/', 2021,
  [crit('James Suckling', 98), crit('Wine Advocate', 97), crit('Wine Spectator', 97)])

describe('rungOf (D9)', () => {
  it.each([
    [{ exact: true, delta: 0, hasTrustedScore: true }, '1'],
    [{ exact: true, delta: 0, hasTrustedScore: false }, '2'],
    [{ exact: true, delta: 4, hasTrustedScore: true }, '2'],
    [{ exact: true, delta: null, hasTrustedScore: true }, '2'],
    [{ exact: false, delta: 0, hasTrustedScore: true }, '3a'],
    [{ exact: false, delta: 1, hasTrustedScore: true }, '3b'],
    [{ exact: false, delta: 3, hasTrustedScore: true }, '3b'],
    [{ exact: false, delta: 4, hasTrustedScore: true }, 'out'],
    [{ exact: false, delta: null, hasTrustedScore: true }, 'out'],
  ])('%j -> %s', (args, rung) => {
    expect(rungOf(args)).toBe(rung)
  })

  it('measures the vintage distance, 0 for NV against NV', () => {
    expect(vintageDelta(2019, 2021)).toBe(2)
    expect(vintageDelta(null, null)).toBe(0)
    expect(vintageDelta(2019, null)).toBeNull()
    expect(vintageDelta(null, 2021)).toBeNull()
  })
})

describe('buildReviewLadder — Vietti Barolo 2021 (WI-2 acceptance 2)', () => {
  it('the plain Wine Library page is Tier 2 (only James Suckling, which is not a trusted critic), and wins over the named bottlings', () => {
    const ladder = buildReviewLadder([CASTIGLIONE, PLAIN, MONVIGLIERO], vietti)
    expect(ladder.tier).toBe('2')
    const byslug = Object.fromEntries(ladder.pages.map(p => [p.slug, p]))
    expect(byslug.winelibrary.rung).toBe('2')
    expect(byslug.woodland.rung).toBe('3a')
    expect(byslug.jjbuckley.rung).toBe('3a')
    expect(byslug.woodland.badge).toBe("Names Castiglione — yours doesn't")
    expect(byslug.jjbuckley.badge).toBe("Names Monvigliero — yours doesn't")
  })

  it('with only the named bottlings the wine is matched at Tier 3a', () => {
    const ladder = buildReviewLadder([CASTIGLIONE, MONVIGLIERO], vietti)
    expect(ladder.tier).toBe('3a')
    expect(ladder.rungs.map(r => r.tier)).toEqual(['3a'])
    expect(ladder.rungs[0].pages).toBe(2)
  })

  it('answering Castiglione climbs back to Tier 1 with no network', () => {
    const ladder = buildReviewLadder([CASTIGLIONE, PLAIN, MONVIGLIERO], { ...vietti, vineyard: 'Castiglione' })
    expect(ladder.tier).toBe('1')
    expect(ladder.pages.find(p => p.slug === 'woodland')!.rung).toBe('1')
    // The plain page now omits the name the wine records, and Monvigliero names another.
    expect(ladder.pages.find(p => p.slug === 'winelibrary')!.rung).toBe('3a')
    expect(ladder.pages.find(p => p.slug === 'winelibrary')!.badge).toBe("Doesn't name Castiglione — yours does")
  })

  it('a page with no score sits on no rung; nothing at all is "none"', () => {
    const empty = review('x', 'https://x.example/vietti-barolo-2021', 2021, [])
    const ladder = buildReviewLadder([empty], vietti)
    expect(ladder.tier).toBe('none')
    expect(ladder.pages[0].rung).toBeNull()
    expect(buildReviewLadder(null, vietti).tier).toBe('none')
  })

  it('an exact wine from another vintage is Tier 2, nearest first by the summary order', () => {
    const p2019 = review('a', 'https://a.example/vietti-barolo-2019', 2019, [crit('Vinous', 93)])
    const ladder = buildReviewLadder([p2019], vietti)
    expect(ladder.tier).toBe('2')
    expect(ladder.pages[0].vintage_delta).toBe(2)
  })
})

describe('buildCriticSummary — a different bottling ranks below the exact wine', () => {
  it('puts the plain page ahead of 98-point Monvigliero scores, which stay listed and badged', () => {
    const summary = buildCriticSummary([MONVIGLIERO, PLAIN], 2021, undefined, vietti)
    expect(summary.ordered[0].publication).toBe('James Suckling')
    expect(summary.ordered[0].score).toBe(95)
    expect(summary.ordered[0].bottling_badge).toBeNull()
    const monv = summary.ordered.filter(i => i.bottling_badge)
    expect(monv.map(i => i.publication)).toEqual(['Wine Advocate', 'Wine Spectator'])
    expect(monv[0].rung).toBe('3a')
  })

  it('without the wine the 12.1 ordering is untouched', () => {
    const summary = buildCriticSummary([MONVIGLIERO, PLAIN], 2021)
    // 12.1 order: a trusted same-vintage critic first, whichever bottling the page is.
    expect(summary.ordered[0].publication).toBe('Wine Advocate')
    expect(summary.ordered[0].score).toBe(97)
    expect(summary.ordered[0].rung).toBeUndefined()
  })

  it('among different bottlings the nearest vintage comes first', () => {
    const far = review('far', 'https://f.example/vietti-barolo-rocche-2019', 2019, [crit('Vinous', 99)])
    const near = review('near', 'https://n.example/vietti-barolo-ravera-2021', 2021, [crit('Decanter', 90)])
    const s = buildCriticSummary([far, near], 2021, undefined, vietti)
    expect(s.ordered.map(i => i.publication)).toEqual(['Decanter', 'Vinous'])
  })
})

describe('buildBottlingPrompt (WI-2.5)', () => {
  const listing = (slug: string, name: string, price: number, extra: string[] = []): RetailerPrice => ({
    slug, name, price, url: `https://${slug}.example/p`, distance_miles: 10, is_preferred_retailer: true, is_search_results_page: false,
    matched_vintage: 2021, vintage_mismatch: false, vintage_verdict: 'match', pack_quantity: 1, bottle_size_ml: null,
    non_standard_format: false, format_label: '', link_only: false, verification: 'verified',
    bottling_difference: { extra, missing: [] },
  })
  const price: PriceData = {
    price_min: null, price_avg: null, price_max: null, other_vintage_price_range: null, nearest_retailer: null, fetched_at: 'x',
    headline_basis: 'ambiguous',
    retailers: [listing('zachys', 'Zachys', 74.99), listing('sokolin', 'Sokolin', 229, ['rocche']), listing('macarthur', 'MacArthur', 245, ['rocche'])],
  }
  const ladder = () => buildReviewLadder([CASTIGLIONE, PLAIN, MONVIGLIERO], vietti)

  it('is raised by a price split and by two distinct modifiers, naming Castiglione and Monvigliero', () => {
    const prompt = buildBottlingPrompt({ wine: vietti, price_data: price, review_data: [CASTIGLIONE, PLAIN, MONVIGLIERO], review_ladder: ladder() })!
    expect(prompt.reasons).toEqual(['modifiers', 'price_split'])
    const names = prompt.options.map(o => o.name)
    expect(names).toEqual(expect.arrayContaining(['Castiglione', 'Monvigliero', 'Rocche']))
    const rocche = prompt.options.find(o => o.name === 'Rocche')!
    expect(rocche.retailers).toEqual(['Sokolin', 'MacArthur'])
    expect(rocche.price_range).toEqual({ min: 229, max: 245 })
    const castiglione = prompt.options.find(o => o.name === 'Castiglione')!
    expect(castiglione.critics).toContain('Decanter')
    expect(castiglione.links[0].url).toBe(CASTIGLIONE.product_url)
  })

  it('is raised by Tier 3 alone', () => {
    const prompt = buildBottlingPrompt({ wine: vietti, price_data: null, review_data: [CASTIGLIONE], review_ladder: buildReviewLadder([CASTIGLIONE], vietti) })!
    expect(prompt.reasons).toEqual(['tier3'])
  })

  it('is not raised for one modifier on an otherwise healthy wine', () => {
    const l = buildReviewLadder([CASTIGLIONE, PLAIN], { ...vietti })
    // Tier 2 (plain page, untrusted critic) and a single modifier: nothing triggers.
    expect(buildBottlingPrompt({ wine: vietti, price_data: null, review_data: [CASTIGLIONE, PLAIN], review_ladder: l })).toBeNull()
  })

  it('stays quiet after "Plain", and after a dismissal until different modifiers appear', () => {
    const base = { wine: vietti, price_data: price, review_data: [CASTIGLIONE, PLAIN, MONVIGLIERO], review_ladder: ladder() }
    expect(buildBottlingPrompt({ ...base, bottling_plain: true })).toBeNull()
    const first = buildBottlingPrompt(base)!
    expect(buildBottlingPrompt({ ...base, bottling_prompt_dismissed: first.signature })).toBeNull()
    expect(buildBottlingPrompt({ ...base, bottling_prompt_dismissed: 'castiglione' })).not.toBeNull()
  })
})
