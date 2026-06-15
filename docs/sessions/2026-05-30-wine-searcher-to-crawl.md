# Session: Replace Wine-Searcher with Retailer Web Crawl
> Date: 2026-05-30 | Branch: feature/detail-and-scan-ui

## What was done

### Decision context
Wine-Searcher API was evaluated and ruled out — Wine Check API ($335/month) + Market Price API ($350/month) = $685/month minimum. The docs were updated by the developer to reflect the architectural decision before this session began.

### Code changes

**Replaced** the Wine-Searcher API integration in `backend/modules/price/` with a GPT-4o-powered retailer HTML crawl approach. The same `price_data` field on the wine entry stores the result — the storage adapter and DB schema are unchanged.

**Commits:**
- `service: replace wine-searcher api with gpt-4o retailer html crawl`
- `docs: update docs and session summary — wine-searcher replaced by crawl`

### Files changed

| File | Change |
|---|---|
| `backend/modules/price/index.ts` | Full rewrite: Wine-Searcher API call → parallel GPT-4o HTML extraction across 4 retailers |
| `backend/modules/price/types.ts` | Wine-Searcher response types → crawl result types (`CrawlResult`, `RetailerCrawlResult`, `GptPageExtraction`) |
| `backend/modules/price/retailer-coords.ts` | New: static lat/lng + search URL builders for K&L (NYC store), Zachys, Woodland Hills, Benchmark |
| `backend/modules/price/PROMPT.md` | New: documents GPT-4o extraction prompt, rules, and expected output shape |
| `backend/modules/price/price.test.ts` | 8 new tests covering crawl logic, price aggregation, critic score extraction, nearest retailer, graceful degradation |
| `shared/types.ts` | `PriceData`: field names updated (`price_min/avg/max`), `nearest_retailer` added, `ws_score` removed. `RetailerPrice`: added `slug`, `critic_scores`, `distance_miles` |
| `shared/utils/proximity.ts` | New: Haversine distance utility (pure function, no side effects) |
| `backend/routes/wines.ts` | Route updated: new stored shape, updated error message |
| `web/src/components/PriceSection.tsx` | Updated UI: attributed critic scores per publication, nearest retailer with distance and link, "Wine-Searcher" label removed |
| `.env.example` | Removed `WINE_SEARCHER_API_KEY`, `BURGHOUND_USERNAME/PASSWORD`, `VINOUS_USERNAME/PASSWORD` |
| `backend/sheets/__tests__/SheetsAdapter.unit.test.ts` | Updated price_data fixture to new field names |

## Key decisions

**No DB schema migration required.** The `price_data` column continues to store the result as a JSON blob. Only the blob's shape changed — the storage adapter is unaffected.

**K&L NYC store used for proximity.** K&L has a store at 45 W 36th St, Manhattan. This makes K&L the nearest retailer to the NYC reference point (40.7128, -74.006). Zachys (Port Chester, NY) is second-nearest.

**OpenAI key reused.** The crawl uses `OPENAI_API_KEY` — no new credential required. This is the same key used for label scanning and Reddit synthesis.

**Critic scores are attributed, never blended.** Each retailer's page is parsed independently. Scores are deduplicated by publication in the UI (first occurrence kept) so the same Burghound score appearing on K&L and Benchmark doesn't show twice.

**Search URL patterns need live verification.** The URLs in `retailer-coords.ts` are plausible but have not been tested against live retailer sites. Verify and adjust in Phase 8 (data review checkpoint).

## Test results

- Backend: 99 passed, 4 skipped, 0 failed (5 suites)
- Web: 2 pre-existing suite failures (JSX/babel config issue, unrelated to this change)
- TypeScript: clean on both backend and web (`tsc --noEmit`)

## What's next

- Phase 7: Reddit community data module
- Phase 8: Data review checkpoint — verify crawl success rates across the 4 retailers, confirm search URL patterns resolve correctly, check critic score extraction quality on real Burgundy/Barolo/Rioja bottles
