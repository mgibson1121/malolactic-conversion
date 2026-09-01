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
 * Extended again 2026-08-04 (Phase 9.1, WI-10) to report *per stage, per
 * retailer* rather than an aggregate hit rate — and, for anything rejected,
 * the MatchVerdict that rejected it. The 2026-08-04 batch's real failure was
 * not missing data but wrong data presented as right, which an aggregate hit
 * rate cannot show: nine Château Lafleur scores stored against Château Grand
 * Village counted as nine successes. So this now also reports vintage
 * accuracy across score-bearing results, and names the retailers not in
 * RETAILER_CONFIG that were therefore never searched at all — a config gap
 * otherwise renders identically to a real miss.
 *
 * Runs the 14-wine 2026-08-04 batch by default, from the same fixture the
 * offline regression suite pins (backend/tests/fixtures/ground-truth-wines.ts
 * and backend/tests/unit/ground-truth.test.ts), so the live run and the CI
 * run are talking about one set rather than two drifting lists. Set
 * VALIDATE_SET=cellar for the Phase 8 cellar list instead. Writes a JSON
 * summary to the repo root (gitignored — not meant to be committed).
 *
 * Run: npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/scripts/validate-reviews.ts
 */
import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(__dirname, '../../.env') })

import fs from 'fs'
import OpenAI from 'openai'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import {
  findProductPageDetailed,
  findFallbackProductPage,
  type Step1Stage,
  type Step1Outcome,
  type RejectedCandidate,
} from '../modules/reviews/find-product-page'
import type { MatchVerdict } from '@shared/utils/wine-match'
import { renderPageHtml } from '../modules/reviews/puppeteer-extract'
import { extractCandidateText } from '../modules/reviews/keyword-window'
import { extractFromRenderedHtml } from '../modules/reviews/gpt-extract'
import type { CriticScore } from '../modules/reviews/types'
import { BATCH_WINES } from '../tests/fixtures/ground-truth-wines'
import { getLifetimeUsage } from '@shared/utils/serper-client'

interface WineProbe {
  label: string
  producer: string | null
  denomination: string | null
  vintage: number | null
  cuvee?: string | null
  vineyard?: string | null
}

// The 2026-08-04 batch, from the shared ground-truth fixture (Phase 9.1).
// Same 14 wines the offline regression suite pins
// (backend/tests/unit/ground-truth.test.ts), so a live run here and a CI run
// there are talking about the same set rather than two drifting lists.
//
// Set VALIDATE_SET=cellar to run the Phase 8 list below instead.
const BATCH_PROBES: WineProbe[] = BATCH_WINES.map(w => ({
  label: w.label,
  producer: w.producer,
  denomination: w.denomination,
  vintage: w.vintage,
  cuvee: w.cuvee ?? null,
  vineyard: w.vineyard ?? null,
}))

