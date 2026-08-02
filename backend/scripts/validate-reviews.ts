/**
 * Real-world hit-rate check for modules/reviews/. Runs the same pipeline
 * fetchReviewData does (Step 1: findProductPageDetailed, Step 2: render +
 * window + GPT-4o extraction) against a broader set of real wines than
 * what's seeded in the dev database, to gauge how often each stage
 * succeeds — plus, as of Phase 8, how often a drinking window / vintage
 * character / value signal is captured alongside the score. Uses real
 * Serper/Puppeteer/OpenAI calls (not mocked) — costs real API usage per run.
 *
 * Extended 2026-08-02 to report *which* stage failed per wine/retailer
 * (zero search results / no relevant match / request failed / render
 * failed / no score citation / success), not just an aggregate hit-rate
 * number. Before this, a one-off miss (e.g. the Woodland Hills/Fèvre case
 * that motivated the relaxed-query retry in find-product-page.ts) required
 * a fresh live-debugging session to even find out which of these five
 * possible failure points it was. Calls findProductPageDetailed directly
 * (rather than going through fetchReviewData, which collapses all of Step
 * 1's failure modes to a single null) — same underlying function
 * fetchReviewData itself calls, so this isn't a second implementation of
 * the matching/query logic, just added observability in the glue code.
 *
 * Kept as a dev tool per build-phases.md Phase 7's open question on
 * keyword-window hit rate: re-run whenever RETAILER_CONFIG changes (e.g.
 * a newly-added retailer like JJ Buckley, 2026-08-02) or the
 * windowing/extraction/query logic changes, to confirm hit rate hasn't
 * regressed. Edit the WINES list below to whatever set you want to
 * validate against; writes a JSON summary to the repo root (gitignored —
 * not meant to be committed).
 *
 * Run: npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/scripts/validate-reviews.ts
 */
import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(__dirname, '../../.env') })

import fs from 'fs'
import OpenAI from 'openai'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { findProductPageDetailed, findFallbackProductPage, type Step1Stage } from '../modules/reviews/find-product-page'
import { renderPageHtml } from '../modules/reviews/puppeteer-extract'
import { extractCandidateText } from '../modules/reviews/keyword-window'
import { extractFromRenderedHtml } from '../modules/reviews/gpt-extract'
import type { CriticScore } from '../modules/reviews/types'

interface WineProbe {
  label: string
  producer: string | null
  denomination: string | null
  vintage: number | null
  cuvee?: string | null
  vineyard?: string | null
}

// Phase 8 real-world validation set (2026-07-29) — developer's cellar list.
// The last two entries (2026-08-02) are the wines from the JJ
// Buckley/Woodland Hills reports that motivated this script's stage-level
// diagnostics and the relaxed-query retry fix.
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
  { label: '2019 William Fèvre Chablis 1er Cru "Montée de Tonnerre"', producer: 'William Fèvre', denomination: 'Chablis 1er Cru', vintage: 2019, vineyard: 'Montée de Tonnerre' },
  { label: '2019 Domaine de Saint Préfert Châteauneuf-du-Pape Réserve Auguste Favier', producer: 'Domaine de Saint Préfert', denomination: 'Châteauneuf-du-Pape Réserve Auguste Favier', vintage: 2019 },
]

type RetailerStage = Step1Stage | 'render_failed' | 'no_extraction' | 'success'

interface RetailerOutcome {
  slug: string
  name: string
  stage: RetailerStage
  variantsTried: number
  product_url: string | null
  critic_scores: CriticScore[]
}

interface WineOutcome {
  label: string
  retailers: RetailerOutcome[]
  // Whether the open-web fallback pass (Phase 7.3, 2026-08-02) fired for
  // this wine — i.e. every configured retailer above returned zero critic
  // scores. Reported separately from `retailers` (which only covers
  // RETAILER_CONFIG entries) so a run of this script can directly answer
  // Phase 7.3's completion criteria #2/#3 (build-phases.md): does the
  // fallback fire only when configured retailers find nothing, and does it
  // actually populate a result when one exists on the open web?
  fallback: RetailerOutcome | null
}

