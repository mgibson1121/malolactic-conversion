# Session: Phase 6 rewrite — Google Shopping + Puppeteer
> Date: 2026-06-14 | Branch: feature/detail-and-scan-ui

## What was done

The Phase 6 price enrichment module was fully rewritten to replace a strategy that was failing in production. The previous approach (`fetch()` → GPT-4o HTML parsing) consistently returned empty shells (~768 bytes) from Zachys, Woodland Hills, and Benchmark because all three are SPAs that only render product data after JavaScript executes server-side fetch cannot trigger.

### Commits
- `chore: add puppeteer dev dependency for headless SPA rendering`
- `chore: add GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID to env config`
- `service: add retailers config and proximity re-export for price module`
- `service: add Google Custom Search JSON API query module (Step 1)`
- `service: add Puppeteer render and GPT-4o extraction modules (Step 2)`
- `service: rewrite price module — two-step Google Shopping + Puppeteer workflow`
- `test: rewrite price module tests — mock CSE API and Puppeteer`

### New module structure

```
backend/modules/price/
├── index.ts              # Orchestrates Step 1 + Step 2
├── shopping-query.ts     # Google Custom Search JSON API (Step 1)
├── puppeteer-extract.ts  # Headless Chromium render (Step 2)
├── gpt-extract.ts        # GPT-4o extraction from rendered HTML (Step 2)
├── retailers.config.ts   # Typed retailer config array (slug, name, domain, lat, lng)
├── proximity.ts          # Re-exports shared/utils/proximity.ts
├── types.ts              # Module types
├── PROMPT.md             # GPT-4o extraction prompt documentation
└── price.test.ts         # 13 unit tests (mocked CSE + mocked Puppeteer)
```

## Key decisions

**Why Google Custom Search JSON API:** Google has already crawled and rendered the SPA retailer pages and indexed the results. The CSE API returns clean structured data (retailer name, price, product URL) without needing to render anything ourselves. Free tier: 100 queries/day — sufficient for personal use.

**Why Puppeteer for Step 2:** Critic scores are embedded in dynamically rendered DOM content that Google's Shopping index doesn't capture. Puppeteer opens each product URL in a headless Chromium browser, waits for `networkidle2`, then passes the fully rendered HTML to GPT-4o for score extraction.

**Puppeteer as devDependency:** Only used at runtime (never in CI). Tests mock `puppeteer-extract.ts` via `jest.mock` so Puppeteer never runs during test execution. Installed in `backend/package.json` devDependencies.

**retailer-coords.ts retired:** Replaced by `retailers.config.ts` which follows the typed config array pattern described in the spec (`slug`, `name`, `domain`, `lat`, `lng`). The `domain` field is used to filter CSE results; the `lat/lng` for Haversine proximity.

**Two-step price precedence:** Step 2 (Puppeteer/GPT) price overrides Step 1 (CSE) price when both are present, since the live rendered page is more authoritative than the Google Shopping index.

## Bugs found and fixed

- `shopping-query.ts` initially imported `RetailerResult` from `retailers.config.ts` — type lives in `types.ts`. Fixed import before first test run.
- Root `package.json` acquired a duplicate `devDependencies` block during installation. Fixed by rewriting the file to remove the root-level puppeteer entry (it belongs only in `backend/package.json`).

## Test results

13 new tests, all passing. Full suite: 104 tests passed, 4 skipped, 0 failed.

## What's next

**Before Phase 6 can close:** A manual test must be run against a real bottle:
1. Ensure `GOOGLE_CSE_API_KEY` and `GOOGLE_CSE_ID` are set in `.env` (requires creating a Google Programmable Search Engine scoped to Google Shopping results)
2. Scan a real bottle via the web UI
3. Trigger `POST /api/wines/:id/fetch-price`
4. Inspect the DB entry — confirm non-null `price_min`, `price_avg`, `price_max`, `price_fetched_at`, `price_retailers`, `nearest_retailer`
5. Confirm at least one retailer result has a non-empty `critic_scores` array

Document which retailers returned scores in the next session summary.

After Phase 6 manual test passes → Phase 6.5 (scan review UI + wine detail view) and Phase 6.6 (retailer review links) are already built on this branch.