// Phase 8 real-world validation set (2026-07-29) — developer's cellar list.
// The last two entries (2026-08-02) are the wines from the JJ
// Buckley/Woodland Hills reports that motivated this script's stage-level
// diagnostics and the relaxed-query retry fix.
const CELLAR_WINES: WineProbe[] = [
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

// A 5-wine slice of the batch (Phase 9.2, WI-7) — chosen to cover most of the
// fixture's KNOWN_GOOD/KNOWN_BAD cases in one cheap run, so a dry run can
// sanity-check both the yield-table code and the matcher's live behaviour
// before committing to the full 14-wine spend. Grand Village (Lafleur trap +
// Zachys dead-vintage link), Gour de Chaulé (Famille Perrin trap + Flatiron's
// clean hit), Montus (Brumont trap), Mangot (Woodland Hills + JJ Buckley
// clean hits), Jean-Marc Vincent (Morrell honorific-relaxed hit).
const DRY_RUN_LABELS = [
  'Grand Village · Vin de France 2022',
  'Gour de Chaulé · Gigondas 2022',
  'Montus · Madiran 2022',
  'Mangot · Saint-Émilion 2022',
  'Jean-Marc Vincent · Santenay 2022',
]
const DRY_RUN_WINES: WineProbe[] = BATCH_PROBES.filter(w => DRY_RUN_LABELS.includes(w.label))

const WINES: WineProbe[] =
  process.env.VALIDATE_SET === 'cellar'
    ? CELLAR_WINES
    : process.env.VALIDATE_SET === 'dry-run'
      ? DRY_RUN_WINES
      : BATCH_PROBES

/**
 * Where a wine×retailer attempt actually stopped (Phase 9.1, WI-10).
 *
 * `success` was previously the only positive outcome and covered both "found
 * scores" and "rendered fine, cited nothing" — which are very different
 * problems. `no_score_citation` separates them, and `found` now means what it
 * says. The distinction matters because the two have opposite fixes: one is a
 * windowing/extraction question, the other is a coverage question.
 */
type RetailerStage =
  | Step1Stage           // request_failed | zero_results | no_relevant_match | found
  | 'render_failed'      // Puppeteer couldn't render the page
  | 'no_extraction'      // rendered, but GPT-4o extraction failed outright
  | 'no_score_citation'  // rendered and extracted, but the page cites no score
  | 'success'            // at least one attributed score captured

interface RetailerOutcome {
  slug: string
  name: string
  stage: RetailerStage
  variantsTried: number
  product_url: string | null
  critic_scores: CriticScore[]
  /** The verdict the accepted page was judged on — which dimensions were
   * confirmed, and how far off the vintage is. Null when nothing matched. */
  match: MatchVerdict | null
  /** Vintage the rendered page itself stated, when it stated one. */
  page_vintage: number | null
  vintage_gap: number | null
  /** What was on offer and why each was turned down. Populated only for
   * no_relevant_match, which is otherwise the least legible outcome in the
   * pipeline: a bare "nothing matched" tells you neither what Serper
   * returned nor which dimension disqualified it. */
  rejected: RejectedCandidate[]
}

/** One line per rejected dimension, e.g. "producer=mismatch denom=match". */
function describeVerdict(v: MatchVerdict | null): string {
  if (!v) return 'url-shape rejected (not a product page)'
  const gap = v.vintageGap === null ? '?' : String(v.vintageGap)
  return `producer=${v.producer} denom=${v.denomination} bottling=${v.bottling} vintage=${v.vintage}(gap ${gap})`
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
  step1: Step1Outcome,
  slug: string,
  name: string
): Promise<RetailerOutcome> {
  const base = {
    slug,
    name,
    variantsTried: step1.variantsTried,
    match: step1.match,
    page_vintage: step1.match?.candidateVintage ?? null,
    vintage_gap: step1.match?.vintageGap ?? null,
    rejected: step1.rejected,
  }

  if (!step1.url) {
    return { ...base, stage: step1.stage, product_url: null, critic_scores: [] }
  }

  const html = await renderPageHtml(step1.url)
  if (!html) {
    return { ...base, stage: 'render_failed', product_url: step1.url, critic_scores: [] }
  }

  const candidateText = extractCandidateText(html)
  const extraction = await extractFromRenderedHtml(openai, candidateText, step1.url)
  if (!extraction) {
    return { ...base, stage: 'no_extraction', product_url: step1.url, critic_scores: [] }
  }

  // The rendered page's own vintage supersedes anything read off the search
  // result — same rule fetchReviewData applies (see verdictFromPage there).
  const pageVintage = extraction.vintage
  const gap =
    pageVintage !== null && identity.vintage !== null ? Math.abs(pageVintage - identity.vintage) : base.vintage_gap

  return {
    ...base,
    page_vintage: pageVintage ?? base.page_vintage,
    vintage_gap: gap,
    // Rendered and extracted, but nothing attributed — a different problem
    // from "found scores", and one with a different fix.
    stage: extraction.critic_scores.length > 0 ? 'success' : 'no_score_citation',
    product_url: step1.url,
    critic_scores: extraction.critic_scores,
  }
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
    no_score_citation: 0,
    success: 0,
    found: 0, // not reachable as a final stage (found → render/extract runs next), kept for type completeness
  }
}

/** Retailers this wine was never searched at, because they aren't in
 * RETAILER_CONFIG. Reported explicitly (Phase 9.1) because a config gap
 * otherwise renders identically to a real miss — which is exactly what
 * happened with JJ Buckley on 2026-08-02, and again with sommpicks.com and
 * farrvintners.com in the 2026-08-04 batch. */
