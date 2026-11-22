# Phase 14 — Polishing

> v1 — 2026-11-22. Status: **drafted, for developer review.** Decisions D1–D8 are the developer's, from the 2026-11-22 field-test conversation; §9 lists what is still open, each with a default.
> Read alongside `CLAUDE.md` §15 (amended by this phase), `docs/build-phases.md` (Phases 9.2, 9.4, 12.1, 12.4, 12.5, 13) and `docs/specs/2026-08-19-phase-9.4-scan-first-enrichment.md`, whose primary-tier bound this phase retires.
> **Numbering (resolved 2026-11-22):** this is Phase 14. The former Phases 14 (remaining frontend surfaces), 15 (learning) and 16 (open source) are now 15, 16 and 17 in `docs/build-phases.md`, the same way Phase 13 was inserted on 2026-11-01. Older specs and session notes keep the numbers that were current when they were written.

---

## 1. Goal

Make the scan's critic-score and price lookups behave the way the developer expects: the search starts by itself, covers every retailer the app knows, shows each result the moment it arrives, and always shows that it is still working, including after the wine has been saved and the scan screen is gone.

**Milestone:** scan a bottle and watch scores appear one at a time under a skeleton that says how many shops are left; save the wine mid-search, open it, and see the same search still running. No "Search more retailers" button anywhere. No state that says "Not fetched" while the server is working.

---

## 2. What the code does today (reviewed 2026-11-22)

The developer reported confusing retailer and critic lookups after a photo scan, seen on the two most recent wines added to Discovered. The review of `ios/WineApp/Features/Scan/`, `ios/WineApp/Features/Detail/`, `backend/modules/reviews/` and `backend/routes/wines.ts` confirms it. Findings:

| # | Finding | Where |
|---|---|---|
| F1 | The scan auto-fires reviews at the **primary tier only**: four shops in practice (Woodland, J.J. Buckley, Wine Library, Flatiron; K&L is listed primary but skipped as unrenderable). | `ScanFlowModel.fireEnrichment`, `fetchReviewData` with `tier: 'primary'` |
| F2 | "Search more retailers" appears only when the primary tier found **zero** scores. It sends `tier=full`, which runs five stages **one after another** in one request (240 s timeout): the primary shops that did not return `zero_results` again, the 7 extended shops, up to 3 shops the price search found, one open-web search, then pages of a different bottling. One skeleton, no progress. | `ScanFlowModel.searchMoreRetailers`, `fetchReviewData` |
| F3 | Nothing is stored until the whole run ends (`review_data` is written once). Results found in the first seconds wait for the slowest stage. | `routes/wines.ts` fetch-reviews |
| F4 | **After Save the search becomes invisible.** It keeps running inside the dismissed scan model, but `WineDetailModel` starts with an idle control, so the wine reads "Critic scores haven't been looked up yet" / "Not fetched" with a "Fetch Reviews" button. The list rows have no indicator. | `CriticReviewsState.of`, `WineDetailModel` |
| F5 | A tap on that "Fetch Reviews" button starts a **second** search on the same wine. The server merges only identical requests, and the scan's is keyed `:primary`, the tap's `:full`. Price is protected by `PriceOnce`; reviews are not. | `coalesce` key in `routes/wines.ts` |
| F6 | A dropped connection reads as "Couldn't check reviews". The detail screen asks the server whether it finished anyway (`storedSince`); the scan screen does not. A locked phone during a request that takes about a minute is a likely trigger (not reproduced). | `ScanFlowModel.fireReviews` |
| F7 | The same escalation has two labels: "Search more retailers" on the scan review, "Refresh Reviews" on the detail screen, where "No critic scores found" has no button beside it. "Retailers" is also the wrong word: "Price & retailers" is the section under it. | `EnrichmentBlocks.swift`, `WineDetailView.swift` |
| F8 | The escalation gate is "any score at all". A score for the wrong vintage ends the search, so the net is narrowest where accuracy is weakest. In the 2026-08-15 batch, 4 of the 7 wines the primary tier counted as found had only off-vintage scores (3 of 14 had an exact-vintage score from the primary tier; 5 of 14 from all configured shops). | `foundNoScore()` in `modules/reviews/index.ts`; `validate-reviews-results.json` |