async function probeRetailer(
  identity: { producer: string; denomination: string; vintage: number | null; cuvee: string | null; vineyard: string | null },
  openai: OpenAI,
  serperKey: string,
  step1: { url: string | null; stage: Step1Stage; variantsTried: number },
  slug: string,
  name: string
): Promise<RetailerOutcome> {
  if (!step1.url) {
    return { slug, name, stage: step1.stage, variantsTried: step1.variantsTried, product_url: null, critic_scores: [] }
  }

  const html = await renderPageHtml(step1.url)
  if (!html) {
    return { slug, name, stage: 'render_failed', variantsTried: step1.variantsTried, product_url: step1.url, critic_scores: [] }
  }

  const candidateText = extractCandidateText(html)
  const extraction = await extractFromRenderedHtml(openai, candidateText, step1.url)
  if (!extraction) {
    return { slug, name, stage: 'no_extraction', variantsTried: step1.variantsTried, product_url: step1.url, critic_scores: [] }
  }

  return { slug, name, stage: 'success', variantsTried: step1.variantsTried, product_url: step1.url, critic_scores: extraction.critic_scores }
}

async function probeWine(wine: WineProbe, openai: OpenAI, serperKey: string): Promise<WineOutcome> {
  const identity = {
    producer: wine.producer ?? '',
    denomination: wine.denomination ?? '',
    vintage: wine.vintage ?? null,
    cuvee: wine.cuvee ?? null,
    vineyard: wine.vineyard ?? null,
  }

  const retailers = await Promise.all(
    RETAILER_CONFIG.map(async (retailer): Promise<RetailerOutcome> => {
      const step1 = await findProductPageDetailed(identity, retailer, serperKey)
      return probeRetailer(identity, openai, serperKey, step1, retailer.slug, retailer.name)
    })
  )

  // Same gate fetchReviewData uses: only probe the fallback when every
  // configured retailer above came back with zero critic scores.
  const hasAnyScore = retailers.some(r => r.critic_scores.length > 0)
  let fallback: RetailerOutcome | null = null
  if (!hasAnyScore) {
    const step1 = await findFallbackProductPage(identity, serperKey)
    let hostname = 'unknown-source'
    try {
      hostname = step1.url ? new URL(step1.url).hostname.replace(/^www\./, '') : hostname
    } catch {
      // leave placeholder
    }
    fallback = await probeRetailer(identity, openai, serperKey, step1, `fallback-${hostname}`, hostname)
  }

  return { label: wine.label, retailers, fallback }
}

function makeStageCounter(): Record<RetailerStage, number> {
  return {
    request_failed: 0,
    zero_results: 0,
    no_relevant_match: 0,
    render_failed: 0,
    no_extraction: 0,
    success: 0,
    found: 0, // not reachable as a final stage (found → render/extract runs next), kept for type completeness
  }
}

