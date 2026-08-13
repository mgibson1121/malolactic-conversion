# Handoff — price module hardening (branch `fix/rerun-findings`, PR #18)

> Written 2026-08-05 to resume cold in a new session.
> Read `docs/CLAUDE.md` §5 (wine identity) and §15 (constraints) first.

---

## Where things stand

**Merged already:** Phase 9.1 identity matching, PR #16 → `main` (`d918f15`). Spec at
`docs/specs/2026-08-04-phase-9.1-identity-matching-remediation.md`, evidence at
`docs/sessions/2026-08-04-core-functionality-defect-taxonomy.md`, session notes at
`docs/sessions/2026-08-05-phase-9.1-identity-matching.md`. Someone also merged
PR #17 (disagreeing critic drinking windows in the UI) on top.

**Open:** PR #18, branch `fix/rerun-findings`. Three commits, all pushed:

| Commit | What |
|---|---|
| `214c98e` | dedupe K&L entry; correct the dead-link metric |
| `c05539b` | stop verification silently dropping every fallback retailer |
| `6513bfa` | retailer selection, prices, product links, price aggregation |

**Tests: 340 passing, 13 suites. `tsc --noEmit` clean in `backend/` and `web/`.**

---

## What PR #18 fixes

Four issues the developer reported from manual testing:

1. **Preferred-first selection.** There was no such rule — just a flat cap of 8 on a
   merged list. Now every matching preferred retailer is returned however many there
   are, and non-preferred only top the list up to `TARGET_RETAILER_COUNT` (5). Fewer
   than 5 is a fine result, not a reason to withhold what was found.
2. **Prices on preferred retailers.** `GptPageExtraction.price` was computed and
   dropped — the same bug class as the vintage before Phase 9.1. Now carried as
   `page_price` on `RetailerReview` and fed to `price/` via the router.
3. **Product-page links.** Serper Shopping returns *no* merchant domain and *no*
   product URL (verified live: `title, source, link, price, imageUrl, productId,
   position, rating, ratingCount`). The router now resolves each non-preferred
   merchant to a real product page using `reviews/`'s `findMerchantProductPage`.
4. **min/avg/max.** Outliers ($2,044 Rully, $299 village Marsannay — cases and large
   formats with no size in the title) excluded from headline figures by an
   interquartile fence **in log space**; rows stay in the list. Wines whose only
   prices are for another vintage now report `other_vintage_price_range`.

Plus two data-loss bugs the verification run exposed:

5. **No concurrency cap.** `reviews/` fanned out over 12 retailers × up to 4 queries
   with `Promise.all`. Bounded to 3 in flight with retry/backoff on 429/5xx —
   `shared/utils/concurrency.ts`.
6. **A failed search stored as an empty one.** *The serious one.* `querySerper`
   caught a transport failure, returned an empty result, and the route wrote it over
   good data. Same on the reviews side. Both now report failure distinctly and return
   `null`; routes return 503 and write nothing.

---

## Two decisions that departed from a literal reading (already flagged in PR #16)

- `vintage_mismatch` keeps its "confirmed different year" meaning; `vintage_verdict`
  carries the third state. Flipping `unknown` to mismatch would have quietly excluded
  many real listings from `price_min/avg/max`.
- Only the vintage dimension is revised by the page-stated vintage. Re-running the
  whole matcher against a rendered page downgrades a confirmed producer to `mismatch`
  for retailers with opaque product slugs (`/products/details/1557135`).

---

## Current data state (after the 2026-08-05 re-run)

The 14 wines added `2026-08-04` are the test batch (`backend/db/checkpoint-wines.ts`).

```
wines with any data:      11/14
wines showing a price:    10/14  (+10 with an other-vintage range)
critic scores stored:     38
preferred w/ a price:     11/41
links: real product pages 68 | google searches 20
duplicate retailer slugs: 0
```

Bretadeau, Deleuze-Rochetin and Maxime Cottenceau are empty in *every* successful
run — genuinely obscure, not a failure.

---

## Open items, in priority order

1. **`$1,486` still in Bessin-Tremblay's other-vintage range.** `excludeOutliers`
   only engages at 4+ prices; that set is likely 3, so one absurd value dominates.
   The other-vintage range is advisory and doesn't need the headline figure's
   statistical caution — a looser sanity check is probably right. *Investigation was
   cut off mid-command; start by dumping that wine's `vintage_mismatch` prices.*
2. **Preferred retailers with a price: 11/41.** Break down how much is K&L
   (unpriceable by design), how much is review pages with no readable price, and how
   much is a real gap.
3. **`pickSingleAgreeing`'s unanimity rule** (`reviews/derive-wine-level.ts`) — needs
   a product decision, flagged in an `OPEN QUESTION` comment. Gets *worse* as coverage
   improves: Mangot derived `vintage_rating` from 1 critic out of 12.
4. **±3 vintage display threshold** — belongs with the UI build. 19 of 35 stored
   scores were off-vintage on one run; one was 32 years off (Montus/Benchmark 1990).
5. **Label scan accuracy** — out of scope but the input to everything:
   `producer: "Montus"` for Château Montus, `denomination: "Vin de France"` for a
   Bordeaux Supérieur, cuvee/vineyard null on all 14.

---

## Gotchas that cost time this session

- **`cd` persists between Bash calls.** Several commands failed with
  `backend/backend/...`. Always `cd` to the repo root explicitly.
- **The dev server does not hot-reload.** `npm start` is plain `ts-node`. After any
  backend edit, stop and restart the preview server or you are testing stale code.
- **Serper credits run out.** Symptom is `HTTP 400 {"message":"Not enough credits"}`
  and every call failing in ~60ms. Check before any batch run. Since fix 6 above, a
  credit-exhausted run is *safe* — routes 503 and write nothing.
- **A full batch is ~700–900 Serper calls.** Budget accordingly.
- **`git checkout main` mid-session** reverted the working tree to a stale local
  `main`. Nothing was lost (all committed), but fetch rather than checkout.

---

## Useful commands

Run the batch (reviews → price for all 14):
```bash
bash /private/tmp/claude-501/-Users-matthewgibson-Claude-Code-Projects-Wine-Project/ca6274cf-e277-4ebd-ab2a-a4e8ea62ceaa/scratchpad/rerun.sh
```

Before/after diff against the committed pre-Phase-9.1 snapshot:
```bash
npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/scripts/snapshot-enrichment.ts diff
```

Per-stage live diagnostics (costs API usage):
```bash
npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/scripts/validate-reviews.ts
```

Tests:
```bash
cd backend && npx tsc --noEmit && npx jest
```

Servers are started via `preview_start` with `{name: "backend"}` / `{name: "web"}`,
never via Bash. Ports 3000 and 5173.

---

## Backups

- `backend/tests/fixtures/enrichment-before-2026-08-04.json` — committed, the
  "before" half of the comparison, not re-derivable
- Scratchpad: `wine-db-backup-pre-purge.db` (WAL-checkpointed full DB, original
  defective data), `enrichment-fresh-snapshot.json`, `wine-ids.json`,
  `verify-known-bad.js`, `rerun.sh`

---

## One thing worth carrying forward

The two most damaging bugs of this session — a failed search stored as an empty one,
on both the price and reviews sides — were both predicted in
`docs/sessions/2026-08-04-core-functionality-defect-taxonomy.md` §5 as latent defect
8, and scoped out at the time. Treat that section as a work list, not commentary.
Latent defects 1 (NV wines), 3 (pack format in reviews) and 5 (same producer, two
denominations) are still unaddressed.