function reportNotConfigured(): void {
  console.log(
    `\nnot_configured: any retailer outside RETAILER_CONFIG's ${RETAILER_CONFIG.length} domains was never searched.`
  )
  console.log('  If a wine is known to be stocked somewhere absent from the per-retailer lines above,')
  console.log('  check shared/config/retailers.config.ts before treating it as a query or matching bug.')
}

/**
 * Per-retailer yield table (Phase 9.2, WI-7).
 *
 * This is the calibration input for reviewTier: for each RETAILER_CONFIG
 * entry, across the batch, how often it was worth asking and how much asking
 * cost. "Pages found" counts anything Step 1 accepted (product_url set,
 * regardless of what Step 2 did with it); "right wine + vintage" is the
 * stricter column that actually justifies primary tier — a page can be
 * accepted (producer/denomination/bottling all match) and still be a
 * different vintage, which is kept and labelled everywhere else in this
 * pipeline but should not count as evidence a retailer is a cheap, reliable
 * primary source.
 *
 * Credits spent per retailer come from shared/utils/serper-client.ts's
 * lifetime tally under this script's own label (`reviews:configured:<slug>`,
 * the default findProductPageDetailed uses when no explicit label is passed
 * — see probeRetailer below) — a fresh process each run, so the lifetime
 * counter starts at zero and needs no reset.
 */
interface RetailerYieldRow {
  slug: string
  name: string
  winesSearched: number
  zeroResults: number
  noRelevantMatch: number
  pagesFound: number
  rightWineVintageScores: number
  anyVintageScores: number
  creditsSpent: number
  scoresPerCredit: number
}

function computeRetailerYield(results: WineOutcome[]): RetailerYieldRow[] {
  const usage = getLifetimeUsage()
  return RETAILER_CONFIG.map(retailer => {
    const outcomes = results.map(r => r.retailers.find(x => x.slug === retailer.slug)).filter((r): r is RetailerOutcome => r !== undefined)
    const creditsSpent = usage.by_label[`reviews:configured:${retailer.slug}`]?.attempts ?? 0
    const rightWineVintageScores = outcomes
      .filter(o => o.stage === 'success' && o.vintage_gap === 0)
      .reduce((n, o) => n + o.critic_scores.length, 0)
    const anyVintageScores = outcomes
      .filter(o => o.stage === 'success')
      .reduce((n, o) => n + o.critic_scores.length, 0)
    return {
      slug: retailer.slug,
      name: retailer.name,
      winesSearched: outcomes.length,
      zeroResults: outcomes.filter(o => o.stage === 'zero_results').length,
      noRelevantMatch: outcomes.filter(o => o.stage === 'no_relevant_match').length,
      pagesFound: outcomes.filter(o => o.product_url !== null).length,
      rightWineVintageScores,
      anyVintageScores,
      creditsSpent,
      scoresPerCredit: creditsSpent > 0 ? rightWineVintageScores / creditsSpent : 0,
    }
  })
}

