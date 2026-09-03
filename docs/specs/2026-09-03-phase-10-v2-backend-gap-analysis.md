# Phase 10 v2 — UI / Backend Capability Gap Analysis

**Status:** Companion to `claude/phase-10-v2-web-ui-design-requirements.md` and the published
canvas (https://claude.ai/code/artifact/88775682-0088-476b-9b4b-75b7cff61fa5 — blue/yellow-on-
near-black palette, per the developer's 2026-09-02/03 feedback). Written 2026-09-03 by reading
the real backend routes, storage layer, shared types, and frontend against the finalized v2
design — not against the requirements doc's aspirational framing. Where the design calls for
something the backend or frontend already does, that's recorded as confirmed, not skipped, so
the next build pass doesn't re-solve something that already works.

## How to read this

Each gap is graded:

- **Missing** — no backing code exists anywhere (route, storage, or data field).
- **Partial** — the data or logic exists but isn't wired to an HTTP route, or exists in a
  form narrower than the design assumes.
- **Wired, needs UI only** — fully supported today; the gap is only that the current React
  app or the design canvas doesn't yet expose it. No backend work needed.

## 1. Confirmed already supported (no backend work needed)

- **Draft/promote model.** `promoted_at`, `POST /:id/promote`, and `DELETE /:id` (blocked
  with 409 while tasting notes exist) already match the Discovery tab's keep/discard flow,
  including the "cannot delete a wine with tasting notes" case the Discard action needs to
  handle.
- **Tiered review search.** `fetch-reviews?tier=primary|full` confirms the requirements
  doc's 2026-09-02 resolution that reviews are genuinely tiered (primary → extended →
  open-web), not one pass. "Search more retailers" in the design maps directly to
  `tier=full`, and `EXTENDED_RETAILER_COUNT` is already computed client-side in
  `DiscoveryReview.tsx`.
- **"All reviews shown if any found."** Confirmed correct. `CriticScoreBadges` renders
  every entry in a wine's deduped `review_data[].critic_scores` — nothing truncates or
  blends scores together.
- **Per-critic drinking-window disagreement display.** `AttributedDrinkingWindows.tsx`
  already implements exactly the "show each critic's window individually when they
  disagree" behavior the Wine Detail modal spec calls for.
- **Preferred-retailer distinction.** `is_preferred_retailer`, `RETAILER_CONFIG`, and
  `summarizePreferredRetailers()` already exist and back the Discovered tab's "one
  preferred-retailer link" requirement directly.
- **Quick tag add/remove on cards.** `WineCard.toggleTag()` + `onTagUpdate` are already
  wired end-to-end. The Discovered tab's "quick add/remove" ask (2026-09-01 comment #2) is
  already possible today via `PATCH /:id` — it just isn't exposed as a one-tap chip row in
  the current React UI yet.
- **Manual vs. derived field provenance.** `drinking_window_source` / `vintage_rating_source`
  are tracked and already respected by `deriveWineLevelFields` — a manual edit is never
  silently overwritten by a later automated extraction run.
- **Rating filter.** `WineFilter.my_rating` already exists and is already read by
  `GET /wines`. The Tasting Notes tab's "filter by rating" ask (thread `105496e3`) needs a
  UI control, not new backend work.
- **WSET aroma capture.** `TastingNote.nose_primary/secondary/tertiary_aromas` are plain
  `string[]`, not a closed enum — any descriptor list the UI multi-selects from (per
  `wine-app-product-context.md` §7) writes through with zero backend change.

## 2. Real gaps

### 2.1 Discovery tab cannot list its own contents — a route bug, not a missing feature
**Grade: Missing at the route level; trivial fix.**