**Why "sometimes I get results":** in the same batch the extended shops rescued 1 of the 7 wines the primary tier missed. The merchant and open-web stages were not part of that script, so their yield is unmeasured (WI-0).

---

## 3. Decisions (developer, 2026-11-22)

| # | Decision | Reasoning |
|---|---|---|
| D1 | **The click-gated escalation is retired.** The scan path searches reviews once, automatically, across every retailer. §15's "prefer escalation over breadth" and the primary-tier bound on the scan auto-fire are amended (see §10). | Serper is a prepaid pack with plenty of credits, so a credit saved on one scan is not money saved (§15 billing note). The Phase 9.4 argument that remains is latency, and §D3 answers it by showing results as they arrive. |
| D2 | **Stage A, all at once:** every renderable configured retailer (primary and extended; `reviewTier: 'none'` shops are still never searched for reviews; K&L is still skipped as unrenderable), primary shops first in the queue. **Stage B, automatic and conditional:** the discovered-merchant probes and the open-web fallback run only if Stage A leaves the wine without a **Tier 1** result (exact wine, same vintage, trusted critic; `shared/utils/review-ladder.ts`). The different-bottling rungs (T3/T4) keep their existing rule: read only when no exact-wine page gave a score. | The unvetted sources cost more GPT-4o per hit and are the likeliest to give a wrong page. The validation script already searches every configured shop in parallel at about 13–16 s a wine (§4). |
| D3 | **Results are saved as they arrive**, one retailer at a time, and clients read them with the free `GET /api/wines/:id`. The search is one **job per wine**. | A search that outlives a screen, a phone lock or a dropped connection must still be visible and finish. |
| D4 | **A search that is running is always shown as running**, everywhere the wine appears: the scan review, the detail screen, and a small indicator on its list row. Skeleton rows stay up while any shop is unfinished, even after the first scores land. | The developer's complaint: "it doesn't look like the search is happening when it is in the background." |
| D5 | **Keep the scan's hold short.** The "pulling details" interstitial stays at most 3 s and still ends early on the first score; its copy becomes "Setting up your review…". It is not lengthened. | The time spent confirming the label fields already overlaps the search, so a longer hold would feel slower. With results arriving as they land, the hold will end on a real score more often. |
| D6 | **The search must survive Fly's idle stop without an always-on machine.** Durability comes from saving progress, a heartbeat, a SIGTERM that waits for jobs, and one automatic resume (§5). Always-on (about $132/month, D5/D11 of Phase 13) and a separate worker are rejected. | Phase 13 kept idle stop deliberately. |
| D7 | **What does not change.** The manual "+ Add Wine" path still fires no reviews by itself; opening a wine fires none; price stays once-per-wine through `PriceOnce`; "Refresh" and "Hard refresh" on the detail screen stay as the deliberate ways to re-run a search, and now both run the full search. The duplicate "Open it" path spends nothing. | §15, unchanged. |
| D8 | **Stale clients keep working.** `?tier=primary` is still accepted (old TestFlight builds, the validation script, tests) and still means the primary tier only. A request with no `tier` means the new full search. | Build 0.1 (2) on the developer's phone sends `tier=primary` today. |

---

## 4. Evidence for the design

**Latency.** `backend/scripts/validate-reviews.ts` fires every `RETAILER_CONFIG` entry for a wine at once (`Promise.all`, no concurrency limit) and processes the 14 wines one after another. On 2026-11-02 it took **181 s on the laptop and 221 s on the 4-CPU Fly machine**: about 13 s and 16 s a wine, with no early stop. That is the cost of Stage A done in parallel, before the proposed concurrency limit is applied. It is an average, not a distribution, which is why WI-0 measures one.

