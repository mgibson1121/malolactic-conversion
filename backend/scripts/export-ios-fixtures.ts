/**
 * Writes the JSON fixtures the iOS app's decoding tests read
 * (ios/WineAppTests/Fixtures/), produced by the real SQLite adapter against
 * an in-memory database rather than written by hand — so a field renamed or
 * added in shared/types.ts shows up as a failing Swift test instead of a
 * silent decode gap on the phone (Phase 12, spec §2.1 model parity).
 *
 * Re-run after any change to WineEntry, TastingNote, PriceData, RetailerReview
 * or AppSettings, and commit the regenerated files with that change:
 * npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/scripts/export-ios-fixtures.ts
 */
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { SQLiteAdapter } from '../modules/storage/sqlite-adapter'
import { findDuplicate } from '@shared/utils/duplicate-match'
import type { CreateWineInput, PriceData, RetailerPrice, RetailerReview } from '@shared/types'

const OUT_DIR = path.resolve(__dirname, '../../ios/WineAppTests/Fixtures')

const BASE: CreateWineInput = {
  producer: 'Domaine Comte Georges de Vogüé',
  vintage: 2019,
  region: 'Burgundy',
  denomination: 'Chambolle-Musigny 1er Cru Les Amoureuses',
  quality_classification: 'Premier Cru',
  vineyard: 'Les Amoureuses',
  cuvee: null,
  grape_varieties: ['Pinot Noir'],
  wine_color: 'red',
  label_image_url: null,
  tag_discovered: false,
  tag_wishlist: false,
  tag_cellar: false,
  tag_consumed: false,
  cellar_quantity: 3,
  cellar_category: null,
  drinking_window: { start: '2026-01-01', end: '2038-12-31' },
  vintage_rating: 'very_good',
  my_rating: 'outstanding',
  my_tags: ['silky', 'floral'],
  wishlist_notes: null,
  price_paid: 640,
  purchased_from: 'Zachys',
  date_first_consumed: null,
  retailer_links: null,
}

function retailer(overrides: Partial<RetailerPrice>): RetailerPrice {
  return {
    slug: 'zachys', name: 'Zachys', price: 690, url: 'https://www.zachys.com/products/amoureuses-2019',
    distance_miles: 21.4, is_preferred_retailer: true, is_search_results_page: false,
    matched_vintage: 2019, vintage_mismatch: false, vintage_verdict: 'match',
    pack_quantity: 1, bottle_size_ml: null, non_standard_format: false, format_label: '',
    link_only: false, verification: 'verified',
    ...overrides,
  }
}

const PRICE_DATA: PriceData = {
  price_min: 640, price_avg: 690.5, price_max: 745,
  other_vintage_price_range: { min: 520, max: 910 },
  retailers: [
    retailer({}),
    retailer({ slug: 'kl', name: 'K&L Wine Merchants', price: null, url: 'https://www.klwines.com/Products?searchText=vogue', is_search_results_page: true, matched_vintage: null, vintage_verdict: 'unknown', link_only: true, verification: 'unchecked', distance_miles: 2570.2 }),
    retailer({ slug: 'benchmark', name: 'Benchmark Wine Group', price: 1380, matched_vintage: 2018, vintage_mismatch: true, vintage_verdict: 'mismatch', pack_quantity: 1, bottle_size_ml: 1500, non_standard_format: true, format_label: '1.5L', verification: 'unverified' }),
  ],
  nearest_retailer: retailer({}),
  fetched_at: '2026-09-20T18:04:11.000Z',
}