`WineFilter.include_drafts` exists in `shared/types.ts` and is fully implemented in
`sqlite-adapter.ts` — even covered by a passing test ("includes drafts when include_drafts
is set"). But `GET /api/wines` in `backend/routes/wines.ts` never reads
`req.query.include_drafts` into the filter it builds — only `tag_discovered/wishlist/
cellar/consumed`, `has_tasting_note`, `my_rating`, and `region` are wired to query params.
Result: there is currently no way to call the API and get back drafts (`promoted_at IS
NULL`) — exactly what the Discovery tab needs to render. The storage layer already does the
work; this is a missing few-line addition to the route handler, not new plumbing.

### 2.2 No wine color (red/white/rosé) field — blocks the Cellar appellation chart's red/white split
**Grade: Missing.**

The Cellar tab (requirements doc §3.1, thread `aa21fb57`) calls for sub-dividing each
appellation's bar into red and white. `WineEntry` has no `color`/`wine_type` field anywhere
— not in `shared/types.ts`, not in `schema.sql`. The nearest data is `grape_varieties:
string[] | null`, which is free-text/LLM-extracted and unreliable to derive color from
client-side (a grape→color lookup table doesn't cover blends, rosé, or ambiguous entries).
Recommend either (a) add a `wine_color: 'red' | 'white' | 'rosé' | null` column, populated
by the label-scan/enrichment pipeline the same way `quality_classification` already is, with
manual override via `PATCH`; or (b) if that's too much for this pass, ship the
single-segment-per-appellation bar the app already has real data for, and drop the
red/white split until the field exists.

### 2.3 No cellar capacity field — the "Capacity used: %" stat has nothing to compute from
**Grade: Missing.**

The published canvas's Cellar tab (`Main.dc.html`) carries a "Capacity used: 15%" stat tile
from the original mockup. There is no capacity/total-slots field anywhere in the schema —
only `cellar_quantity` per wine, which sums to a bottle count, not a percentage of anything.
Recommend either adding a simple user-set `cellar_capacity` config value (one number, not
per-wine) or dropping the stat from the build until that setting exists.

### 2.4 No cross-tab wine search endpoint
**Grade: Missing.**

Thread `76dbe89f` asks for a search box in every tab's chrome, scoped to that tab's own
filtered set. `GET /api/wines` supports only exact-match tag/rating/region filters — no text
query parameter, no `LIKE`/FTS clause anywhere in `sqlite-adapter.ts` or `schema.sql`.
Today's shipped frontend has no search at all, so this is new on both ends. Recommend a `q`
query param on `GET /wines` doing a simple `producer`/`denomination`/`vineyard`/`cuvee`
substring match — plain SQLite `LIKE '%...%'` is enough at a personal-collection data
volume; an FTS5 virtual table would be over-engineering for this.

### 2.5 No "preferred review source" prioritization — only publication-deduplication exists
**Grade: Partial — very likely moot, flagged so it isn't silently reintroduced.**

The developer's 2026-09-01 comment #3 ("we should use one from a preferred review source,
which we can define separately") describes a ranked/prioritized single-score display. What
exists today (`getDedupedCriticScores` in `web/src/utils/criticScores.ts`) is
publication-deduplication only — first occurrence per publication wins, with no notion of a
"preferred" publication and no config for it (there's a `RETAILER_CONFIG` for *retailers*,
nothing equivalent for *critics*). Because §2a of the requirements doc later resolved review
display to "show every score, attributed to its publication" across every tab — a
deliberate, developer-confirmed decision, and the opposite of prioritization — this gap is
most likely already answered by that later call. Recorded here so it reads as resolved, not
overlooked.

### 2.6 Environment/SensorPush widget — no integration exists
**Grade: Missing, already known — recorded here only for completeness.**

Carried forward from the 2026-09-02 session (thread `93fd4fd3`, "no technical path forward
for this"). Already removed from the Cellar tab mockup in that session; nothing new here.

### 2.7 Retailer-link resolution is click-triggered, not eager — state frames need to account for it
**Grade: Wired, needs UI care, not a backend gap.**

Not missing, but a behavior the state-frame specs must respect: a retailer link can be a
real product URL or an unresolved search-results link (`is_search_results_page: true`)
until the user clicks "View" (`POST /:id/resolve-retailer-url`, spent once per shop per
wine). A Wishlist/Discovered row's retailer-link element needs three states, not one:
resolved product link, unresolved search link (should read as a search, not a direct
product page), and "resolving…" while that click-triggered fetch is in flight.

### 2.8 Advice-capture ("log a tip") already has a full data model and route — the requirements doc's stated reason for excluding it is wrong, though the exclusion itself still holds
**Grade: No gap — documentation correction only.**

`backend/routes/advice.ts`, `AdviceEntry`, and `CreateAdviceInput` all exist and are fully
wired (`POST/GET /api/advice`, `GET /api/advice/:id`). The requirements doc (§4) scopes
advice-capture UI out of this pass on the premise that "no backing code exists yet (Phase
12)" — that premise is incorrect, the backend is there. The scoping decision itself (don't
design this UI now) can still stand; only the stated reason needs correcting next time that
doc is touched.

## 3. Real error/edge-case copy to build the state frames from

Pulled directly from the route handlers, so the error-state frames say what the app actually
says rather than a generic "Something went wrong":

- **List fetch failure, any tab:** `"Could not load wines — is the backend running on port
  3000?"` (`App.tsx`'s unconditional catch-all — today the same message covers every
  failure mode; worth differentiating in the redesign, e.g. a stale-wine 404 vs. the backend
  being down).
- **`fetch-price` unavailable (503):** `"Price data unavailable — OPENAI_API_KEY or
  SERPER_API_KEY not configured, or no retailer results found"`.
- **`fetch-reviews` unavailable (503):** `"Review sourcing unavailable — SERPER_API_KEY/
  OPENAI_API_KEY not configured, or the search requests failed. Existing review_data left
  untouched."` — worth a frame showing existing review data staying visible next to the
  error, since the route deliberately never clears it on failure.
- **Label scan, unsupported format (400):** `"IMAGE_FORMAT_UNSUPPORTED"` — message: `"This
  image format could not be processed. Try saving the photo as a JPEG and uploading again."`
- **Label scan, not configured (503):** `"Label scanning is unavailable — OPENAI_API_KEY is
  not configured."`
- **Delete blocked by tasting note (409):** `"Cannot delete a wine that has tasting notes."`
  — Discovery's Discard action, and any delete affordance elsewhere, must treat this as a
  real, expected response, not an unexpected error.
- **Promote without a tag (400):** `"At least one of tag_discovered, tag_wishlist,
  tag_cellar is required to promote a wine."` — the server-side backstop for the design's
  existing "Save disabled until a tag is chosen" rule.
- **Wine not found (404):** `"Wine not found"` — relevant to any stale reference or deep
  link.

## 4. Recommended order of work

1. Fix §2.1 (`include_drafts` route wiring) first — trivial, and it currently blocks the
   Discovery tab from working against real data at all.
2. Decide §2.2 (wine color) and §2.3 (capacity) — both need a product decision (add the
   field vs. drop the UI element) before either the backend or the canvas moves further.
3. Ship §2.4 (search) as a simple `LIKE`-based `q` param — small, and every tab's design
   depends on it per thread `76dbe89f`.
4. Treat §2.5 as resolved/no-op per §2a's existing decision; revisit only if the developer
   says otherwise.
5. Build the error/edge-case state frames from the real copy in §3, not placeholder text.
