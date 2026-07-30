/**
 * Real-world hit-rate check for modules/reviews/. Runs fetchReviewData
 * against a broader set of real wines than what's seeded in the dev
 * database, to gauge how often Step 1 finds a correct product page and
 * Step 2 extracts a real attributed score — plus, as of Phase 8, how often
 * a drinking window / vintage character / value signal is captured
 * alongside the score. Uses real Serper/Puppeteer/OpenAI calls (not
 * mocked) — costs real API usage per run.
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

// Phase 8 real-world validation set (2026-07-29) — developer's cellar list.
const WINES: WineProbe[] = [
  { label: "2018 Château du Petit Thouars Chinon L'Epée", producer: 'Château du Petit Thouars', denomination: "Chinon L'Epée", vintage: 2018 },
  { label: '2020 Domaine de Montille Bourgogne Blanc Le Clos du Chateau', producer: 'Domaine de Montille', denomination: 'Bourgogne Blanc Le Clos du Chateau', vintage: 2020 },
  { label: "2019 Etienne Bécheras (Le Prieuré d'Arras) St. Joseph", producer: "Etienne Bécheras (Le Prieuré d'Arras)", denomination: 'St. Joseph', vintage: 2019 },
  { label: '2020 Jaeger-Defaux Rully Rouge', producer: 'Jaeger-Defaux', denomination: 'Rully Rouge', vintage: 2020 },
  { label: 'Domaine Maurice Schoech Grand Cru Riesling Furstentum', producer: 'Domaine Maurice Schoech', denomination: 'Grand Cru Riesling Furstentum', vintage: null },
  { label: 'DEI Vino Nobile di Montepulciano 2018', producer: 'Dei', denomination: 'Vino Nobile di Montepulciano', vintage: 2018 },
  { label: "2021 Roagna Dolcetto d'Alba", producer: 'Roagna', denomination: "Dolcetto d'Alba", vintage: 2021 },
  { label: 'Villaine Bourgogne Côte Chalonnaise Les Clous 2019', producer: 'Villaine', denomination: 'Bourgogne Côte Chalonnaise Les Clous', vintage: 2019 },
  { label: '2019 Domaine de la Charbonnière Châteauneuf-du-Pape', producer: 'Domaine de la Charbonnière', denomination: 'Châteauneuf-du-Pape', vintage: 2019 },
  { label: "2019 Etienne Bécheras (Le Prieuré d'Arras) St. Joseph Cuvée Tour Joviac", producer: "Etienne Bécheras (Le Prieuré d'Arras)", denomination: 'St. Joseph Cuvée Tour Joviac', vintage: 2019 },
  { label: 'Château du Chatelard Fleurie Les Vieux Granits', producer: 'Château du Chatelard', denomination: 'Fleurie Les Vieux Granits', vintage: null },
  { label: '2018 Castello di Volpaia Chianti Classico Riserva', producer: 'Castello di Volpaia', denomination: 'Chianti Classico Riserva', vintage: 2018 },
  { label: '2020 Marc Brédif Chinon', producer: 'Marc Brédif', denomination: 'Chinon', vintage: 2020 },
  { label: '2018 Castagnoli Chianti Classico', producer: 'Castagnoli', denomination: 'Chianti Classico', vintage: 2018 },
  { label: '2015 La Rioja Alta "904 Selección Especial" Gran Reserva Rioja', producer: 'La Rioja Alta', denomination: '904 Selección Especial Gran Reserva Rioja', vintage: 2015 },
  { label: '2023 Domaine Joseph Colin St-Aubin 1er Cru "En Remilly"', producer: 'Domaine Joseph Colin', denomination: 'St-Aubin 1er Cru En Remilly', vintage: 2023 },
  { label: '2020 Domaine Franck Balthazar "Chaillot" Cornas', producer: 'Domaine Franck Balthazar', denomination: 'Cornas Chaillot', vintage: 2020 },
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
    drinking_window_source: null,
    vintage_rating: null,
    vintage_rating_source: null,
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
        const bits: string[] = [`★ ${s.publication}: ${s.score}`]
        if (s.drinking_window) bits.push(`drink ${s.drinking_window.start ?? '?'}–${s.drinking_window.end ?? '?'}`)
        if (s.vintage_character) bits.push(`vintage: ${s.vintage_character}`)
        if (s.deal) bits.push('DEAL')
        console.log(`      ${bits.join('  |  ')}`)
      }
    }
    results.push({ label: w.label, review_data })
  }

  const outPath = path.resolve(__dirname, '../../validate-reviews-results.json')
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log(`\nWrote ${outPath}`)

  const allScores = results.flatMap(r => r.review_data.flatMap(x => x.critic_scores))
  const totalScores = allScores.length
  const winesWithAnyScore = results.filter(r => r.review_data.some(x => x.critic_scores.length > 0)).length
  const withWindow = allScores.filter(s => s.drinking_window !== null).length
  const withVintageChar = allScores.filter(s => s.vintage_character !== null).length
  const withDeal = allScores.filter(s => s.deal).length
  console.log(`\nSummary: ${winesWithAnyScore}/${results.length} wines had at least one attributed score. ${totalScores} total scores found.`)
  console.log(`Phase 8 fields (of ${totalScores} scores): ${withWindow} with a drinking window, ${withVintageChar} with a vintage character, ${withDeal} flagged as a deal.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