const REVIEW_DATA: RetailerReview[] = [
  {
    slug: 'zachys', name: 'Zachys', product_url: 'https://www.zachys.com/products/amoureuses-2019',
    critic_scores: [
      { publication: 'Burghound', score: 96, known_publication: true, drinking_window: { start: 2029, end: 2045 }, vintage_character: 'very_good', deal: false },
      { publication: 'Vinous', score: 96, known_publication: true, drinking_window: null, vintage_character: null, deal: false },
    ],
    fetched_at: '2026-09-20T18:05:00.000Z', source: 'configured', page_vintage: 2019, vintage_gap: 0,
    match: { producer: 'match', denomination: 'match', bottling: 'match', vintage: 'match', candidateVintage: 2019, vintageGap: 0 },
    page_price: 690,
  },
  {
    slug: 'fallback-somewine', name: 'somewine.example', product_url: 'https://somewine.example/amoureuses',
    critic_scores: [
      { publication: 'Burghound', score: 95, known_publication: true, drinking_window: null, vintage_character: null, deal: false },
      { publication: 'Jancis Robinson MW', score: 18.5, known_publication: false, drinking_window: { start: 2030, end: null }, vintage_character: null, deal: true },
    ],
    fetched_at: '2026-09-20T18:05:30.000Z', source: 'fallback', page_vintage: null, vintage_gap: null,
    match: { producer: 'match', denomination: 'match', bottling: 'unknown', vintage: 'unknown', candidateVintage: null, vintageGap: null },
    page_price: null,
  },
]

async function main() {
  const storage = new SQLiteAdapter(new Database(':memory:'))

  // A fully enriched, promoted cellar wine with a tasting note.
  const full = await storage.createWine(BASE)
  await storage.updateWine(full.id, {
    tag_cellar: true, tag_discovered: true, promoted_at: '2026-09-20T18:10:00.000Z',
    price_data: PRICE_DATA, review_data: REVIEW_DATA,
    // createWine always starts retailer_links null — saved links only ever
    // arrive through confirm-retailer-link, i.e. an update.
    retailer_links: { kl: 'https://www.klwines.com/p/i?i=1592587' },
  })
  const note = await storage.createTastingNote({
    wine_id: full.id, tasted_at: '2026-09-21T20:30:00.000Z',
    clarity: 'clear', colour_intensity: 'pale', colour: 'ruby',
    nose_condition: 'clean', nose_intensity: 'medium_plus',
    nose_primary_aromas: ['red cherry', 'violet'], nose_secondary_aromas: [], nose_tertiary_aromas: ['forest floor'],
    palate_sweetness: 'dry', palate_acidity: 'high', palate_tannin: 'medium',
    palate_body: 'medium', palate_flavour_intensity: 'medium_plus', palate_finish: 'long',
    quality_assessment: 'outstanding', my_rating: 'outstanding',
    free_text: 'Lifted and silky.', tags: ['silky', 'floral'],
  })

  // A bare NV draft: every Tier 2 field null, no enrichment, no tags.
  const draft = await storage.createWine({
    ...BASE, producer: 'Bollinger', vintage: null, region: 'Champagne', denomination: null,
    quality_classification: null, vineyard: null, grape_varieties: null, wine_color: null,
    cellar_quantity: 0, drinking_window: null, vintage_rating: null, my_rating: null, my_tags: [],
    price_paid: null, purchased_from: null, retailer_links: null,
  })

  const [listed] = await storage.listWines({ tag_cellar: true })
  const draftRead = await storage.getWine(draft.id)
  const settings = await storage.updateSettings({ cellar_capacity: 120 })
  const promoted = await storage.listWines()

  const fixtures: Record<string, unknown> = {
    'wine-full.json': listed,
    'wine-draft-nv.json': draftRead,
    'wine-list.json': [listed],
    'tasting-note.json': note,
    'settings.json': settings,
    'duplicate-none.json': findDuplicate({ producer: 'Domaine Leroy', denomination: 'Richebourg', vintage: 2019 }, promoted),
    'duplicate-match.json': findDuplicate({ producer: full.producer, denomination: full.denomination, vintage: 2019 }, promoted),
    'duplicate-vintage-mismatch.json': findDuplicate({ producer: full.producer, denomination: full.denomination, vintage: 2020 }, promoted),
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  for (const [name, value] of Object.entries(fixtures)) {
    fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(value, null, 2) + '\n')
    console.log(`wrote ${name}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
