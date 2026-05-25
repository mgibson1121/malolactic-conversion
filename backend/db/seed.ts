/**
 * Seed script — inserts real wine entries for smoke-testing list views.
 * Run manually via: npx ts-node -r tsconfig-paths/register backend/db/seed.ts
 * (from the repo root)
 *
 * NOT run in CI. Safe to run multiple times — each run adds new rows.
 */
import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(__dirname, '../../.env') })

import { openDatabase } from './migrate'
import { SQLiteAdapter } from '../modules/storage/sqlite-adapter'

async function seed() {
  const db = openDatabase()
  const adapter = new SQLiteAdapter(db)

  // 1. Cellar-only: a long-term hold with quantity
  const w1 = await adapter.createWine({
    producer: 'Domaine Rousseau',
    vintage: 2019,
    region: 'Burgundy',
    denomination: 'Gevrey-Chambertin',
    quality_classification: 'Premier Cru',
    vineyard: 'Clos Saint-Jacques',
    cuvee: null,
    grape_varieties: ['Pinot Noir'],
    label_image_url: null,
    tag_discovered: true,
    tag_wishlist: false,
    tag_cellar: true,
    tag_consumed: false,
    cellar_quantity: 6,
    cellar_category: 'long_term',
    drinking_window: { start: '2030-01-01', end: '2048-12-31' },
    vintage_rating: 'very_good',
    my_rating: null,
    my_tags: [],
    wishlist_notes: null,
    price_paid: 285.0,
    purchased_from: 'Chambers Street Wines',
    date_first_consumed: null,
  })
  console.log(`Created: ${w1.producer} ${w1.denomination} ${w1.vintage} [cellar, ${w1.cellar_quantity} btl]`)

  // 2. Cellar + wishlist: Barolo to reorder
  const w2 = await adapter.createWine({
    producer: 'Giacomo Conterno',
    vintage: 2016,
    region: 'Piedmont',
    denomination: 'Barolo',
    quality_classification: null,
    vineyard: null,
    cuvee: 'Francia',
    grape_varieties: ['Nebbiolo'],
    label_image_url: null,
    tag_discovered: true,
    tag_wishlist: true,
    tag_cellar: true,
    tag_consumed: false,
    cellar_quantity: 3,
    cellar_category: 'long_term',
    drinking_window: { start: '2028-01-01', end: '2050-12-31' },
    vintage_rating: 'very_good',
    my_rating: null,
    my_tags: [],
    wishlist_notes: 'Buy 3 more if 2016 or 2017 available at Flatiron',
    price_paid: 189.99,
    purchased_from: 'Flatiron Wines',
    date_first_consumed: null,
  })
  console.log(`Created: ${w2.producer} ${w2.denomination} ${w2.vintage} [cellar + wishlist]`)

  // 3. Consumed with a tasting note
  const w3 = await adapter.createWine({
    producer: 'Georges Roumier',
    vintage: 2017,
    region: 'Burgundy',
    denomination: 'Chambolle-Musigny',
    quality_classification: null,
    vineyard: null,
    cuvee: null,
    grape_varieties: ['Pinot Noir'],
    label_image_url: null,
    tag_discovered: true,
    tag_wishlist: false,
    tag_cellar: false,
    tag_consumed: false,
    cellar_quantity: 0,
    cellar_category: null,
    drinking_window: null,
    vintage_rating: 'good',
    my_rating: null,
    my_tags: [],
    wishlist_notes: null,
    price_paid: 210.0,
    purchased_from: 'Acker Wines',
    date_first_consumed: null,
  })

  await adapter.createTastingNote({
    wine_id: w3.id,
    tasted_at: '2026-03-15T20:00:00.000Z',
    clarity: 'clear',
    colour_intensity: 'medium',
    colour: 'ruby',
    nose_condition: 'clean',
    nose_intensity: 'medium_plus',
    nose_primary_aromas: ['cherry', 'raspberry', 'violet'],
    nose_secondary_aromas: [],
    nose_tertiary_aromas: ['forest floor', 'mushroom', 'earth'],
    palate_sweetness: 'dry',
    palate_acidity: 'high',
    palate_tannin: 'medium',
    palate_body: 'medium',
    palate_flavour_intensity: 'medium_plus',
    palate_finish: 'long',
    quality_assessment: 'very_good',
    my_rating: 'very_good',
    free_text: 'Ethereal and silky. The 2017 is more approachable than expected. Lovely now but should develop further.',
    tags: ['elegant', 'floral', 'pinot-noir', 'burgundy'],
  })
  console.log(`Created: ${w3.producer} ${w3.denomination} ${w3.vintage} [consumed + tasting note]`)

  // 4. Wishlist only: something to research before buying
  const w4 = await adapter.createWine({
    producer: 'Raveneau',
    vintage: 2021,
    region: 'Burgundy',
    denomination: 'Chablis',
    quality_classification: 'Premier Cru',
    vineyard: null,
    cuvee: null,
    grape_varieties: ['Chardonnay'],
    label_image_url: null,
    tag_discovered: true,
    tag_wishlist: true,
    tag_cellar: false,
    tag_consumed: false,
    cellar_quantity: 0,
    cellar_category: null,
    drinking_window: null,
    vintage_rating: 'good',
    my_rating: null,
    my_tags: [],
    wishlist_notes: 'Seen at $145 at Chambers. Allocation-only — join mailing list.',
    price_paid: null,
    purchased_from: null,
    date_first_consumed: null,
  })
  console.log(`Created: ${w4.producer} ${w4.denomination} ${w4.vintage} [wishlist]`)

  // 5. Discovered only: spotted in the wild, not yet decided
  const w5 = await adapter.createWine({
    producer: 'E. Guigal',
    vintage: 2018,
    region: 'Northern Rhône',
    denomination: 'Côte-Rôtie',
    quality_classification: null,
    vineyard: null,
    cuvee: 'La Mouline',
    grape_varieties: ['Syrah'],
    label_image_url: null,
    tag_discovered: true,
    tag_wishlist: false,
    tag_cellar: false,
    tag_consumed: false,
    cellar_quantity: 0,
    cellar_category: null,
    drinking_window: null,
    vintage_rating: 'very_good',
    my_rating: null,
    my_tags: [],
    wishlist_notes: null,
    price_paid: null,
    purchased_from: null,
    date_first_consumed: null,
  })
  console.log(`Created: ${w5.producer} ${w5.denomination} ${w5.vintage} [discovered]`)

  console.log('\nSeed complete. Database ready for smoke-testing.')
  db.close()
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