**Yield.** Per the 2026-08-15 batch (14 mostly obscure 2022 wines; the developer's Burgundy, Barolo, Rioja and Rhône bottles will differ, and the batch is dated): primary shops gave a score for 7 of 14 wines, all configured shops for 8 of 14; exact vintage 3 versus 5. Extended shops added one wine's score and two exact-vintage scores, at about 17 extra credits per wine. That is thin, which is why Stage B is gated rather than always on, and why WI-0 re-measures on the developer's own kind of wine before the constants are fixed.

**Fly's idle stop** (read 2026-11-22; Fly docs, "Long-running tasks and machine lifecycle"):
- The proxy checks every few minutes. A single machine with no traffic the proxy can see is stopped. Work running inside the machine is invisible to that decision, and an app cannot tell the proxy it is busy. A job that carries on after its request has finished can be killed part-way.
- On a stop Fly sends `kill_signal` (SIGTERM), waits `kill_timeout` (default 5 s, maximum 300 s), then SIGKILL.
- The repo agrees: Phase 13 WI-5 saw the machine auto-stop after about 8 idle minutes, and the runbook already notes that an SSH session is not HTTP traffic, so idle stop can stop a machine mid-run.
- `backend/server.ts` drains **open requests** on SIGTERM (`server.close`), not background work. A search whose client has already disconnected has no open request, so the server would exit at once.

**Not measured:** how long a job survives after its last request closes. The window is small (a job lasts seconds to a minute, the check runs every few minutes) but real. WI-0 measures it; the design below does not depend on the answer.

---

## 5. Design

### 5.1 One job per wine

- **State.** New nullable column `wines.enrichment_job` (JSON, migration `012_phase14_enrichment_job.sql`). Shape for reviews: `{ state: 'running' | 'done' | 'failed' | 'interrupted', stage: 'shops' | 'merchants' | 'finishing', started_at, updated_at, shops_total, shops_done, scores_found, identity: <identityKey> }`. Price carries the same envelope without counts. It is returned as `enrichment_job` on every wine (list and single).
- **Registry.** An in-process map of running jobs by wine id. `POST /:id/fetch-reviews` joins the running job instead of starting another (one coalesce key per wine for reviews, whatever the tier), so a tap during a scan's search, a resume, and a stale client all attach to the same run.
- **The POST stays a long request** that returns the final wine, so the web app and old builds keep working. While it is open the proxy sees traffic, which is the main protection against an idle stop during the search. New clients also **poll** `GET /api/wines/:id` (free, unmetered) every 2 s for partial results.
- **Cancellation.** Each retailer's completion checks that the wine still exists and that its identity key equals the job's. A discard stops the job; an identity edit (the existing "re-fire if identity changed" path) cancels the job and starts a new one, and late results from the old identity are dropped (they would be stamped with the wrong `enriched_for`).

### 5.2 The pipeline (`modules/reviews/index.ts`)

- **Stage A:** all renderable configured retailers through a pool of `REVIEW_SEARCH_CONCURRENCY` (default 6, replacing the hard-coded 3; fixed after WI-0). Primary shops are queued first so the first scores arrive early. Chromium stays capped by `RENDER_CONCURRENCY` (4), so raising search concurrency does not raise memory.
- **After each shop:** merge its result into `review_data` by retailer slug, merge its entry into `review_probe_log`, recompute the wine-level derived fields (`deriveWineLevelFields`, a pure function), write, and bump `shops_done`, `scores_found` and `updated_at`.
- **Stage B** (only if no Tier 1 after Stage A): the merchant probes (≤ 3) and the open-web fallback run **in parallel with each other**, not one after the other; their dedupe against already-attempted domains needs only the configured list, which is known up front. Then the T3/T4 rule as today.
- **Failure rules carry over.** A request that could not run is never recorded as "found nothing" (the `null` contract): a shop whose request failed is logged `request_failed`, never skipped later, and if every shop failed the job ends `failed` and **existing `review_data` is left alone**. For a refresh of a wine that already has data, results replace the old ones shop by shop and shops the new run did not reach are dropped only when the job ends `done`.

### 5.3 Surviving idle stop (D6)

1. **Progress is saved per shop**, so a killed job loses at most the shops in flight.
2. **SIGTERM waits for jobs.** `server.ts` awaits the registry as well as `server.close`, up to `SHUTDOWN_GRACE_MS`. `fly.toml` `kill_timeout` rises to 120 s and the grace to 110 s (the maximum Fly allows is 300 s). A typical job finishes inside that.
3. **Heartbeat.** The job bumps `updated_at` at least every 10 s. A `running` job whose heartbeat is older than 30 s and that is not in the registry is reported as `interrupted` on read.
4. **One automatic resume.** When a client sees `interrupted` on a wine whose scan started the job, it calls the same POST once. The resume skips every shop whose probe-log entry is newer than `started_at`, so no shop is searched twice. After that one resume, a failure shows the existing "Couldn't check reviews. Retry".
5. **The foreground keeps the machine awake:** the POST is open and the app is polling while the screen is up.

### 5.4 The apps

**iOS**
- `CriticReviewsState` gains a searching state that coexists with scores: `searching(done, total)`. Scores render above a skeleton and a meta line, "Checked 7 of 11 shops · 2 scores so far". When the job is `done` the skeleton goes and the line becomes "Checked 11 shops". Zero scores at the end: "No critic scores found at 11 shops." with no button.
- A shared watcher (one `@Observable`, used by `ScanFlowModel` and `WineDetailModel`) polls while the wine's job is `running` and stops on `done`, `failed`, or after 5 minutes. It replaces the detail screen's idle state, so a saved wine mid-search shows the search. It also fixes F6: a failed request is checked against the stored wine before an error is shown.
- Remove `searchMoreRetailers`, the `searchMore` plumbing in `CriticReviewsBlock` and `DraftReviewView`, and the nothing-found button. Detail's "Fetch Reviews" / "Refresh Reviews" is disabled and reads "Searching…" while a job runs (F5); the search only starts from it when none is running.
- The wine list row shows a small "Searching…" indicator while either job is running.
- "Which bottling is yours?" appears only when the job is `done`, so a partial result never prompts a question. The tier marker shows "Looking for an exact-vintage score…" while the job runs and the best tier is below 1; it does not announce a final tier early.
- Interstitial copy: "Setting up your review…" (D5).
- Price: the same envelope. After Save the price block shows "Checking prices…" while its job runs; `PriceOnce` is unchanged.

**Web** (parity, WI-6): `DiscoveryReview`, `CriticReviewsBlock`, `WineCard` and `LabelScanFlow` read `enrichment_job`, drop the "Search more retailers" label and the `tier: 'primary'` calls, and show the same states.

### 5.5 What a reorder looks like

`criticSummary.ordered` can reorder as better scores arrive (trusted first, same vintage first). Rows fade in and move without jumping; a score already on screen never disappears while the job runs.

---

## 6. Cost arithmetic (required by CLAUDE.md §15 before adding fan-out)

Serper credits per scan, from the Phase 9.2 and 9.4 measurements (14 wines, 2026-08-15) and the 2026-10-31 observation that one Shopping call can report 2 credits:

| | Before | After |
|---|---|---|
| Price | 1 (observed up to 2) | 1 (up to 2) |
| Reviews, automatic | primary tier: 8.9 (range 6–12) | all configured shops: 8.9 + 16.9 = **25.8** |
| Reviews, on a click | +about 21 (extended 16.9, then merchants and open web about 4), taken on roughly half of scans if tapped | none: Stage B runs by itself, only when no Tier 1: **+about 4 on average, up to 12** |
| **Typical per scan** | **about 10** (about 31 when the button was tapped) | **about 27–32**; ceiling about 40 |

Per month at 20–50 scans: about 540–1,600 credits. Over the pack's six months, **3,200–9,600 credits, 6–19% of 50,000**; the ceiling case (40 credits, 50 scans a month) is 12,000, 24%. At the pack price ($50 for 50,000) that is about 3 cents a scan, and §15's billing note applies: about 90% of the pack expires unused, so this does not change what is spent.

The costs that are not covered by that argument:
- **GPT-4o and renders.** In the 2026-08-15 batch the extended shops rendered 14 pages across 14 wines: about **one extra render and one extra GPT-4o extraction per wine**. Stage B adds up to 8 candidate renders, only when no Tier 1 result exists. Memory is unchanged because `RENDER_CONCURRENCY` caps Chromium at 4 (peak about 1.6 GB of 8 GB in WI-5).
- **Rate limits.** The Serper 429s of 2026-08-05 came from an unbounded burst. The pool here is bounded and retries stay in `fetchWithRetry`; WI-0 measures the 429 rate at 3, 6 and 8. The metered cap (100 an hour per device) counts one `fetch-reviews` per scan; the resume adds at most one. Polling uses an unmetered GET.
- **Machine time.** The machine stays up while the job runs. At seconds-to-a-minute per scan this is cents a month at the Phase 13 rate.

---

## 7. Work items

**WI-0 — Spike on staging (gate for the constants; no product code).** On a staging Fly app per the runbook: (a) time Stage A at `REVIEW_SEARCH_CONCURRENCY` 3, 6 and 8 over the 14-wine set and about 15 of the developer's own Burgundy, Barolo, Rioja and Rhône bottles: per-wine duration (median, p90), time to first score, 429 count; (b) measure Stage B's yield on the wines with no Tier 1 after Stage A, which the 2026-08-15 script never covered; (c) start a search, drop the connection, and record whether and when the machine stops (`fly machine list`, logs). Record the results in this spec. Decides: the concurrency default, whether Stage B earns its cost, and whether `kill_timeout` 120 s is enough.

**WI-1 — Job state and API.** Migration 012; `enrichment_job` on `WineEntry` and the wine JSON; the in-process registry; one coalesce key per wine; attach-to-running; cancellation on discard and identity change; `tier=primary` kept for compatibility (D8). Tests: two concurrent POSTs share one run; discard stops it; late old-identity results are dropped.

**WI-2 — Pipeline.** Stage A pool, per-shop persistence with derived-field recompute and probe-log merge, parallel Stage B gated on Tier 1, heartbeat, the failure rules in §5.2. Tests: partial writes are visible mid-run; `request_failed` is never read as a negative; a failed run leaves old data untouched; Stage B is skipped when Tier 1 exists.

**WI-3 — Durability.** SIGTERM awaits the registry; `interrupted` detection; one resume that skips shops probed since `started_at`; `fly.toml` `kill_timeout` and `SHUTDOWN_GRACE_MS`; runbook note and a staging check that kills the connection mid-job. Tests: a job killed after 3 shops resumes the other shops only.

**WI-4 — iOS.** Everything in §5.4: searching state with progress, the shared watcher, list indicator, disabled detail button, bottling banner after `done`, interstitial copy, removal of the escalation button. XCTest for the state machine and the watcher (stub the polling clock, as the scan-hold test does).

**WI-5 — Price status.** The same envelope for price, so the skeleton persists after Save on iOS and web.

**WI-6 — Web parity.** §5.4 web paragraph; Vitest.

**WI-7 — Docs.** `CLAUDE.md` §15 amendment (done with this spec, see §10), route and `enrichment_job` documentation, `build-phases.md`, the runbook, and `docs/specs/2026-11-01-phase-12.5-copy-audit-strings.csv` (remove "Search more retailers", add the new strings).

**WI-8 — Field test.** Scan five real bottles on the phone, once with the screen locked mid-search; confirm each acceptance criterion below on the device.

**WI-1 status (built 2026-11-22, branch `feature/phase-14-wi1-job-state`).** Done as written in §5.1 for reviews, with these differences, each a decision for the developer if they disagree:
- **`enrichment_job` is `{ reviews?, price? }`**, one section per kind. §5.1 describes the reviews shape and says price "carries the same envelope", which implies two jobs in one column. Price is typed and stored-safe but not wired until WI-5.
- **A full request waits behind a stale client's primary run** instead of attaching (§5.1 says one key "whatever the tier"). Attaching would give a `tier=full` caller a primary-only answer, and the old build 0.1 (2) can produce exactly that pair: its scan sends `primary`, its Refresh sends `full`. Once clients stop sending `primary` (WI-4) the branch can never run. A primary request attaching to a running full job is unchanged.
- **Cancellation is checked once, at the end of the run, until WI-2.** `fetchReviewData` is still one call, so there is no per-shop check to make yet; the handle (`JobHandle.cancelled()`) is what WI-2 calls after each shop. A cancelled run still spends its calls, as before.
- **The final write re-reads the wine** and derives the window/rating with its current provenance, not the request-start snapshot. A drinking window set by hand during a search is no longer at risk of being overwritten.
- **Start-up recovery is here, not WI-3.** Marking stored `running` jobs `interrupted` at boot is five lines and keeps §8's "no job stays `running` after its machine has stopped" true from the first deploy. The heartbeat-based detection without a restart stays in WI-3.
- Tests: `backend/tests/unit/enrichment-jobs.test.ts` (18).

Order: WI-0 first (it sets constants), then WI-1 → WI-2 → WI-3 on one branch, then WI-4 and WI-5, then WI-6, WI-7 and WI-8. Each is its own PR; the §14 documentation delta applies to each.

---

## 8. Acceptance criteria

1. A scan shows its first critic score as soon as any shop returns one. Time to first score is no worse than today's primary-only search. Whole-search duration is within the targets WI-0 sets (provisional: median 20 s, p90 45 s).
2. While any shop is unfinished, the critic block shows a skeleton and "Checked n of N shops", including after the first scores appear.
3. Save mid-search, open the wine: the same search is shown running, never "Not fetched". The list row shows an indicator.
4. A tap during a running search starts nothing new (no second search in the server log).
5. Close the connection mid-search on staging: the search either finishes or resumes once and finishes; no job stays `running` after its machine has stopped.
6. Discard mid-search leaves no job and no writes to the deleted wine. Editing the identity mid-search discards the old results.
7. `grep -ri "search more retailers"` finds nothing under `ios/`, `web/src/` or the copy audit.
8. On the 14-wine set and the developer's own set, credits per scan fall inside §6's range, and the exact-vintage score count is no lower than the 2026-08-15 baseline.
9. Old build 0.1 (2) still works against the new server.

---

## 9. Open decisions (each with the default the work will follow)

1. **Stage B gate.** Default: run it when there is no Tier 1 result after Stage A. Alternatives: always run it (more noise, more cost), or never (drop the merchant and open-web stages). WI-0(b) informs this.
2. **Automatic resume.** Default: once, for the scan-started job. The alternative is a visible "Resume" button, which brings back a click in the rare failure case.
3. **Concurrency default.** Default 6, fixed after WI-0(a).
4. **`kill_timeout`.** Default 120 s with a 110 s grace.
5. **Interstitial copy.** Default "Setting up your review…".

---

## 10. Documentation rules recorded with this phase

- **CLAUDE.md §15, amended 2026-11-22 (committed with this spec):** "Prefer escalation over breadth" is replaced by the rule that, with prepaid credits and results shown as they arrive, the scan-path review search is broad up front; escalation survives only as the Tier-1-gated Stage B. "Enrichment stays user-initiated" gains a third scoped exception's boundary: the scan-path auto-fire is no longer bounded to the primary tier.
- **Still binding, unchanged:** state calls-per-wine before and after any new fan-out; no enrichment because a screen loaded; price once per wine; the manual add path fires no reviews; stored text from third-party pages is facts only.
- **New rule for CLAUDE.md §5 (when built):** a running search is a job with persisted state; any new background work must save progress, heartbeat, and be awaited by the SIGTERM handler, because Fly's idle stop cannot see work that has no open request.