function printRetailerYieldTable(results: WineOutcome[]): void {
  const rows = computeRetailerYield(results).sort((a, b) => b.scoresPerCredit - a.scoresPerCredit)
  console.log('\n─── Per-retailer yield table (WI-7 calibration input) ───────────────────')
  console.log(
    '  retailer          searched  zero  no-match  pages  right-wine+vintage  any-vintage  credits  scores/credit'
  )
  for (const r of rows) {
    console.log(
      `  ${r.slug.padEnd(16)}  ${String(r.winesSearched).padStart(8)}  ${String(r.zeroResults).padStart(4)}  ` +
        `${String(r.noRelevantMatch).padStart(8)}  ${String(r.pagesFound).padStart(5)}  ` +
        `${String(r.rightWineVintageScores).padStart(18)}  ${String(r.anyVintageScores).padStart(11)}  ` +
        `${String(r.creditsSpent).padStart(7)}  ${r.scoresPerCredit.toFixed(3).padStart(13)}`
    )
  }
  console.log('  ("right-wine+vintage" = scores from a page whose producer/denomination/bottling were')
  console.log('   accepted AND whose vintage gap is exactly 0 — the column that justifies primary tier.')
  console.log('   "any-vintage" includes accepted-but-off-vintage pages, kept per Phase 9.1 but not counted')
  console.log('   toward scores-per-credit, since a wrong-vintage score doesn\'t answer "should this be asked first?".)')
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

      // What the page was judged to be, and how far off. A wrong-vintage
      // result is kept deliberately (vintage ranks and labels, it never
      // rejects), so it has to be legible here rather than look like a pass.
      if (r.match) {
        const gapNote =
          r.vintage_gap !== null && r.vintage_gap > 0
            ? `  ⚠ page is ${r.page_vintage} — ${r.vintage_gap} year(s) off`
            : ''
        console.log(`      verdict: ${describeVerdict(r.match)}${gapNote}`)
      }

      // Why nothing was accepted — the line that turns the next report from
      // a debugging session into a log read.
      for (const rej of r.rejected) {
        console.log(`      ✗ rejected: ${rej.title}`)
        console.log(`          ${rej.url}`)
        console.log(`          ${describeVerdict(rej.verdict)}`)
      }

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
  console.log(`  success:            ${stageCounts.success}  (at least one attributed score captured)`)
  console.log(`  no_score_citation:  ${stageCounts.no_score_citation}  (right page, rendered and extracted, but it cites no score)`)
  console.log(`  no_extraction:      ${stageCounts.no_extraction}  (GPT-4o extraction failed outright)`)
  console.log(`  render_failed:      ${stageCounts.render_failed}  (Puppeteer render failed/timed out)`)
  console.log(`  no_relevant_match:  ${stageCounts.no_relevant_match}  (Serper returned results, none matched — see the ✗ lines above for which dimension)`)
  console.log(`  zero_results:       ${stageCounts.zero_results}  (Serper returned nothing at all — most are just retailers that don't carry the wine)`)
  console.log(`  request_failed:     ${stageCounts.request_failed}  (Serper request itself errored)`)
  console.log(`  found on a relaxed-query retry (2026-08-02 fix): ${retriedAndFound}`)
  reportNotConfigured()

  // ─── Vintage accuracy (Phase 9.1) ─────────────────────────────────────
  // The headline failure of the 2026-08-04 batch was not missing data, it
  // was wrong-vintage data presented as if it were right. Wrong-vintage
  // results are kept on purpose now, so this has to be measured rather than
  // assumed away.
  const matched = results.flatMap(r => r.retailers).filter(r => r.stage === 'success')
  const exactVintage = matched.filter(r => r.vintage_gap === 0).length
  const offVintage = matched.filter(r => r.vintage_gap !== null && r.vintage_gap > 0)
  const unknownVintage = matched.filter(r => r.vintage_gap === null).length
  console.log(`\nVintage accuracy across ${matched.length} score-bearing results:`)
  console.log(`  exact vintage:      ${exactVintage}`)
  console.log(`  different vintage:  ${offVintage.length}  (kept and labelled — excluded from drinking_window/vintage_rating derivation)`)
  console.log(`  vintage unknown:    ${unknownVintage}  (page stated no year; also excluded from derivation)`)
  for (const r of offVintage) {
    console.log(`    ${r.slug}: page is ${r.page_vintage}, ${r.vintage_gap} year(s) off — ${r.critic_scores.length} score(s)`)
  }

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

  // ─── Per-retailer yield table (Phase 9.2, WI-7) ───────────────────────
  printRetailerYieldTable(results)

  // ─── Serper spend for this process (Phase 9.2, WI-1/WI-7) ────────────
  // A fresh process each run, so the lifetime counter started at zero —
  // this total is exactly what this run cost.
  const usage = getLifetimeUsage()
  console.log(`\n─── Serper spend this run ─────────────────────────────────────────────`)
  console.log(`  total calls: ${usage.calls}  |  total attempts (billed): ${usage.attempts}  |  failed: ${usage.failed}  |  avoided: ${usage.avoided}`)
  console.log('  by label:')
  for (const [label, counts] of Object.entries(usage.by_label).sort((a, b) => b[1].attempts - a[1].attempts)) {
    console.log(`    ${label.padEnd(40)} calls=${counts.calls} attempts=${counts.attempts} failed=${counts.failed} avoided=${counts.avoided}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