async function main() {
  const serperKey = process.env.SERPER_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!serperKey || !openaiKey) {
    console.error('SERPER_API_KEY and OPENAI_API_KEY must both be set in .env to run this script.')
    process.exit(1)
  }
  const openai = new OpenAI({ apiKey: openaiKey })

  const results: WineOutcome[] = []

  for (const w of WINES) {
    process.stdout.write(`\n→ ${w.label} ... `)
    const start = Date.now()
    const outcome = await probeWine(w, openai, serperKey)
    const secs = ((Date.now() - start) / 1000).toFixed(1)
    const scoreCount = outcome.retailers.reduce((n, r) => n + r.critic_scores.length, 0)
    const successCount = outcome.retailers.filter(r => r.stage === 'success').length
    process.stdout.write(`${successCount} retailer(s) matched, ${scoreCount} score(s) (${secs}s)\n`)
    for (const r of outcome.retailers) {
      if (r.stage === 'zero_results' || r.stage === 'request_failed') continue // noisy — most retailers won't carry most wines
      const retryNote = r.variantsTried > 1 ? ` [found on retry, ${r.variantsTried} variants tried]` : ''
      console.log(`    ${r.slug}: ${r.stage}${retryNote}${r.product_url ? ` — ${r.product_url}` : ''}`)
      for (const s of r.critic_scores) {
        const bits: string[] = [`★ ${s.publication}: ${s.score}`]
        if (s.drinking_window) bits.push(`drink ${s.drinking_window.start ?? '?'}–${s.drinking_window.end ?? '?'}`)
        if (s.vintage_character) bits.push(`vintage: ${s.vintage_character}`)
        if (s.deal) bits.push('DEAL')
        console.log(`      ${bits.join('  |  ')}`)
      }
    }
    if (outcome.fallback) {
      // Presence of this block at all confirms the gate fired correctly —
      // every configured retailer above returned zero scores.
      console.log(`    [fallback pass fired] ${outcome.fallback.slug}: ${outcome.fallback.stage}${outcome.fallback.product_url ? ` — ${outcome.fallback.product_url}` : ''}`)
      for (const s of outcome.fallback.critic_scores) {
        console.log(`      ★ ${s.publication}: ${s.score}`)
      }
    }
    results.push(outcome)
  }

  const outPath = path.resolve(__dirname, '../../validate-reviews-results.json')
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log(`\nWrote ${outPath}`)

  // ─── Per-stage breakdown ──────────────────────────────────────────────
  const stageCounts = makeStageCounter()
  let retriedAndFound = 0
  for (const outcome of results) {
    for (const r of outcome.retailers) {
      stageCounts[r.stage] += 1
      if (r.stage === 'success' && r.variantsTried > 1) retriedAndFound += 1
    }
  }
  const totalAttempts = results.length * RETAILER_CONFIG.length
  console.log(`\nStage breakdown across ${totalAttempts} wine×retailer attempts:`)
  console.log(`  success:            ${stageCounts.success}`)
  console.log(`  no_extraction:      ${stageCounts.no_extraction}  (rendered, but no score citation found)`)
  console.log(`  render_failed:      ${stageCounts.render_failed}  (Puppeteer render failed/timed out)`)
  console.log(`  no_relevant_match:  ${stageCounts.no_relevant_match}  (Serper returned results, none matched)`)
  console.log(`  zero_results:       ${stageCounts.zero_results}  (Serper returned nothing at all — most are just retailers that don't carry the wine)`)
  console.log(`  request_failed:     ${stageCounts.request_failed}  (Serper request itself errored)`)
  console.log(`  found on a relaxed-query retry (2026-08-02 fix): ${retriedAndFound}`)

  // ─── Open-web fallback pass (Phase 7.3, 2026-08-02) ───────────────────
  // Directly answers build-phases.md Phase 7.3's completion criteria #2/#3:
  // does the fallback fire only when configured retailers found nothing
  // (fallbackFired should equal wines-with-zero-configured-scores, never
  // more), and does it actually find something when a relevant page exists.
  const winesFired = results.filter(r => r.fallback !== null)
  const winesFiredAndFound = winesFired.filter(r => r.fallback!.stage === 'success')
  console.log(`\nOpen-web fallback pass fired for ${winesFired.length}/${results.length} wines (i.e. that many had zero scores from all configured retailers).`)
  console.log(`  Of those, found a relevant page and extracted at least a rendered result: ${winesFiredAndFound.length}`)
  console.log(`  Of those, extraction actually cited a score: ${winesFired.filter(r => r.fallback!.critic_scores.length > 0).length}`)

  // ─── Existing aggregate/Phase 8 summary ──────────────────────────────
  const allScores = results.flatMap(r => [...r.retailers, ...(r.fallback ? [r.fallback] : [])].flatMap(x => x.critic_scores))
  const totalScores = allScores.length
  const winesWithAnyScore = results.filter(r =>
    r.retailers.some(x => x.critic_scores.length > 0) || (r.fallback?.critic_scores.length ?? 0) > 0
  ).length
  const withWindow = allScores.filter(s => s.drinking_window !== null).length
  const withVintageChar = allScores.filter(s => s.vintage_character !== null).length
  const withDeal = allScores.filter(s => s.deal).length
  console.log(`\nSummary: ${winesWithAnyScore}/${results.length} wines had at least one attributed score (configured or fallback). ${totalScores} total scores found.`)
  console.log(`Phase 8 fields (of ${totalScores} scores): ${withWindow} with a drinking window, ${withVintageChar} with a vintage character, ${withDeal} flagged as a deal.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
