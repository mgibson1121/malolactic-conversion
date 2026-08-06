# Core functionality defect taxonomy — 14-wine test batch, 2026-08-04

Pre-UI review of the price and review/critic-score pipelines against a 14-wine batch
loaded 2026-08-04. Written to answer a specific question: *what are the recurring
shapes behind these defects, and what else will break that this batch didn't happen
to surface?*

**Method.** Every claim below is checked against two things: the code as it stands on
`main`, and the actual `price_data` / `review_data` JSON stored for these 14 wines in
`backend/db/wine.db`. Where I could not confirm a cause from those two sources, it is
labelled **hypothesis** and not counted in the taxonomy.

**Sample caveat.** 14 wines, all vintage 2022, all French, all entered with
`cuvee`/`vineyard`/`quality_classification` null. That is a narrow slice. It is wide
enough to establish the failure *classes* below — several are visible in the code
independent of the data — but not wide enough to estimate rates. Section 5 flags where
I am extrapolating rather than reporting.

---

## 1. Headline: the batch is worse than the report

The defect list describes missing data. The stored data shows a second, more serious
problem the list didn't catch: **a large share of the critic scores that *were*
returned belong to a different wine or a different vintage.**

| Wine (as entered) | Retailer | Page actually extracted from | Scores stored |
|---|---|---|---|
| Grand Village · Vin de France 2022 | Woodland Hills | `whwc.com/lafleur-pomerol-2016/` | **9** — Decanter 100, Wine Advocate 99, Vinous 99, Jeb Dunnuck 99… |
| Grand Village · Vin de France 2022 | JJ Buckley | `2023-chateau-grand-village…` | 5 (right wine, **2023**) |
| Gour de Chaulé · Gigondas 2022 | Benchmark | `…gour-de-chaule-gigondas-cuvee-tradition-**2010**` | 5 |
| Gour de Chaulé · Gigondas 2022 | Woodland Hills | `…gour-de-chaule-gigondas-tradition-**2019**` | 1 |
| Gour de Chaulé · Gigondas 2022 | Sokolin | `2016-famille-perrin-gigondas-domaine-du-clos-des-tourelles` | 0 |
| Gour de Chaulé · Gigondas 2022 | Zachys | `bid.zachys.com/auctions/bidding-history/…` | 0 |
| Domaine Charles Audoin · Marsannay 2022 | Benchmark | `…charles-audoin-marsannay-clos-du-roy-**2020**` | 3 |
| Domaine Vincent Dureuil-Janthial · Rully 2022 | Benchmark | `…dureuil-janthial-rully-en-rosey-**2003**` | 0 |
| Domaine des Ardoisières · Savoie 2022 | Benchmark / Wine Library / Flatiron | Altesse Quartz **2021** / Argile Blanc **2012** / Argile Rouge **2024** | 0 |
| Montus · Madiran 2022 | Benchmark | `chateau-montus…madiran-**2018**-6-pack` | 0 |
| Montus · Madiran 2022 | Wine Library | `2024-brumont-cotes-du-gascogne-rouge` | 0 |
| Clos Manou · Médoc 2022 | JJ Buckley | `images.jjbuckley.com/…/2011_BORDEAUX_REPORT.**pdf**` | 0 |

The Grand Village row is the one to look at first. Château Lafleur and Château Grand
Village are both Guinaudeau family properties, so the Lafleur page mentions "Grand
Village" — enough for the relevance check to pass. The app then stored nine
99–100-point scores for a ~$30 Bordeaux Supérieur. That is the failure mode that
matters most before a UI exists, because a UI will render it confidently.

Across the whole batch, three extractions are unambiguously the right wine *and* the
right vintage: Flatiron's Gour de Chaulé Cuvée Tradition 2022, and Mangot at both
Woodland Hills and JJ Buckley. One more is close (Wine Library's Gour de Chaulé 2022 —
right producer and vintage, different cuvée). Everything else is wrong-vintage,
wrong-bottling, wrong-wine, or empty.

---

## 2. Root causes

Ordered by how many reported defects each one explains.

### RC-1 — Vintage is load-bearing in the price query and absent from review matching

Two independent halves, both confirmed.

