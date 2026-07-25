/**
 * Real-world hit-rate check for modules/reviews/. Runs fetchReviewData
 * against a broader set of real wines than what's seeded in the dev
 * database, to gauge how often Step 1 finds a correct product page and
 * Step 2 extracts a real attributed score. Uses real Serper/Puppeteer/
 * OpenAI calls (not mocked) — costs real API usage per run.
 *
 * Kept as a dev tool per build-phases.md Phase 7's open question on
 * keyword-window hit rate: re-run whenever RETAILER_CONFIG changes (e.g.
 * Phase 6.7's 8-retailer expansion) or the windowing/extraction logic
 * changes, to confirm hit rate hasn't regressed. Edit the WINES list below
 * to whatever set you want to validate against; writes a JSON summary to
 * the repo root (gitignored — not meant to be committed).
 *
 * Run: npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/scripts/validate-reviews.ts
 */
import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(__dirname, '../../.env') })

import fs from 'fs'
import { fetchReviewData } from '../modules/reviews'
import type { WineEntry } from '@shared/types'

interface WineProbe {
  label: string
  producer: string | null
  denomination: string | null
  vintage: number | null
}

const WINES: WineProbe[] = [
  { label: '2019 Domaine Tempier Bandol', producer: 'Domaine Tempier', denomination: 'Bandol', vintage: 2019 },
  { label: '2019 Châteauneuf-du-Pape "La Crau"', producer: null, denomination: 'Châteauneuf-du-Pape La Crau', vintage: 2019 },
  { label: '2018 Domaine Follin-Arbelet Aloxe-Corton', producer: 'Domaine Follin-Arbelet', denomination: 'Aloxe-Corton', vintage: 2018 },
  { label: '2020 Sancerre (Hippolyte Reverdy)', producer: 'Hippolyte Reverdy', denomination: 'Sancerre', vintage: 2020 },
  { label: '2020 Domaine Daniel Chotard Sancerre', producer: 'Domaine Daniel Chotard', denomination: 'Sancerre', vintage: 2020 },
  { label: '2017 Domaine Bernard Baudry Chinon La Croix Boissée', producer: 'Domaine Bernard Baudry', denomination: 'Chinon La Croix Boissée', vintage: 2017 },
  { label: '2017 Catherine et Pierre Breton Bourgueil Les Perrières', producer: 'Catherine et Pierre Breton', denomination: 'Bourgueil Les Perrières', vintage: 2017 },
  { label: '2017 Guido Porro Barolo Vigna Lazzairasco', producer: 'Guido Porro', denomination: 'Barolo Vigna Lazzairasco', vintage: 2017 },
  { label: '2019 Domaine William Fevre Chablis 1er Cru Montée de Tonnerre', producer: 'Domaine William Fevre', denomination: 'Chablis 1er Cru Montée de Tonnerre', vintage: 2019 },
  { label: '2018 Clos du Caillou Cotes du Rhone Les Quartz', producer: 'Clos du Caillou', denomination: 'Cotes du Rhone Les Quartz', vintage: 2018 },
  { label: '2019 Domaine André Brunel Châteauneuf-du-Pape Cuvée Réservée', producer: 'Domaine André Brunel', denomination: 'Châteauneuf-du-Pape Cuvée Réservée', vintage: 2019 },
  { label: '2018 Burgaud Bernard Cote Rotie', producer: 'Bernard Burgaud', denomination: 'Cote Rotie', vintage: 2018 },
  { label: '2019 Domaine Saint-Damien Gigondas Vieilles Vignes', producer: 'Domaine Saint-Damien', denomination: 'Gigondas Vieilles Vignes', vintage: 2019 },
  { label: '2017 Produttori del Barbaresco', producer: 'Produttori del Barbaresco', denomination: 'Barbaresco', vintage: 2017 },
  { label: 'Terres Dorees (Jean Paul Brun) Fleurie Grille Midi 2019', producer: 'Terres Dorees Jean Paul Brun', denomination: 'Fleurie Grille Midi', vintage: 2019 },
  { label: 'Sansonnet St Emilion 2017', producer: 'Chateau Sansonnet', denomination: 'St Emilion', vintage: 2017 },
  { label: 'St. Préfert Châteauneuf-du-Pape Auguste Favier Réserve 2019', producer: 'Domaine Saint Prefert', denomination: 'Châteauneuf-du-Pape Auguste Favier Réserve', vintage: 2019 },
  { label: 'Clos des Papes Châteauneuf-du-Pape 2020', producer: 'Clos des Papes', denomination: 'Châteauneuf-du-Pape', vintage: 2020 },
]

function makeWineEntry(w: WineProbe): WineEntry {
  return {
    id: 'probe',
    producer: w.producer,
    vintage: w.vintage,
    region: null,
    denomination: w.denomination,
    quality_classification: null,
    vineyard: null,
    cuvee: null,
    grape_varieties: null,
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
    latest_tasting_note_id: null,
    advice_linked: null,
    expert_reviews: null,
    community_sentiment: null,
    community_excerpts: null,
    price_data: null,
    retailer_links: null,
    review_data: null,
    date_added: new Date().toISOString(),
    date_first_consumed: null,
  }
}

async function main() {
  const results: Array<{ label: string; review_data: Awaited<ReturnType<typeof fetchReviewData>> }> = []

  for (const w of WINES) {
    process.stdout.write(`\n→ ${w.label} ... `)
    const start = Date.now()
    const review_data = await fetchReviewData(makeWineEntry(w))
    const secs = ((Date.now() - start) / 1000).toFixed(1)
    const scoreCount = review_data.reduce((n, r) => n + r.critic_scores.length, 0)
    process.stdout.write(`${review_data.length} retailer(s) matched, ${scoreCount} score(s) (${secs}s)\n`)
    for (const r of review_data) {
      console.log(`    ${r.slug}: ${r.product_url}`)
      for (const s of r.critic_scores) {
        console.log(`      ★ ${s.publication}: ${s.score}`)
      }
    }
    results.push({ label: w.label, review_data })
  }

  const outPath = path.resolve(__dirname, '../../validate-reviews-results.json')
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log(`\nWrote ${outPath}`)

  const totalScores = results.reduce((n, r) => n + r.review_data.reduce((m, x) => m + x.critic_scores.length, 0), 0)
  const winesWithAnyScore = results.filter(r => r.review_data.some(x => x.critic_scores.length > 0)).length
  console.log(`\nSummary: ${winesWithAnyScore}/${results.length} wines had at least one attributed score. ${totalScores} total scores found.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
