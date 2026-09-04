/**
 * Checkpoint batch — inserts real wine entries to validate price/review
 * enrichment functionality en masse before the frontend build (Phase 8/9).
 * Run manually via: npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/db/checkpoint-wines.ts
 * (from the repo root)
 *
 * Vintages (2022 across the board) were supplied by the developer directly
 * after an earlier run with placeholder vintages was found to degrade
 * price/review search accuracy.
 *
 * NOT run in CI. Safe to run multiple times — each run adds new rows.
 */
import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(__dirname, '../../.env') })

import { openDatabase } from './migrate'
import { SQLiteAdapter } from '../modules/storage/sqlite-adapter'
import type { CreateWineInput } from '@shared/types'

const wines: Array<Pick<CreateWineInput, 'producer' | 'vintage' | 'region' | 'denomination'>> = [
  // Burgundy
  { producer: 'Domaine Bessin-Tremblay', vintage: 2022, region: 'Burgundy', denomination: 'Chablis' },
  { producer: 'Domaine Maxime Cottenceau', vintage: 2022, region: 'Burgundy', denomination: 'Montagny' },
  { producer: 'Domaine Vincent Dureuil-Janthial', vintage: 2022, region: 'Burgundy', denomination: 'Rully' },
  { producer: 'Domaine Jean-Marc Vincent', vintage: 2022, region: 'Burgundy', denomination: 'Santenay' },
  { producer: 'Domaine Charles Audoin', vintage: 2022, region: 'Burgundy', denomination: 'Marsannay' },
  // Other regions in France
  { producer: 'Bretadeau', vintage: 2022, region: 'Loire Valley', denomination: 'Muscadet' },
  { producer: 'Gour de Chaulé', vintage: 2022, region: 'Southern Rhône', denomination: 'Gigondas' },
  { producer: 'Montus', vintage: 2022, region: 'Southwest France', denomination: 'Madiran' },
  { producer: 'Mangot', vintage: 2022, region: 'Bordeaux', denomination: 'Saint-Émilion' },
  { producer: 'Clos Manou', vintage: 2022, region: 'Bordeaux', denomination: 'Médoc' },
  { producer: 'Grand Village', vintage: 2022, region: 'Bordeaux', denomination: 'Vin de France' },
  { producer: 'Clos Venturi', vintage: 2022, region: 'Corsica', denomination: 'Corsica' },
  { producer: 'Domaine des Ardoisières', vintage: 2022, region: 'Savoie', denomination: 'Savoie' },
  { producer: 'Domaine Deleuze-Rochetin', vintage: 2022, region: 'Southern Rhône', denomination: 'Côtes du Rhône' },
]

async function checkpoint() {
  const db = openDatabase()
  const adapter = new SQLiteAdapter(db)

  for (const w of wines) {
    const created = await adapter.createWine({
      producer: w.producer,
      vintage: w.vintage,
      region: w.region,
      denomination: w.denomination,
      quality_classification: null,
      vineyard: null,
      cuvee: null,
      grape_varieties: null,
      wine_color: null,
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: false,
      tag_cellar: false,
      tag_consumed: false,
      cellar_quantity: 0,
      cellar_category: null,
      drinking_window: null,
      vintage_rating: null,
      my_rating: null,
      my_tags: [],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_first_consumed: null,
    })
    console.log(`Created: ${created.producer} ${created.denomination} ${created.vintage} [${created.id}]`)
  }

  console.log(`\nCheckpoint batch complete — ${wines.length} wines added.`)
  db.close()
}

checkpoint().catch((err) => {
  console.error('Checkpoint batch failed:', err)
  process.exit(1)
})