**(a) Every dead retailer link you reported is mechanically caused by a
vintage mismatch.** `price/index.ts:buildQuery` calls
`buildDistinguishingQuery(wine, { includeVintage: true })`, and that *same string* is
then handed to `buildRetailerSearchUrl`. So when Serper's Shopping snapshot matches a
retailer on a *different* vintage, the app stores that retailer — and builds a link
asking the retailer for the vintage it does not have.

Check it against every dead link in your list:

| Wine | Retailer | Listing vintage Serper matched | Link built asks for |
|---|---|---|---|
| Grand Village | Zachys | 2023 | 2022 |
| Bessin-Tremblay | Benchmark | 2020 | 2022 |
| Bessin-Tremblay | Flatiron | 2023 | 2022 |
| Charles Audoin | Benchmark | 2020 | 2022 |
| Gour de Chaulé | Benchmark | 2021 | 2022 |
| Dureuil-Janthial | Woodland Hills / Zachys | *unknown* (`matched_vintage: null`) | 2022 |

Six for six. This is not a per-retailer URL-pattern problem — `retailer-links/index.ts`
already made exactly this fix in Phase 7.2 ("no vintage token — an added vintage risks
a false 'no results' even when the retailer carries the wine"), with a live-confirmed
Zachys example in the comment. **That decision was never mirrored into `price/`**, which
is the module that actually generates the links in `price_data.retailers[].url`.

The Dureuil-Janthial rows are worth separating out: `matched_vintage: null` means the
Shopping listing title had no year at all, and `vintage_mismatch` is computed as
`matched_vintage !== null && …` — so an unknown vintage is silently treated as a match.
Fail-open.

**(b) `modules/reviews/` has no vintage concept at any stage.** `isRelevantMatch` never
looks at vintage. `buildQueryVariants`' third variant *deliberately drops* vintage, and
nothing re-checks it afterwards. And the part that stings:

```
// gpt-extract.ts returns:  { price, url, vintage, critic_scores }
// reviews/index.ts uses:                        ^^^^^^^^^^^^^^ only
```

GPT-4o is already asked for, and already returns, the vintage stated on the page —
`GptPageExtraction.vintage`, documented in `reviews/types.ts` as "used by the
confirm-retailer-link flow". `renderAndExtract` passes it through, and
`fetchReviewData` reads `extraction.critic_scores` and drops the rest on the floor.
`RetailerReview` has nowhere to put it. The single field that would have caught every
wrong-vintage row in section 1 is being computed and discarded.

Explains: Montus, Jean-Marc Vincent, Gour de Chaulé/Benchmark, Charles Audoin,
Bessin-Tremblay, Dureuil-Janthial, Grand Village, and all six dead links.

### RC-2 — `isRelevantMatch` is a disjunction, so it accepts a different wine

```ts
const producerHit = producerWords.some(w => normText.includes(w))
const denomHit    = denomWords.some(w => normText.includes(w))
return producerHit && denomHit && distinguishingHit
```

*Any one* significant producer word plus *any one* denomination word, anywhere in title
+ snippet, is sufficient. For "Grand Village" / "Vin de France" that reduces to
(`grand` OR `village`) AND (`vin` OR `france`) — which the Château Lafleur page
satisfies trivially. "Montus" / "Madiran" matched a Brumont Côtes de Gascogne page.
"Gour de Chaulé" / "Gigondas" matched a Famille Perrin Gigondas.

The `distinguishingHit` clause — the 2026-07-30 fix intended to prevent exactly this —
is inert for all 14 wines, because `cuvee` and `vineyard` are null on every one of
them. The guard only engages for wines that were already specified precisely enough not
to need it.

There is also no negative signal anywhere: nothing rejects a candidate whose title
contains a *different* producer's name.

### RC-3 — The reviews query quotes the producer verbatim, honorific included

`find-product-page.ts:buildQuery` emits `site:<domain> "<producer>" "<denomination>" <vintage>`.
For Jean-Marc Vincent that is `"Domaine Jean-Marc Vincent"`. Morrell's page title is
`Jean-Marc Vincent Santenay Rouge 1er Cru Gravieres 2022` — no "Domaine". The quoted
phrase fails, and `buildQueryVariants` only ever relaxes cuvee/vineyard and vintage.
**Producer and denomination are never relaxed.**

The proof is in the same wine's row: the *price* module found Morrell for Jean-Marc
Vincent at $135, correct 2022 vintage, because its query is unquoted and
relevance-ranked. Same wine, same retailer, same run — one module found it, the other
couldn't.

7 of the 14 wines begin with "Domaine" in the producer field. `STOPWORDS`
already lists `domaine`, `chateau`, `château`, `clos`, `maison` — the codebase knows
these are noise. It applies that knowledge on the matching side and not on the
query-building side, in the same file, forty lines apart.

Same asymmetry exists for diacritics: `find-product-page.ts` got `foldDiacritics` on
2026-08-02, but `buildDistinguishingQuery` (which builds every retailer search URL and
the Shopping query) still emits raw accents — `Gour%20de%20Chaul%C3%A9`,
`Mangot%20Saint-%C3%89milion`, `C%C3%B4tes%20du%20Rh%C3%B4ne`. Mangot returned zero
retailers despite being widely stocked; the accented Shopping query is the leading
**hypothesis** there, unconfirmed without a live A/B.

### RC-4 — Price and reviews discover retailers independently and never inform each other

Two directions, both in your list:

- **Mangot**: `modules/reviews/` found a live Woodland Hills product page
  (`whwc.com/mangot-st-emilion-2022/`, correct vintage) with 7 critic scores. This is
  direct proof Woodland Hills stocks the wine. `modules/price/` returned **zero
  retailers** for the same wine in the same run. That's your "tons of retailers have it
  but none were found."
- **Montus**: `modules/price/` discovered central-wine-merchants, Wally's, Varmax.
  `modules/reviews/` iterates `RETAILER_CONFIG` and nothing else, so it never looked at
  any of them. That's your "the nearest retailer has a Wine Enthusiast review, yet no
  reviews returned."

A confirmed product page is the strongest possible evidence a retailer carries a wine,
and it's thrown away by the module that needs it. Symmetrically, a Shopping hit is
strong evidence of where to look for a review.

### RC-5 — Pass 1 short-circuits Pass 2 (your Grand Village hypothesis — confirmed)

`serper-query.ts`, last lines:

```ts
if (preferred.length > 0) return preferred
// Pass 2 — fallback: any relevant retailer Serper found
```

Yes. One preferred-retailer match suppresses every other retailer entirely. Grand
Village matched Zachys — on a **2023** listing, which then failed the vintage filter and
left `price_min/avg/max` all null. So the run returned one purchase link, that link was
dead, and it also blocked the open fallback that would have found the others. Three
symptoms, one line.

### RC-6 — Verification fails open in three places

1. `verifyStillListed`: `if (!html) return retailer` — a Puppeteer timeout is treated as
   confirmation. The comment argues an infra hiccup shouldn't punish the retailer;
   the effect is that an unverifiable listing is indistinguishable from a verified one.
2. `pageShowsNoResults` is an eight-pattern allowlist of English phrasings. Any retailer
   whose empty-state copy isn't on that list passes. Benchmark, Zachys, Woodland Hills
   and Flatiron all passed it while serving dead links.
3. `getRetailerLinks` (the "Find Reviews" / View links) performs **no verification at
   all** — it is pure and synchronous by design, generating 12 unchecked search URLs per
   wine on every request.

### RC-7 — K&L is added to every wine unconditionally

`buildKlLinkOnlyResult` is called with no gate whatsoever:

```ts
const klLink = buildKlLinkOnlyResult(wine)
const allRetailers = klLink ? [...verified, klLink] : verified
```

Deleuze-Rochetin's entire `price_data.retailers` array is one K&L entry. So is
Mangot's. That's your "K&L returning as a match even though the wine wasn't carried" —
it is not a matching bug, K&L is never matched at all.

Second-order: because K&L is always appended, `allRetailers.length === 0` is
unreachable whenever the wine has a producer or denomination, so `emptyPriceData()`
never fires. The distinction the comment above it exists to preserve — "never
attempted" vs "attempted and found nothing" — has been destroyed by a change made
elsewhere.

### RC-8 — Un-vetted fallback sources, and one the project already rejected

The Phase 7.3 open-web fallback returned `kakaakowine.com`,
`thewinecellarinsider.com`, and — for Montus — **`wine-searcher.com`**, the source this
project migrated away from in Phase 6 and which is not on
`shared/config/denylisted-domains.ts`. Zero scores from any of them.

`sommpicks.com` (your Bessin-Tremblay link) and `farrvintners.com` (your Clos Manou
link) are not in `RETAILER_CONFIG` and therefore were never searched. This is the known
Pattern 2 from the 2026-08-02 analysis, still unmitigated: a config gap renders
identically to a real miss.

For Clos Manou specifically, the fallback *did* fire and *did* return a Bordeaux page —
`thewinecellarinsider.com`, which extracted 0 scores — rather than Farr Vintners. The
fallback stops at the first relevance-passing result, has no retry, and its relevance
check requires a denomination word ("medoc") that retailer titles routinely omit.
**Hypothesis**, testable in one Serper call.

### RC-9 — The fallback re-tries a domain already known to fail

Bessin-Tremblay and Dureuil-Janthial both produced `fallback-shop-klwines-com`,
pointing at the **identical URL** that had just returned zero scores as a configured
retailer. K&L is documented as permanently bot-blocked at product-page render. The
fallback excludes denylisted domains but not domains already attempted in this run, and
not domains known to be unrenderable. Cost: a wasted Serper + Puppeteer + GPT-4o cycle
with a guaranteed-empty result.

### RC-10 — Phase 8 derivation gets worse as coverage improves

`pickSingleAgreeing`: zero values → leave field alone; exactly one distinct value →
use it; two or more distinct values → **null**.

Mangot has 12 critic scores and came out with `vintage_rating = 'very_good'`, derived
from a single critic — and from pages that include a wrong-vintage source. Meanwhile a
wine with good coverage where two critics say anything different gets null.

The unanimity rule was a reasonable no-blending guard when coverage was thin. With 12
retailers and an open-web fallback it inverts: **more data makes the field less likely
to populate.** Worth deciding deliberately before the UI depends on it.

### RC-11 — Upstream identity quality, with no downstream tolerance

Not in scope to fix, but it is the input to everything above:

- `producer` = "Montus" (Château Montus), "Mangot" (Château Mangot), "Bretadeau"
- `denomination` = "Vin de France" for Grand Village, which is Bordeaux Supérieur —
  and that wrong string then becomes a *required quoted phrase* in the reviews query
- `cuvee` / `vineyard` / `quality_classification` null on all 14, while the products
  retailers actually stock are "Santenay 1er Cru Les Gravières", "Chablis 1er Cru La
  Forêt", "Ardoisières Savoie Satellite"

Every module treats these fields as exact. The system is built to reject imprecision it
generates itself.

---

## 3. The meta-pattern

The 2026-08-02 analysis diagnosed the recurrence as *duplication* — the same logic
hand-copied into three modules, so every fix had to be applied three times. That
diagnosis was right, the dedup into `shared/` was the right fix, and it has held: there
is now one `normalize`, one `isRelevantMatch`, one `buildRetailerSearchUrl`.

**The defects recurred anyway**, which means duplication was the mechanism, not the
cause. The cause is one level down: **no module has a stated definition of "this result
is about this wine," and the three implicit definitions still disagree — they just
disagree inside one file now instead of across three.**

Look at `shared/utils/wine-match.ts` as it stands:

- `normalize()` strips diacritics. `buildDistinguishingQuery()`, forty lines below it,
  does not.
- `STOPWORDS` knows `domaine`/`château` are noise. Neither query builder strips them.
- `isRelevantMatch()` ignores vintage entirely. `buildDistinguishingQuery()` takes an
  `includeVintage` option, and its three callers pass three different answers
  (price: yes; retailer-links: no; K&L link-only: no).

Deduplication collapsed three inconsistent files into one inconsistent file. The
query side and the match side of the *same shared module* encode different notions of
identity, and neither encodes vintage or bottling at all.

Concretely, the four dimensions of wine identity — **producer, denomination, bottling
(cuvee/vineyard/classification), vintage** — are each handled by a different mechanism
in a different place, and no code path evaluates all four:

| | producer | denomination | bottling | vintage |
|---|---|---|---|---|
| price query | joined, accented | joined, accented | joined | **included** → dead links |
| price match | any-one-word | any-one-word | any-one-word | title regex, fail-open |
| reviews query | **quoted exact** | **quoted exact** | quoted, relaxable | relaxable |
| reviews match | any-one-word | any-one-word | any-one-word | **absent** |
| retailer link | joined, accented | joined, accented | joined | **excluded** |

Until that table has one row, this class of defect will keep regenerating under new
names. **The structural fix is a single graded matcher** — something like
`scoreMatch(candidate, wine) → { producer, denomination, bottling, vintage }` returning
a per-dimension verdict (`match` / `mismatch` / `unknown`) rather than a boolean — with
each caller choosing its own threshold and *recording the verdict on the stored
result*. A boolean `isRelevantMatch` cannot express "right producer, right appellation,
wrong vintage," which is the single most common real outcome in this batch.

---

## 4. Reported defects → root cause

| Reported | Cause | Confidence |
|---|---|---|
| Deleuze-Rochetin: K&L matched though not carried | RC-7 | Confirmed |
| Ardoisières: retailer links return nothing / not product pages | RC-1a, RC-8, design (search URLs by design) | Confirmed |
| Grand Village: many ratings, one purchase link | RC-5 | Confirmed |
| Grand Village: Zachys dead link | RC-1a (Serper matched 2023) | Confirmed |
| Grand Village: ratings are Château Lafleur's | RC-2 | Confirmed — **not reported, most severe** |
| Clos Manou: no reviews though Farr Vintners has them | RC-8 (not configured; fallback stopped early) | Hypothesis |
| Mangot: reviews found, no retailers | RC-4, RC-3/accents | Confirmed / hypothesis |
| Montus: nearest retailer has a review, none returned | RC-4 | Confirmed |
| Gour de Chaulé: Benchmark no match despite crawl result | RC-1a (matched 2021), RC-1b (extracted 2010) | Confirmed |
| Bretadeau: no retailers though Woodland Hills stocks it | RC-4 + Shopping-index gap | Partly confirmed |
| Charles Audoin: dead Benchmark link | RC-1a (matched 2020) | Confirmed |
| Jean-Marc Vincent: Morrell has reviews, none found | RC-3 ("Domaine" quoted) | Confirmed |
| Dureuil-Janthial: Woodland Hills + Zachys dead links | RC-1a (`matched_vintage: null`, fail-open) | Confirmed |
| Bessin-Tremblay: Flatiron + Benchmark dead links | RC-1a (2023 / 2020) | Confirmed |
| Bessin-Tremblay: Somm Picks stocks it, no link | RC-8 (`sommpicks.com` not configured) | Confirmed |

---

## 5. Latent defects — predicted, not observed in this batch

Derived from the root causes above. None of these fired in these 14 wines, all are
reachable from code as written. Ordered by expected severity.

1. **Non-vintage wines silently accept any bottling.** `vintage_mismatch` requires
   `matched_vintage !== null && wine.vintage !== null`. For NV Champagne both sides are
   null, so *every* listing passes, and `buildQueryVariants` collapses to one variant.
   There is no NV wine in the DB yet, which is precisely why this hasn't surfaced —
   the Champagne entries present (Charles Heidsieck 2013, Drappier Grande Sendrée 2012)
   are both vintage-dated. The first NV bottle you add will hit this.
2. **Blog and offer pages accepted as product pages.** This batch already stored
   `crushwineco.com/blogs/offers/…` and `nyc.flatiron-wines.com/blogs/…` as product
   URLs. Both returned 0 scores — by luck. A retailer newsletter covering eight wines
   with eight scores will, under RC-2's any-one-word matcher, attribute the wrong one.
   Same for the auction page (`bid.zachys.com`) and the 2011 Bordeaux Report **PDF**
   already accepted from JJ Buckley. There is no URL-shape guard anywhere.
3. **Pack format is handled in price and not in reviews.** `pack-format.ts` exists only
   under `modules/price/`. `modules/reviews/` already rendered a Benchmark **6-pack**
   page for Montus. A magnum or 6-pack page's scores will be stored with no format flag.
4. **`distance_miles: 0` on every Pass 2 fallback.** Hardcoded in `buildFallbackResult`.
   Clos Manou's `nearest_retailer` is `winetransit-com` at "0 miles"; Montus's is
   `central-wine-merchants`. As fallback usage rises (which fixing RC-5 will do), a
   Chicago shop will routinely beat a Manhattan one for "nearest."
5. **Same producer, two denominations, cross-contamination.** A producer making both a
   village and a 1er cru will match either page under RC-2 with `vineyard` null. Common
   in Burgundy, which is most of your buying.
6. **`critic-keywords.ts` is materially stale.** This batch flagged
   `known_publication: false` for Falstaff, Wine & Spirits Magazine, La Revue du Vin de
   France, The Wine Independent, Winedoctor, Jane Anson, Inside Bordeaux, and
   TheWineCellarInsider — eight real publications. Low-stakes by design, but it is the
   confidence signal a UI will lean on.
7. **`region` and `appellation` columns exist and are used by no query.** Free
   disambiguation signal, currently dead weight.
8. **No concurrency cap.** `fetchReviewData` fires `Promise.all` over 12 retailers, each
   up to 3 Serper calls plus a Puppeteer render plus a GPT-4o call. Fine for one wine;
   a 14-wine batch is already several hundred outbound requests with no limiter, and
   nothing here degrades gracefully under a rate limit — a 429 becomes `request_failed`,
   which is indistinguishable from "found nothing."

---

## 6. Recommended fixes, in leverage order

**P0 — stop showing wrong data.** These three explain every confirmed defect.

1. **Stop discarding the extracted page vintage.** Add `page_vintage` and
   `vintage_mismatch` to `RetailerReview`; populate from `GptPageExtraction.vintage`,
   which is already returned. Exclude mismatched scores from `deriveWineLevelFields`
   and badge them in the UI rather than dropping them silently. *One field, already
   computed. Fixes the entire wrong-vintage class.*
2. **Replace `isRelevantMatch` with a graded `scoreMatch`** returning a per-dimension
   verdict (producer / denomination / bottling / vintage → match | mismatch | unknown).
   Require *all* significant producer words rather than any, add a negative check for a
   competing producer name, and store the verdict on the result. This is the single
   structural change that closes section 3's table.
3. **Drop the vintage from the constructed retailer search URL** — mirror
   `retailer-links/`'s Phase 7.2 decision into `price/`, or build the URL from the
   *matched listing's* vintage rather than the requested one. *Kills all six dead links.*

**P1 — recover the coverage that's being lost.**

4. Strip honorifics (`domaine`, `château`, `clos`, `maison`) and fold diacritics when
   building the quoted reviews query; add producer-relaxation as a fourth variant. Move
   the existing `foldDiacritics` into `shared/` and apply it to
   `buildDistinguishingQuery` too.
5. Remove the Pass 1 short-circuit in `serper-query.ts` — merge preferred and fallback
   results with a total cap, rather than returning early.
6. Cross-feed the two modules: a product page confirmed by `reviews/` is evidence for
   `price/`; a retailer discovered by `price/` is a search target for `reviews/`. Both
   belong in the router per §5, not as a cross-import.

**P2 — make the empty state honest.**

7. Gate the K&L entry, or mark it distinctly enough that it can't read as a match.
   Restore reachability of `emptyPriceData()`.
8. Fail closed: a Puppeteer render failure should produce an "unverified" state, not a
   pass. Add a positive signal (does the page contain the producer name?) rather than
   relying only on an English "no results" allowlist.
9. Add a URL-shape guard before spending a render + GPT call: reject `.pdf`, `/blogs/`,
   `/search`, `bid.`/`auction`, `/cart`. Exclude already-attempted and known-unrenderable
   domains from the fallback. Add `wine-searcher.com` to the denylist.

**P3 — measure instead of spot-checking.**

10. Freeze these 14 wines plus expected outcomes into a ground-truth fixture suite, and
    extend `validate-reviews.ts` to report per-stage outcomes per retailer. Re-run it
    after each fix above; that turns the next report from a debugging session into a
    diff.
11. Revisit `pickSingleAgreeing`'s unanimity rule (RC-10) before the UI depends on
    `drinking_window` / `vintage_rating`.

---

## 7. What I'd want before acting on the extrapolations

Section 5 is inference from code, not from observation. Cheapest ways to convert it:

- Re-run these 14 wines with per-stage logging after P0 — confirms the fixes and
  populates the fixture suite in the same pass.
- Add 5–10 deliberately awkward wines: an NV Champagne, a magnum, a producer with
  both a village and a 1er cru bottling, a New World wine, and one wine entered *with*
  cuvee/vineyard populated. Those five cover latent defects 1, 3 and 5 directly.
- One Serper call each to test the two open hypotheses: the accented Shopping query
  (Mangot) and the fallback's denomination requirement (Clos Manou / Farr Vintners).
