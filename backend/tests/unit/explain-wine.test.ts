import type { WineEntry } from '@shared/types'
import { explainWine, liveCostEstimate } from '../../scripts/explain-wine-core'
import { scoreMatch, isAcceptableMatch } from '@shared/utils/wine-match'

// Marcoux, as stored on 2026-10-04 (Phase 12.2 §2): five listings, none
// eligible. explain-wine must reproduce that from stored data alone.
function listing(over: Record<string, unknown>) {
  return {
    slug: 'x', name: 'X', price: 100, url: 'https://x.example/p', distance_miles: 5, is_preferred_retailer: true,
    is_search_results_page: true, matched_vintage: 2019, vintage_mismatch: false, vintage_verdict: 'match',
    pack_quantity: 1, bottle_size_ml: null, non_standard_format: false, format_label: '', link_only: false,
    verification: 'verified', ...over,
  }
}

const marcoux = {
  id: 'af4dfa61-bb98-4e3a-b39c-d56bc5308a3e',
  producer: 'Domaine de Marcoux', denomination: 'Châteauneuf-du-Pape', vintage: 2019,
  cuvee: null, vineyard: null, quality_classification: null,
  price_data: {
    price_min: null, price_avg: null, price_max: null, other_vintage_price_range: { min: 67.95, max: 199 },
    nearest_retailer: null, fetched_at: '2026-10-04T23:27:32.166Z',
    retailers: [
      listing({ slug: 'benchmark', name: 'Benchmark Wine Group', price: 707, pack_quantity: 6, non_standard_format: true, format_label: '6-pack' }),
      listing({ slug: 'acker', name: 'Acker Wines', price: 154.99, matched_vintage: 2021, vintage_mismatch: true, vintage_verdict: 'mismatch', bottle_size_ml: 1500, non_standard_format: true, format_label: '1.5L' }),
      listing({ slug: 'flatiron', name: 'Flatiron Wines & Spirits', price: 199, matched_vintage: 2016, vintage_mismatch: true, vintage_verdict: 'mismatch' }),
      listing({ slug: 'grapes', name: 'Grapes & Grains', price: 67.95, matched_vintage: 2020, vintage_mismatch: true, vintage_verdict: 'mismatch' }),
      listing({ slug: 'kl', name: 'K&L Wine Merchants', price: null, link_only: true, verification: 'unchecked' }),
    ],
  },
  review_data: [
    {
      slug: 'flatiron', name: 'Flatiron Wines & Spirits', source: 'configured', fetched_at: '2026-10-04T23:30:00.000Z',
      product_url: 'https://nyc.flatiron-wines.com/products/domaine-de-marcoux-chateauneuf-du-pape-vieilles-vignes-2010',
      page_vintage: 2010, vintage_gap: 9, critic_scores: [{ publication: 'Vinous', score: 97 }],
    },
  ],
  review_probe_log: [{ slug: 'woodland', domain: 'whwc.com', stage: 'zero_results', variants_tried: 3, probed_at: '2026-10-04T23:30:00.000Z' }],
} as unknown as WineEntry

describe('explain-wine (Phase 12.2 WI-0)', () => {
  const text = explainWine(marcoux).join('\n')

  it('reproduces the five-listing, none-eligible result from stored data (no network)', () => {
    expect(text).toContain('Benchmark Wine Group')
    expect(text).toMatch(/Benchmark[^\n]*\n\s+-> NOT COUNTED: pack/)
    expect(text).toMatch(/Acker[^\n]*\n\s+-> NOT COUNTED: other_vintage/)
    expect(text).toMatch(/K&L[^\n]*\n\s+-> NOT COUNTED: link_only/)
    expect(text).toContain('basis=none')
    expect(text).toContain('"other_vintage":3')
  })

  it('shows the matcher verdict per dimension for each stored review page', () => {
    expect(text).toMatch(/producer=match denomination=match bottling=unknown vintage=mismatch -> acceptable/)
  })

  it('shows the queries a live run would send, and the probe memory', () => {
    expect(text).toContain('site:flatiron-wines.com "Domaine de Marcoux"')
    expect(text).toContain('woodland=zero_results@2026-10-04')
  })

  it('prints a credit estimate for a live run without running one', () => {
    const { retailers, maxCredits } = liveCostEstimate(marcoux)
    expect(retailers).toBeGreaterThan(0)
    expect(maxCredits).toBeGreaterThanOrEqual(retailers)
  })

  it('says so when a wine was never fetched', () => {
    const bare = explainWine({ ...marcoux, price_data: null, review_data: null, review_probe_log: null } as WineEntry).join('\n')
    expect(bare).toContain('never fetched (price_data is null)')
    expect(bare).toContain('never fetched (review_data is null)')
  })
})

describe('plural vineyard names (Phase 12.2 WI-4, Girardin Les Cailleret)', () => {
  const wine = { producer: 'Vincent Girardin', denomination: 'Chassagne-Montrachet 1er Cru', vintage: 2017, cuvee: null, vineyard: 'Les Cailleret', quality_classification: 'Premier Cru' }
  it.each([
    'Vincent Girardin Chassagne-Montrachet 1er Cru Les Caillerets 2017',
    'Vincent Girardin Chassagne-Montrachet Premier Cru Cailleret 2017',
    'Domaine Vincent Girardin Chassagne Montrachet Les Caillerets 2017',
  ])('accepts %s', title => {
    expect(isAcceptableMatch(scoreMatch({ title, url: `https://shop.example/p/${title.replace(/\W+/g, '-')}` }, wine))).toBe(true)
  })

  it('still rejects a different vineyard', () => {
    const v = scoreMatch({ title: 'Vincent Girardin Chassagne-Montrachet 1er Cru Les Vergers 2017' }, wine)
    expect(v.bottling).toBe('mismatch')
    expect(isAcceptableMatch(v)).toBe(false)
  })
})
