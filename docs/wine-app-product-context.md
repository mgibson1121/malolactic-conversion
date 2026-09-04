# Wine App — Product Context
> Status: In progress | Last updated: 2026-08-19 (Phase 9.4 — scan-first enrichment: reviews auto-fetched at `primary` tier on label parse, wines held as drafts until an affirmative Save to Collection, `tag_discovered` no longer automatic, Serper billing state corrected — see `build-phases.md`)
> This file is the single source of truth for product context. It is used by both the product owner and AI agents (Claude Code) to make consistent decisions. When in doubt, consult this file before building.

---

## 1. Product Vision

A personal wine companion that removes the friction between experiencing a wine and understanding it. The app captures, organises, and surfaces knowledge at every stage of the wine journey — from a bottle glimpsed in a restaurant to a decision about what to drink tonight — so the user builds genuine fluency rather than just a spreadsheet.

**Primary user:** An engaged amateur collector in an urban apartment (NYC). Developing palate. Limited cellar space. Drinks seriously, buys intentionally, wants to feel like an insider rather than a student.

**Platform:** iOS and web application. iOS is primary; web parity follows.

**v1 constraint:** Single user. The developer is the only user. All API keys and credentials are supplied by the developer.

---

## 2. Hotspots (Site Map)

Six functional areas, grouped into two contexts:

### In-the-wild (triggered by a specific bottle or conversation)
| Hotspot | One-line purpose |
|---|---|
| **Capture** | Log wines and advice in the moment without disrupting the experience |
| **Research** | Evaluate a bottle on the spot — in a shop, at a table, or while browsing online |
| **Evaluate** | Record a structured tasting note when consuming a wine |

### At-home (reflective, strategic)
| Hotspot | One-line purpose |
|---|---|
| **Cellar** | Know the state of your collection at all times |
| **Wishlist + Purchasing** | Decide what to buy, where to buy it, and whether it fits your goals |
| **Learn** | Build pattern recognition and fluency over time |

---

## 3. The Wine Entry (Core Data Object)

Every feature in the app either creates, enriches, or queries a wine entry. This is the single shared object across all hotspots.

### Field Tiers

Wine entry fields are divided into two tiers based on extraction reliability and structure. This distinction governs how the label scan prompt is constructed and how missing values are handled.

**Tier 1 — Canonical fields.** Present on virtually every bottle. Extracted from standardised label conventions with high confidence. These fields are expected to be populated on every wine entry. A scan that cannot populate a Tier 1 field should surface a clear UI prompt for manual entry — never silently omit.

**Tier 2 — LLM-enriched fields.** Require interpretation rather than extraction. The model applies a defined ruleset and either populates the field confidently or falls back gracefully. These fields are nullable by design. A miss is acceptable; a hallucination is not. Fallback behaviour is defined per field.

---

### Fields

#### Tier 1 — Canonical

| Field | Type | Source | Notes |
|---|---|---|---|
| `id` | UUID | System | Auto-generated |
| `producer` | String | Scan / GPT-4o | Producer / domaine. First display field — primary identity of the wine alongside denomination. |
| `vintage` | Year | Scan / manual | Null if NV |
| `region` | String | Scan / GPT-4o | Broad geographic region. e.g. Burgundy, Piedmont, Rioja |
| `denomination` | String | Scan / GPT-4o | The controlled designation of origin for the wine, regardless of country-specific naming convention. Maps to AOC/AOP (France), DOC/DOCG (Italy), DO/DOCa (Spain), AVA (USA). e.g. Volnay, Barolo, Rioja DOCa, Chablis. Second display field alongside producer. |
| `label_image` | URL | Scan | **Not currently populated.** `label_image_url` is hardcoded null in every wine created by the web frontend — the scan preview shown during review is a same-session browser object URL, never persisted. Noted 2026-08-16 (Phase 9.3); revisit if persisting the image becomes a goal. |
| `tag_discovered` | Boolean | User | Wines seen or noted in the wild that have not yet been assigned to another list. **No longer set automatically (Phase 9.4, 2026-08-19)** — it is now one of three explicit choices on the discovery review screen, alongside wishlist and cellar. A wine that is scanned and then abandoned never acquires it. |
| `tag_wishlist` | Boolean | User | True when the user wants to purchase this wine. As of Phase 9.3, offered as an explicit choice on the post-save discovery review screen, not only later from the wine's card/detail view. |
| `tag_cellar` | Boolean | User | True when the wine is physically in the user's possession. Same Phase 9.3 note as `tag_wishlist` above. |
| `tag_consumed` | Boolean | System / User | True when at least one bottle has been consumed. Set automatically when a tasting note is saved; can also be set manually. |
| `cellar_quantity` | Integer | User | Number of bottles currently in the cellar. Adjustable from the cellar list view. Does not automatically reset to zero when `tag_cellar` is removed — user manages explicitly. |
| `cellar_category` | Enum | Reserved, unused | `table`, `near_term`, `long_term`. Not read or displayed anywhere in the shipped UI — same reserved status as `expert_reviews`/`community_sentiment` below. As of Phase 9.3 it is also no longer asked for at wine creation (previously collected on both the scan-review and manual-add forms, before the user has any basis to answer it). Column and type remain in the schema; revisit only alongside a real cellar-organisation feature. |
| `drinking_window_start` | Date | Professional reviews (Phase 8) / manual | Derived from professional review extraction when unambiguous — never blended across disagreeing critics (see Section 6). User-editable at any time, at manual wine-entry creation or later; a manually-set value is never overwritten by a later automated run. |
| `drinking_window_end` | Date | Professional reviews (Phase 8) / manual | Same rules as `drinking_window_start`. |
| `vintage_rating` | Enum | Professional reviews (Phase 8) | `below_avg`, `avg`, `good`, `very_good` for this region+year. Displayed as **"Year"** in the UI (developer preference, not a field rename). Never blended across critics — populated only when sources agree, otherwise left null. |
| `expert_reviews` | Array | Reserved, unused | Early design intent — attributed critic scores are now sourced automatically via `review_data` (Phase 7, extended Phase 8), not manually attached. This field is not currently populated by any shipped phase; see `build-phases.md` schema note. |
| `community_sentiment` | String | Reserved, unused | **Descoped, not merely paused (2026-09-03).** No reliable data source was ever found: the original Reddit-based plan was retired 2026-07-28, and the YouTube-based alternative (`build-phases.md` Phase 8.5) was scoped as an optional PoC but never actually run. Column stays reserved, same treatment as `expert_reviews`; revisit only if a genuinely new data source emerges. See Section 6 and Section 8. |
| `community_excerpts` | Array | Reserved, unused | Same descoped status as `community_sentiment` above. |
| `price_data` | Object | Serper + Puppeteer | Min/avg/max price from Serper Shopping results (vintage-mismatched and non-standard pack/bottle-size listings excluded from the aggregate), nearest retailer to NYC; null until first run. Each retailer entry carries `is_preferred_retailer` — as of Phase 9.3, summarised on the discovery review screen as a one-line "carried by" check, computed client-side at zero additional cost. Attributed critic scores live in `review_data` (Phase 7), a separate object. |
| `retailer_links` | Object | User-saved | URLs saved by user from retailer search sessions, across twelve configured retailers as of Phase 9.1 (2026-08-02, JJ Buckley added) — see Section 6's Source Evaluation Log; keyed by retailer slug; null until user saves |
| `review_data` | Array | Serper + Puppeteer + GPT-4o | Per-retailer attributed critic scores, drinking windows, vintage character, and value/deal signal (Phase 7, extended Phase 8). Populated via a click-gated "Fetch Reviews" action — as of Phase 9.3 this is the first, most prominent action on the post-save discovery review screen, reflecting that it's the strongest signal for deciding whether to keep a wine. Deliberately not auto-fetched on save — see Section 8 and `docs/CLAUDE.md` §15's Serper cost constraint. |
| `my_rating` | Enum | User | `poor`, `acceptable`, `good`, `very_good`, `outstanding` |
| `my_tasting_notes` | Object | User | Structured WSET tags + free text |
| `my_tags` | Array | User / inferred | Searchable tags derived from tasting notes via GPT-4o tag extraction. Treated as a derived field once a tasting note exists — not manually authored. Must stay consistent with tags on the `tasting_notes` sheet; do not allow the two to diverge. |
| `latest_tasting_note_id` | UUID | System | Foreign key to the most recent entry in the `tasting_notes` sheet for this wine. Null until a tasting note is recorded. Updated each time a new note is saved — always points to the most recent. Used by the UI to show the Evaluate CTA (null) or the most recent rating in list views (populated). Full tasting note history is retained in the `tasting_notes` sheet and queryable by `wine_id`. |
| `advice_linked` | Array | User | UUIDs of advice entries attached to this wine. Foreign keys to the `advice` sheet. |
| `wishlist_notes` | String | User | Why I want this. Captured on the wishlist form and saved; not currently surfaced on any card or detail view — deferred, not dropped (2026-09-03). |
| `price_paid` | Float | User | Captured at manual entry; not currently surfaced on any card or detail view — deferred, not dropped (2026-09-03). |
| `purchased_from` | String | User | Retailer name. Captured at manual entry; not currently surfaced on any card or detail view — deferred, not dropped (2026-09-03). |
| `date_first_consumed` | Timestamp | System | Populated automatically when `tag_consumed` is first set to true. Not updated on subsequent consumptions. |
| `promoted_at` | Timestamp | System | Null until the user affirms the wine into the collection (Phase 9.4). A wine is written to the database the moment a label scan parses — enrichment needs an id to attach to — but a row with `promoted_at IS NULL` is a **draft**: it appears in no list, no count and no query, and is deleted by a sweep 24 hours after creation if never affirmed. Set when the user presses **Save to Collection** with at least one list tag selected. Deliberately not encoded as "all tags false": a draft and a wine the user deliberately removed from every list would then be indistinguishable, and neither cleanup nor list-query performance survives that. |
| `date_added` | Timestamp | System | |

#### Tier 2 — LLM-enriched

These fields are populated by the label scan module using rule-guided extraction. Each has defined fallback behaviour. A field left null is always preferable to a hallucinated value.

| Field | Type | Source | Extraction rules | Fallback |
|---|---|---|---|---|
| `quality_classification` | String | Scan / GPT-4o | Quality or aging tier designation. Extract if label contains: Premier Cru, Grand Cru, 1er Cru, Riserva, Reserva, Gran Reserva, Superiore, Classico, Cru Bourgeois, or equivalent. | Null if no recognised designation found. Never infer from context. |
| `vineyard` | String | Scan / GPT-4o | Specific vineyard or lieu-dit within the denomination. Extract if: (1) text appears in quotation marks on the front label and is not the producer or denomination; (2) text is preceded by a known vineyard prefix: Viña, Vina, Vigna, Vigneto, Clos, Les. If label text remains uncategorised after all Tier 1 and other Tier 2 fields are extracted, attempt to classify it as a vineyard; if confidence is low, append to `cuvee` instead. | Null if no text triggers the above rules. Do not guess. |
| `cuvee` | String | Scan / GPT-4o | A proper commercial name for the wine that is distinct from the denomination, vineyard, or producer — typically used by Champagne houses, prestige cuvées, and some New World producers. e.g. Cristal, Belle Époque, Opus One. Also used as the overflow field for uncategorised label text that cannot be confidently assigned to vineyard. | Null if no distinct cuvee name is present. Do not populate with the denomination or producer name. |
| `grape_varieties` | Array | Scan / GPT-4o | Grape varieties for the wine. Extract directly from the label if listed. If not listed, infer from the denomination using established regional conventions (e.g. Volnay → Pinot Noir, Barolo → Nebbiolo, Rioja Tinto → Tempranillo-dominant). Confidence is high for well-known denominations; leave null for obscure or ambiguous denominations where the blend varies significantly by producer. | Null if denomination is too obscure to infer reliably. Never guess for unknown denominations. |
| `wine_color` | Enum | Scan / GPT-4o (Phase 10.5) | `red`, `white`, `rosé`, or null. Extracted only from explicit label cues (a stated color term, or an unambiguous visual/textual signal like "Blanc de Blancs") — deliberately narrower than `grape_varieties`: never inferred from grape variety or denomination convention, since many grapes can be vinified more than one way. No provenance/`*_source` tracking (unlike `drinking_window_start`/`vintage_rating`) — a manual `PATCH` simply overwrites it, same as `quality_classification`. Powers the Cellar tab's red/white/rosé breakdown (`CellarStats.tsx`, shipped Phase 10.5). | Null on any ambiguous or unstated case. Never guess. |

### List Tag Model

A wine entry carries four boolean tags that govern which lists it appears in. Tags are additive — a wine can carry any combination simultaneously. There is no lifecycle or required progression between tags.

| Tag | When set | When removed |
|---|---|---|
| `tag_discovered` | User selects it on the discovery review screen and presses Save to Collection (Phase 9.4). Not automatic — see `promoted_at` | User removes it manually via the tag management UI |
| `tag_wishlist` | User adds it via tag management, including on the post-save discovery review screen as of Phase 9.3 | User removes it manually |
| `tag_cellar` | User adds it via tag management, including on the post-save discovery review screen as of Phase 9.3 | User removes it manually |
| `tag_consumed` | Automatically when the first tasting note is saved; or user sets it manually | User removes it manually |

**Tag management UI:** Available from any wine entry in any list view, and — as of Phase 9.3 — from the discovery review screen shown immediately after a wine is created (both scan and manual-add paths), once the user has seen reviews, retailer availability, and price for it. After saving a tasting note the user is prompted to review and update their tags. Tags can also be edited at any time from the wine entry detail screen.

**Example:** A wine that has been consumed but still has bottles in the cellar and is on the wishlist for reordering would carry `tag_cellar`, `tag_consumed`, and `tag_wishlist` simultaneously. It would appear in all three list views.

**Tasting Notes list:** A system-derived list showing all wine entries where `latest_tasting_note_id` is not null, sorted by the date of the most recent tasting note descending. Not a user-managed tag — it is always a reflection of which wines have evaluations.

---

## 4. Job Areas & Feature Requirements

---

### 4.1 Capture
**Context:** In the wild — at a restaurant, dinner party, or tasting. Phone is accessible but social attention is primary. The user cannot spend more than a few seconds on any single interaction.

**Pains**

| Pain | Score | Description |
|---|---|---|
| Remembering advice from companions/sommeliers | 5 | Tips are given verbally and lost by morning |
| Combing through camera roll afterwards | 4 | Matching photos to memories is tedious and often abandoned |
| Remembering producer/label patterns | 4 | Wine knowledge is pattern recognition; patterns need reinforcement |
| Updating wishlist manually | 3 | Post-meal admin feels like homework |
| Taking notes without seeming rude | 1 | Social friction of visibly documenting at the table |

**Gains**

| Gain | Score | Description |
|---|---|---|
| Advice from experts compounds over time | 4 | Knowledge is shaped by the best sources, not lost after each meal |
| Building a mental map that sticks | 4 | Wine starts feeling like a language I speak |
| Saving 30 min of post-meal admin | 3 | Removes the intimidating backlog; increases completion rate |
| Fully present at the table | 2 | Capture is invisible; the evening is not interrupted |

**Pain Relievers**

- Quick-log flow: take a photo → tap poor / acceptable / good / very good / outstanding → done. No further input required in the moment.
- End-of-night digest: user initiates (or is prompted) to review all `good`-or-above captures from the session. App auto-populates wine entry fields from label scan via GPT-4o. User confirms or adjusts.
- Conversation capture: dedicated input for logging tips and advice. Records the tip, who gave it (role: sommelier / friend / etc.), category (producer, technique, value, region), and optionally links to a wine entry.
- Batch processing: a single digest action updates wishlist, creates wine entries, and files advice — replacing the manual spreadsheet workflow.

**Gain Creators**

- Raw inputs (photos, voice notes, typed tips) are aggregated into a structured session digest, updating multiple repositories in one action.
- Producer and region patterns from the user's own tasting history are surfaced automatically — no manual memorisation required.
- Bottle images are displayed prominently throughout the app so visual memory is reinforced passively. **Caveat added 2026-08-16 (Phase 9.3):** this is aspirational relative to the current build — the web app does not currently persist the scanned label image at all (see the `label_image` field note in Section 3), and as of Phase 9.3 deliberately stops even *displaying* it on the discovery review screen, in favour of reviews/price/retailer signal. Revisit together if and when image persistence is built.

---

### 4.2 Research
**Context:** Two triggers — (a) in a wine shop, standing in front of a bottle; (b) browsing online, encountering a wine on a retailer site or article. In both cases the user needs a fast, confident signal: is this worth investigating further?

**Pains**

| Pain | Score | Description |
|---|---|---|
| Lack of trustworthy reviews | 5 | Retailer reviews are often absent or from inflated/unreliable sources (e.g. Jeb Dunnuck). Reputable sources (Burghound, Burgundy Report) are paywalled or niche. |
| Vintage quality is hard to determine | 4 | Region + year combinations vary widely; anecdotal knowledge required |
| Constantly looking up wines on phone | 2 | Repetitive, interrupts the shopping experience |
| Good information is paywalled | 2 | Burghound, Burgundy Report, etc. |
| Not knowing if the price is fair, or whether it's worth the decision to save the wine at all | 3 | Added 2026-08-16 — the developer's own framing of what the post-scan/post-add screen needs to answer, in priority order: is this worth keeping (reviews), does a trusted shop carry it (preferred retailers), what list does it belong on, and is the price sane. |

**Gains**

| Gain | Score | Description |
|---|---|---|
| A consistent, trusted voice guiding decisions | 3 | Retailer bias and inflated scores stop reaching me |
| Instant triage — investigate or move on | 2 | Within seconds of seeing a bottle, I know if it's worth considering |
| Paywalled spend pays itself back | 2 | I can measure the ROI of subscriptions against bottles I rated good or above |

**Pain Relievers**

- Scan a label or add a wine manually → both paths land on the same **discovery review screen** (Phase 9.3, retimed by Phase 9.4, `build-phases.md`), ordered by priority rather than by data-source convenience: (1) reviews — on the scan path these are **already being fetched** by the time the screen appears, fired at the `primary` retailer tier the moment label parsing returned, so the seconds spent verifying the parsed fields are the seconds the search needs; when that tier finds nothing, a "Search more retailers" button runs the deeper escalation ladder on request; (2) a one-line preferred-retailer carry-check ("Carried by K&L, Flatiron — 2 of 12"), computed from the price data already being fetched, at no extra cost; (3) price — min/avg/max and nearest retailer to NYC; (4) an explicit discovered/wishlist/cellar decision, which is what actually admits the wine to the collection — until at least one tag is chosen and **Save to Collection** pressed, the entry is a draft and appears nowhere (Phase 9.4). This replaces an earlier two-tab design (Phase 6.5) that was never actually built as tabs, auto-fetched only price, and asked for a `cellar_category` nothing downstream used.
- One-tap retailer search buttons, across twelve configured retailers as of Phase 9.1 (2026-08-02), constructed from wine identity data — opens retailer product page in browser where professional reviews are published. User can save a specific product page URL back to the wine entry for future reference.
- Vintage intelligence: for each bottle, a vintage character read (`vintage_rating`, displayed as "Year" in the UI) drawn from professional review extraction (Phase 8) — never blended across critics; populated only when sources agree.
- In-store trigger: camera scan. Web trigger: iOS share sheet (v1), browser extension (future).

**Gain Creators**

- All configured data sources are displayed as distinct layers on the wine entry card — each source speaks in its own voice. The more sources configured, the more complete the picture.
- Tapping any wine entry from any list opens a compact read-only detail view showing all known data for that wine: identity fields, status tags, saved review links, crawled price, and nearest retailer, plus attributed critic scores (Phase 7).

---

### 4.3 Evaluate
**Context:** At home, opening a good bottle, often with company. The user wants to record a tasting note without it feeling like homework or being antisocial.

**Pains**

| Pain | Score | Description |
|---|---|---|
| Taking notes in front of guests feels rude | 4 | Same social friction as Capture, but at home with a better bottle |
| Review notebook and spreadsheet are out of sync | 3 | Two systems, neither complete |
| Uncertainty about which tasting framework to use | 3 | WSET is known but imperfect |

**Gains**

| Gain | Score | Description |
|---|---|---|
| Tasting notes become sharp and transferable | 4 | Impressions are clear on revisit and build future evaluation skills |
| Reviews are consistent without being slow | 3 | Enough detail to be useful; fast enough not to distract from the experience |

**Pain Relievers**

- Structured tasting note form using the WSET framework with pre-populated options for each field: clarity, colour, body, nose (fruit types, oak, earth, etc.), palate, finish. Minimises typing.
- Framework is fixed as WSET in v1.
- The Evaluate CTA is available from any list view a wine entry appears in, and from the wine entry creation confirmation screen. There is no status gate — any wine can be evaluated at any time.
- When a tasting note is saved, the user is prompted to review their list tags and add or remove any as appropriate. This replaces any "move to consumed" prompt — the user decides explicitly which lists the wine should appear in going forward.
- Reviews link automatically to the wine entry via `wine_id` on the `tasting_notes` sheet — no separate spreadsheet required.
- Multiple tasting notes per wine entry are supported and all retained. The most recent note's rating is displayed in list views; the full history is accessible from the wine entry detail screen.
- Any list view displaying a wine with a tasting note allows the user to click through to view the associated reviews and drill into an individual note.

**Gain Creators**

- Tasting note characteristics are extracted as structured tags (body, finish, primary/secondary/tertiary aromas). Tags are reused across the app so a wine can be understood at a glance without reading the full note.
- Written or voice notes can be uploaded and transcribed; tags extracted automatically via GPT-4o.
- Tags build a personal flavour vocabulary over time that informs recommendations and learning.
- Multiple notes on the same wine across different occasions reveal how a wine evolves with age — a compounding learning asset.

---

### 4.4 Cellar
**Context:** At home. The user wants to know the state of their collection at any moment and make sure it is developing intentionally, not accidentally.

**Pains**

| Pain | Score | Description |
|---|---|---|
| Keeping track of collection and consumed bottles | 5 | Manual entry is burdensome; user has essentially given up on a spreadsheet |
| Concern about improper storage | 3 | Temperature, humidity, and UV variables are hard to monitor passively |

**Gains**

| Gain | Score | Description |
|---|---|---|
| Know exactly what's in the cellar at any point | 4 | Full collection visibility, filterable and current |
| Bottles in drinking window are immediately obvious | 5 | No cross-referencing required |
| Collection maps to goals; drift is visible | 3 | Like a model portfolio — I can see if I'm on track |
| Environment is monitored passively | 2 | Peace of mind without manual checking |
| Capacity trend is clear | 1 | Simple fraction of bottles vs. capacity |

**Pain Relievers**

- Cellar list displays `cellar_quantity` alongside each wine entry — the number of bottles currently held. Quantity is adjustable directly from the list view without opening the full entry.
- Environment monitoring via SensorPush integration: temperature and humidity readings pulled from SensorPush Cloud API and displayed in-app.

**Gain Creators**

- Collection visualisation: all bottles, filterable and groupable by red/white, region, style, drinking window. **Shipped in part, Phase 10.5 (2026-09-03):** `CellarStats.tsx` now shows region-by-region allocation bars split red/white/rosé/unknown via the new `wine_color` field, summed by `cellar_quantity`. Grouping by `cellar_category` is still not one of the working filters — that field stays reserved and unused (Section 3); see the resolved Open Question in Section 8 for why a drinking-window-based filter, not a `cellar_category` revival, is the intended path for the remaining piece. A flat, filterable-by-drinking-window list view (ready to drink / needs more time / no window identified) is still Phase 11 work, not yet built.
- Allocation drift view: user defines a target distribution (e.g. 30% Burgundy, 20% Rioja, 20% table wine). App shows actual vs. target — modelled on a managed investment account drift report.
- Drinking window view: bottles currently in window are surfaced prominently. Drinking windows derived from configured data sources and updated as new reviews are published.
- Capacity indicator: current bottle count vs. total capacity shown as a fraction and visual. **Shipped, Phase 10.5 (2026-09-03):** a new `app_settings` table (singleton row) holds a user-set `cellar_capacity`; `CellarStats.tsx` computes and displays the percentage from it plus the existing `cellar_quantity` sum — no backend aggregation endpoint, computed client-side. Editable in-app via `GET`/`PUT /api/settings`.

---

### 4.5 Wishlist + Purchasing
**Context:** At home, making a buying decision. The user has identified a bottle of interest and needs to decide: buy it, where, at what price, and does it fit the collection?

**Pains**

| Pain | Score | Description |
|---|---|---|
| Risk of heat/transit damage when shipping | 4 | Hot months, long distances, unknown retailer policies add risk to remote purchases |
| Approachability vs. long-term potential | 4 | Buying something too early risks drinking it too soon; buying too late wastes a window |
| Double down or spread the love? | 3 | Multiple bottles of the same wine reduce bad-bottle risk but sacrifice variety |
| Difficult to know if I'm getting a good price | 2 | Cross-referencing retailers is manual |
| Availability — may require shipping | 2 | Not all wines are available locally |
| Bolster known areas or explore new ones? | 2 | Risk/reward tension in every purchase |
| Determining a reasonable budget | 1 | |

**Gains**

| Gain | Score | Description |
|---|---|---|
| Confident the bottle will arrive in good condition | 4 | Same quality as picking it up from a trusted local retailer |
| Collection develops intentionally, not accidentally | 4 | Each purchase moves it closer to a vision |
| Best available price without excessive travel | 3 | No lingering suspicion of overpaying |
| Instantly see how a bottle fits the collection | 2 | Gap vs. overlap, producer count, similar bottles already held |

**Pain Relievers**

- Price discovery via Serper: min/avg/max price across twelve preferred retailers (as of Phase 9.1, 2026-08-02), with fallback to any retailer Google has indexed, plus a dedicated open-web fallback specifically for review sourcing when none of the twelve carry an attributed score (Phase 7.3). Nearest retailer to NYC surfaced prominently with tappable link. As of Phase 9.2, both price and reviews are freshness-guarded (7-day / 30-day TTL) so a repeat check doesn't re-spend automatically.
- One-tap retailer search buttons, across the same twelve retailers, for quick access to professional reviews before committing to a purchase.
- Wine detail view shows saved review links, crawled avg price, attributed critic scores, and nearest retailer in a single compact screen — all purchasing signals in one place.
- Prior ratings of similar wines from the same producer surfaced as a risk signal.

**Gain Creators**

- Attributed critic scores (e.g. Burghound, Vinous, Wine Advocate) extracted from retailer pages and displayed per publication, each source speaking in its own voice — **Phase 7** (`build-phases.md`). Requires rendering the actual single-product page on a retailer's site; the price module's retailer URLs are deliberately search-results pages, not product pages, so this needs its own page-location step and isn't part of pricing.
- A "Deal" badge surfaces on the wine entry when a professional review explicitly states strong value/QPR for the wine (e.g. "overdelivers for the price") — extracted alongside critic scores and drinking windows, per critic, **Phase 8** (`build-phases.md`). Not inferred from a score-to-price ratio; text-stated only.
- Collection fit summary: how many bottles from the same producer and vintage are already held, and how the purchase would affect allocation drift. (No longer framed around `cellar_category` — see Section 3's note; that field isn't populated or read anywhere today.)
- Table wine finder: a dedicated recommendation surface for sub-$30 bottles the user has rated highly — scratch-the-itch alternatives to raiding the cellar.

---

### 4.6 Learn
**Context:** At home, in a curious or reflective mode. The user wants to build durable wine knowledge — producer patterns, regional associations, vintage quality — so that wine stops feeling like a foreign language.

**Pains**

| Pain | Score | Description |
|---|---|---|
| Committing producer/label/region patterns to memory | 4 | Wine is pattern recognition; the patterns need active reinforcement |

**Gains**

| Gain | Score | Description |
|---|---|---|
| Discover similar wines to long-term cellared bottles | 5 | Scratch the itch and avoid raiding the cellar too early |
| Know which spots in the cellar are worth holding | 5 | Each bottle is allocated intentionally |
| Tap all available professional opinion on a vintage | 4 | Confident drink-or-hold decisions. Community opinion is a possible future addition, pending a viable data source — see Section 8 Open Questions. |
| New reviews are integrated as they are published | 4 | Knowledge is never stale |
| Build a mental map that sticks | 4 | Wine feels like a language I speak, not translate |
| Understand good vs. bad years by region | 4 | Vintage context informs every decision |

**Gain Creators**

- Pattern quiz: flashcard-style quizzes testing producer-to-region associations, label recognition, village tasting note characteristics, and good/bad vintage years.
- Visual memory: label images, regional maps, and bottle photos used throughout the app to reinforce visual pattern recognition passively. Same caveat as Section 4.1 — label images are not currently persisted; this is a future-state gain creator, not a shipped one.
- Vintage index: each region has a year-by-year quality rating (`below_avg` → `very_good`) derived from configured data sources. Visible in cellar, on wine entries, and in purchase decisions.
- Advice archive: all tips captured from sommeliers and dining companions, searchable and categorised (producer, technique, region, value). Linked to wine entries where relevant.
- Live-updating knowledge: wine entries, drinking windows, and vintage ratings are refreshed as new reviews are published. The wishlist and cellar are never static.

---

## 5. Cross-Cutting Principles

These apply everywhere in the app. An agent building any feature should check these before making design or implementation decisions.

**Wine entry fields are tiered by extraction reliability.** Tier 1 fields (canonical) are expected on every bottle and must always be populated — surface a manual entry prompt if a scan misses one. Tier 2 fields (LLM-enriched) are nullable by design and follow explicit extraction rules defined in Section 3. A null Tier 2 field is always preferable to a hallucinated value. This distinction governs how the label scan prompt is constructed and how missing values are handled throughout the app.

**Visual first.** The app should use images of bottles, labels, and regional maps wherever possible. Wine is a visual and associative domain. Text-only interfaces miss the point. **Tempered 2026-08-16:** where a specific screen is fighting for space against higher-priority information — as on the post-scan/add discovery review screen — showing what helps a keep/discard decision (reviews, retailer availability, price) outranks showing an image that, today, isn't even being persisted. "Visual first" is a general orientation, not a mandate to show every image on every screen regardless of what else is competing for the same space.

**The wine entry is the atom.** Every screen either creates, enriches, reads, or changes the status of a wine entry. There is no feature that does not connect to one.

**Trusted reviewer system.** The user maintains a personal list of sources they trust and distrust. This list influences every review surface in the app. It is configurable and persistent. No review is shown without attribution to its source.

**Live-updating data.** Drinking windows and vintage ratings are not static values set at the time of entry — they're recalculated as new reviews are published, unless the user has manually set or overridden them, in which case the manual value takes precedence and is never silently replaced. The app should reflect the current state of knowledge, not the state at the time of purchase.

**Capture is low-friction above all else.** Any capture interaction that requires more than two taps or ten seconds in the moment has failed. Enrichment can happen later.

**List tags are additive, not a lifecycle.** A wine entry carries four boolean tags (`tag_discovered`, `tag_wishlist`, `tag_cellar`, `tag_consumed`) that govern which lists it appears in. Tags can be combined freely — a wine can appear in multiple lists simultaneously. There is no required progression between tags. The user manages tags explicitly; as of Phase 9.4 the only automatic tag behaviour is `tag_consumed` set when a first tasting note is saved.

**Entering the collection is an affirmative act.** Added 2026-08-19 (Phase 9.4). Scanning a bottle is not a decision to keep it — it is the start of finding out whether it is worth keeping. A scanned wine is persisted immediately, because enrichment needs a row to attach to, but it stays a draft (`promoted_at IS NULL`) and reaches no list until the user selects at least one list tag and presses **Save to Collection**. Anything the user walks away from is swept within 24 hours. This is what makes the discovery review screen a real decision point rather than a confirmation of one already made for the user, and it is the reason `tag_discovered` stopped being automatic. The corollary matters as much: nothing that costs money or attention may treat a draft as a member of the collection.

**Cellar allocation is intentional.** The user has a mental model of what their ideal collection looks like. The app should surface drift from that model, not just report inventory.

**Social context matters for capture.** Notes and ratings taken at a table or in a shop should feel invisible to companions. Speed and discretion are product requirements, not nice-to-haves.

**Information is additive by layer.** Each configured data source adds a distinct type of information to a wine entry. Sources are never blended or synthesised against each other — each speaks in its own voice. A user with more sources configured gets a more complete picture, not a different one.

**All credentials are local.** No API key, subscription credential, or user-supplied secret is ever transmitted to or stored on the app's servers. All credentials live in iOS Keychain on device.

**Metered enrichment is user-initiated, prioritised by usefulness not cost.** Added 2026-08-16 (Phase 9.3), generalising a decision `docs/CLAUDE.md` §15 already fixed for the backend: an enrichment action that costs real money per call (reviews, price) is never fired automatically just because a screen loaded. Where multiple such actions compete for a user's attention on one screen, order and prominence follow what best helps the user's actual decision — not which one happens to be cheapest to fetch. Reviews are more expensive than price and are still surfaced first, because they answer the more important question.

---

## 6. Data Sources & Architecture

### The Additive Layer Model

Three independent layers. Each unlocks a distinct type of information. Configure more layers, get a more complete picture.

| Layer | Source | What it adds | Access model |
|---|---|---|---|
| **Price & retailer data** | Serper.dev (Google SERP API) + Puppeteer | Step 1: Serper queries Google Shopping and returns structured price/retailer data — preferred retailers first, any retailer as fallback. Step 2: Puppeteer renders SPA product pages so GPT-4o can extract attributed critic scores. Retailer list is config-driven and extensible. | Paid. See the Serper.dev row in the Source Evaluation Log below for current billing state — the "2,500 queries/month free tier" recorded here through Phase 9.3 was wrong and is gone. Puppeteer runs locally, no external cost. |
| **Professional review extraction** | Serper (organic search) + Puppeteer + GPT-4o | Attributed critic scores, per-critic drinking windows, vintage character, and value/deal signal — extracted from real rendered retailer product pages, never blended across critics. Phase 7 (scores) extended by Phase 8 (drinking window, vintage character, deal); cost-tiered into primary/extended retailer passes and TTL-guarded in Phase 9.2. | Same Serper/Puppeteer infrastructure as pricing; one `SERPER_API_KEY` covers both. GPT-4o key BYOK for extraction. |
| **Retailer review access** | Twelve configured retailers as of Phase 9.1 (2026-08-02): K&L, Zachys, Woodland Hills, Benchmark, Sokolin, Acker Wines, Wine Library, Morrell & Company, Crush Wine & Spirits, Flatiron Wines & Spirits, Thatcher's Wine, JJ Buckley Fine Wines | One-tap search links to retailer product pages carrying professional reviews (Burghound, Vinous, Wine Advocate, Wine Spectator) — the manual-reading complement to the automated extraction above. Professional review extraction (the row above) also has its own open-web fallback beyond this named list — see Phase 7.3. | No API — app constructs search URL from wine entry data; user reads review on retailer site |

A fourth layer, **community opinion**, was originally planned around the Reddit API but was retired 2026-07-28 after Reddit closed self-service API registration (see Section 8 Open Questions for the full record). A YouTube-based alternative is being evaluated as a separate, optional proof-of-concept (`build-phases.md` Phase 8.5) — not yet a committed layer.

**Note on architecture:** The four original target retailers (Zachys, Woodland Hills, Benchmark, and K&L) are Single Page Applications — direct HTTP fetches return empty shell HTML. Serper.dev is used for price/retailer discovery because Google has already crawled and rendered these pages. Puppeteer renders each retailer's constructed search-results page to verify it still shows results before its price is trusted — not to extract critic scores (see note below). The retailer list is a typed config array — adding a retailer is a one-line config change, no logic changes, though `docs/CLAUDE.md` §15 requires stating the resulting per-wine Serper-call cost whenever one is added. If none of the preferred retailers carry a wine, the module falls back to whatever relevant retailers Serper found, capped at 5.

**Note on professional review APIs:** Burghound, Vinous, and Wine Advocate do not offer programmatic access to individual subscribers. The original plan was for a Puppeteer pass to extract attributed scores (numbers only — never tasting note text) from retailer pages where they appear publicly. That's now Phase 7 (`build-phases.md`), extended in Phase 8 to also pull drinking window, vintage character, and a value/deal signal from the same rendered pages — same copyright boundary throughout: structured facts only, never source prose. The price module's retailer URLs are deliberately search-results pages (verified live before a price is trusted, not rendered for content extraction) — pricing and review extraction turned out to be different problems that happened to share a retailer list, not one feature. The retailer deep-link approach (Layer 3) still provides direct access to full review text in the meantime — that doesn't depend on Puppeteer at all, it's just a constructed URL handed to the browser.

### Label Scanning

**Model:** GPT-4o vision (high detail mode)
**Input:** Image file resized to max 1024px on longest side before API call. Never send raw input. In Phase 3 this arrives via web file upload; in Phase 11 it arrives from the native iOS SwiftUI camera. The module handles both identically.
**Output:** Structured JSON covering all Tier 1 and Tier 2 wine entry fields. Tier 1 fields (producer, vintage, region, denomination) are expected on every scan. Tier 2 fields (quality_classification, vineyard, cuvee, grape_varieties) are nullable — omit rather than hallucinate. See Section 3 for field-level extraction rules.
**Phase 3 capture surface:** Web file upload (HTML file input, image/*) — validates the pipeline without requiring a native app.
**Phase 11 capture surface:** Native iOS SwiftUI camera (AVFoundation) — replaces file upload as the production capture surface. Backend module unchanged.
**Cost:** ~$0.004 per scan at 1024×1024 (765 image tokens + prompt + output at $2.50/1M input, $10.00/1M output)
**Key:** User-supplied OpenAI API key, stored in iOS Keychain
**Future optimisation:** Test GPT-4o Mini ($0.60/1M input) once feature is stable — potential 75% cost saving for clean labels
**Image persistence:** Not currently implemented — see the `label_image` field note in Section 3.

### LLM Layer (Review Extraction)

**Model:** GPT-4o
**Purpose:** Extract structured facts from rendered retailer product pages — attributed critic scores (Phase 7), plus per-critic drinking window, vintage character, and value/deal signal (Phase 8). Structured output only; never stores or reproduces source review prose (copyright boundary).
**Key management:** BYOK. OpenAI API key stored in iOS Keychain, never on server
**Fallback:** If no key configured, `modules/reviews/` returns empty `review_data`. Feature degrades gracefully, never throws.
**v1:** Developer supplies their own key
**Trigger:** Click-gated (`POST /:id/fetch-reviews`), never automatic — see Section 5's "Metered enrichment is user-initiated" principle and `docs/CLAUDE.md` §15. As of Phase 9.3, this is the first action presented on the post-save discovery review screen, reflecting its priority as the strongest keep/discard signal — prominence changed, automation did not.

### Environment Monitoring

**Hardware decision:** SensorPush (not Govee)
- Rationale: open Cloud API with OAuth/REST, US data jurisdiction, best-in-class accuracy, active developer ecosystem
- Required hardware: SensorPush HT.w or HTP.xw sensor + G1 WiFi Gateway (~$150 combined) for remote monitoring
- Bluetooth-only mode supported when phone is in range, but Gateway required for always-on Cloud API access
**Integration:** SensorPush Cloud API — OAuth 2.0, returns temperature, humidity, and historical samples as JSON
**Activation requirement:** User must log in to SensorPush Gateway Cloud Dashboard once to accept API terms of service before the integration can authenticate
**Credentials:** SensorPush account email/password stored in iOS Keychain

### Source Evaluation Log

| Source | Decision | Reason |
|---|---|---|
| CellarTracker | Personal export only | ToS Section 9 explicitly prohibits scraping. Authenticated personal data export via `xlquery.asp` is permitted for user's own cellar, notes, and consumed bottles. Community-wide data requires partnership — not pursuing. |
| WineBerserkers | Not pursuing | ToS Section 5 explicitly prohibits automated access. No API exists. Partnership not pursuing. |
| Reddit | ⛔ Not pursuing | Self-service Data API registration closed 2026 under Reddit's Responsible Builder Policy — every new token now requires manual approval, and personal/hobbyist use is reported rejected or ignored at a high rate. The unofficial `.json` fallback was itself shut down 2026-05-28. Official commercial tier requires a contract, four-to-five-figure annual minimum, not self-service. Third-party resellers are unlicensed scraping — same category already ruled out for CellarTracker/WineBerserkers. Retired 2026-07-28; superseded by Phase 8's professional-review-extraction approach. |
| YouTube Data API v3 | 🔍 Under evaluation (PoC) | Official, self-service (instant API key, no approval queue), free within quota (10,000 units/day). The only alternative researched for community sentiment that's simultaneously official, self-service, and free. Coverage is uncertain — comments on wine review videos are reactions to a video, not targeted per-bottle discussion the way Reddit threads were. Scoped as an explicitly optional PoC, `build-phases.md` Phase 8.5, not a committed layer. |
| Wine-Searcher | ⛔ Not in use | API evaluated and ruled out — Wine Check API costs $335/month, Market Price API costs an additional $350/month. Replaced by Serper.dev + Puppeteer approach in Phase 6. **Note (2026-08-16, Phase 9.3):** this decision was correctly recorded here, but the abandoned Wine-Searcher naming had separately leaked into live UI copy and code comments (`LabelScanFlow.tsx`, `WineCard.tsx`, `WineDetailModal.tsx`) that never got swept when the code moved to Serper — retired as part of Phase 9.3. If "Wine-Searcher" is seen anywhere in the running app again, it's stale and should be fixed the same way. |
| Serper.dev | ✅ In use, **paid** (Phase 6, cost-tiered Phase 9.2, billing corrected Phase 9.4) | Third-party Google SERP API. **Billing state as of 2026-08-19:** the free allowance was 2,500 credits **one-time on signup — not 2,500/month, as this document claimed through Phase 9.3 — and it is exhausted.** The project is on its first **$50 Starter pack: 50,000 credits, expiring six months from purchase** (confirmed 2026-08-19); smaller packs do not exist. One credit per standard query, two if more than ten results are requested. **What this means for design:** at ~10 credits per scanned wine and 20–50 scans/month the pack holds roughly five years of runway but expires at six months, so ~90% will be forfeited unspent. Effective cost is a flat ~$8.33/month whatever the per-scan thrift — a credit saved on one scan is not a dollar saved. Credit-efficiency arguments should therefore be made on latency, GPT-4o spend, or correctness grounds, not on Serper cost, until scan volume is roughly 10× higher. The $5/month target is unreachable by any application change; it is set by pack shape. Returns structured Shopping results including price, retailer name, and product URL. Google has already crawled and rendered SPA pages so Serper returns clean data without any browser required. Single `SERPER_API_KEY`. All outbound calls route through one accounted client (`shared/utils/serper-client.ts`, Phase 9.2) so spend is measurable per wine. |
| Puppeteer | ✅ In use (Phase 6) | Headless Chromium — executes JavaScript so SPA retailer pages render fully before GPT-4o score extraction. Used only in the price enrichment module. Not run in CI; mocked in tests with HTML fixtures. |
| Vivino | Not pursuing | No public API. Partnership not worth pursuing. Label scanning replaced by GPT-4o vision. |
| Burghound | ⛔ No API available | Confirmed: web-only database, browser session access, single-device enforcement. No programmatic access for individual subscribers. Accessible via retailer deep links (K&L, Benchmark carry Burghound reviews on product pages). |
| Vinous | ⛔ No API available | Confirmed: API exists but requires Vinous Enterprise ($2,000/year) + Liv-ex Gold membership. Not viable for personal use. Accessible via retailer deep links. |
| Wine Advocate | ⛔ No API available | Confirmed: API available via Liv-ex only, for trade businesses. Explicitly declined CellarTracker-style integration for individual subscribers. Accessible via retailer deep links. |
| K&L Wine Merchants | ✅ Retailer deep links | High review density — carries Burghound, Vinous, Wine Advocate, Wine Spectator on product pages. Search URL constructed from wine entry data. Own site blocks Puppeteer rendering (bot detection) — link-only, never priced or score-extracted directly; see `docs/CLAUDE.md` §5. |
| Zachys | ✅ Retailer deep links | Fine wine specialist, NYC-based. Strong Burgundy/Bordeaux depth. |
| Woodland Hills Wine Company | ✅ Retailer deep links | Trusted retailer with solid review coverage. Live domain is `whwc.com` — the original `woodlandhillswine.com` has lapsed. |
| Benchmark Wine Group | ✅ Retailer deep links | Fine wine specialist. Publishes Burghound, Vinous, Wine Advocate, Wine Spectator, James Suckling. |
| Sokolin | ✅ Retailer deep links (Phase 6.7, shipped Phase 7.3) | Bridgehampton, NY. Sourced from Burghound.com's own published tri-state retailer list. Carries Burghound, Vinous, Wine Advocate, Decanter, Wine Enthusiast — a dedicated `/wine-ratings` page. |
| Acker Wines | ✅ Retailer deep links (Phase 6.7, shipped Phase 7.3) | Manhattan, NY. Wine Advocate, Vinous confirmed. |
| Wine Library | ✅ Retailer deep links (Phase 6.7, shipped Phase 7.3) | Springfield, NJ. Wine Advocate, Vinous, Decanter confirmed. |
| Morrell & Company | ✅ Retailer deep links (Phase 6.7, shipped Phase 7.3) | Briarcliff Manor, NY (Westchester). Wine Advocate confirmed. Demonstrably carries attributed reviews (the Jean-Marc Vincent case, 2026-08-02) but is seeded `extended` tier in Phase 9.2's cost model pending re-measurement post-Phase-9.1. |
| Crush Wine & Spirits | ✅ Retailer deep links (Phase 7.3) | Manhattan, NY. Developer-nominated — personal shopping relationship, consistent review coverage. On-site search URL pattern not yet live-verified. |
| Flatiron Wines & Spirits | ✅ Retailer deep links (Phase 7.3) | Manhattan, NY (also has an SF location — configured domain is the NYC-specific subdomain). Developer-nominated. On-site search URL pattern not yet live-verified. |
| Thatcher's Wine | ✅ Retailer deep links (Phase 7.3) | Brentwood, Los Angeles — not tri-state, included for review coverage only. Developer-nominated. On-site search URL pattern not yet live-verified. |
| JJ Buckley Fine Wines | ✅ Retailer deep links (Phase 9.1, added 2026-08-02) | Oakland, CA — not tri-state, included for review coverage only. User-reported coverage gap: carried real attributed reviews all along but was never in the configured retailer list, so automated sourcing produced an empty result indistinguishable from "searched and found nothing." Config-driven fix — see `docs/CLAUDE.md` §5. |
| Burgundy Report | 🔍 Under evaluation | ToS explicitly permits reproduction of tasting notes for currently available wines with attribution, for active subscribers. Highly relevant for Burgundy focus. Deferred — evaluate after Phase 6.5 is stable. |
| GPT-4o | ✅ In use | Label scanning, tasting note transcription tag extraction, review extraction (critic scores, drinking window, vintage character, value signal — Phase 7–8). OpenAI API key BYOK, stored in iOS Keychain. |
| SensorPush | ✅ In use | Environment monitoring. Cloud API (OAuth, REST). Credentials stored in iOS Keychain. |

### Reference Projects

**the-broke-sommeliers/wine-cellar** (github.com/the-broke-sommeliers/wine-cellar)
Decision: reference only, do not fork.
Django self-hosted web app. No iOS native layer, no BYOK integrations, no Reddit or LLM layer, no drinking window logic, no paid subscription support. Useful only as a reference for basic data modelling patterns.

---

## 7. Tasting Framework

**Framework:** WSET (Wine & Spirit Education Trust) — fixed in v1, configurable in future versions.

Structured tasting note fields:
- **Appearance:** clarity, intensity, colour
- **Nose:** condition, intensity, aroma characteristics (primary fruit, secondary, tertiary)
- **Palate:** sweetness, acidity, tannin (reds only), body, flavour intensity, finish
- **Conclusions:** quality assessment (flawed / poor / acceptable / good / very good / outstanding)
- **My rating:** `poor` / `acceptable` / `good` / `very_good` / `outstanding` (aligns with WSET quality scale)
- **Free text:** open notes field

Tags are extracted from completed notes and attached to the wine entry for cross-app search and display.

### Aroma Tooltip Content

Tooltips are shown on the nose and palate aroma fields only (primary, secondary, tertiary). Each tooltip reveals a curated list of example descriptors to help the user identify and articulate what they are sensing. Tooltips are triggered by a info icon adjacent to the field label — they do not interrupt the form flow.

**Primary aromas** (fruit-derived, from the grape itself):
- *Red fruit:* raspberry, strawberry, red cherry, cranberry, redcurrant
- *Black fruit:* blackcurrant, blackberry, black cherry, blueberry, plum
- *Stone fruit:* peach, apricot, nectarine, cherry, plum
- *Tropical fruit:* pineapple, mango, passion fruit, lychee, banana
- *Citrus fruit:* lemon, lime, grapefruit, orange zest
- *Floral:* rose, violet, jasmine, orange blossom, elderflower
- *Herbaceous:* green pepper, grass, tomato leaf, eucalyptus, mint
- *Spice (primary):* black pepper, white pepper, liquorice

**Secondary aromas** (from fermentation):
- *Yeast-derived:* bread, brioche, biscuit, pastry, cream
- *Malolactic:* butter, cream, crème fraîche, yoghurt
- *Other fermentation:* beer, cider, cheese rind, nail polish (fault indicator)

**Tertiary aromas** (from ageing — oak and/or bottle):
- *Oak-derived:* vanilla, clove, coconut, cedar, sandalwood, smoke, toast, coffee, chocolate
- *Oxidative:* almond, hazelnut, walnut, marzipan, toffee, caramel, dried fruit
- *Bottle age (red):* leather, tobacco, forest floor, mushroom, truffle, game, earth, dried herbs
- *Bottle age (white):* petrol, honey, ginger, toast, nutty, waxy, lanolin

---

## 8. Open Questions

### Resolved
- ✅ App name: TBD when ready to decide
- ✅ Platform: iOS primary, web parity follows
- ✅ v1 scope: single user, developer supplies all keys
- ✅ Web research trigger: iOS share sheet in v1; browser extension is future
- ✅ Consumed wines: same wine entry object, status flag (`discovered` → `wishlist` → `cellar` → `consumed`) — **superseded by tag model below**
- ✅ List tag model: `status` enum replaced with four boolean tags (`tag_discovered`, `tag_wishlist`, `tag_cellar`, `tag_consumed`). Tags are additive — a wine can appear in multiple lists simultaneously. `tag_consumed` set automatically on first tasting note save. No lifecycle progression required. **Amended Phase 9.4 (2026-08-19):** `tag_discovered` is no longer set on creation — see the draft/promote decision below.
- ✅ Tasting Notes list: system-derived, shows all wines where `latest_tasting_note_id` is not null, sorted by most recent note date. Not a user-managed tag.
- ✅ Evaluate CTA: available from any list view and from the creation confirmation screen. No status gate.
- ✅ Tag review prompt: replaces "move to consumed" — after saving a tasting note, user is prompted to review and update their tags.
- ✅ `cellar_quantity` added: integer field, adjustable from the cellar list view.
- ✅ Label scanning: GPT-4o vision, high detail mode, max 1024px resize before API call
- ✅ Paid subscription APIs at launch: Burghound and Vinous BYOK — **superseded.** Confirmed no API available to individual subscribers. Both publications gate programmatic access behind enterprise/trade arrangements. Professional reviews accessed via retailer deep links instead (Phase 6.5).
- ✅ Environment monitoring hardware: SensorPush + G1 WiFi Gateway
- ✅ CellarTracker scraping: prohibited by ToS; personal export is the only legitimate path
- ✅ WineBerserkers: prohibited by ToS; not pursuing
- ✅ Reddit API: viable on free tier for per-bottle queries — **superseded 2026-07-28.** Self-service registration closed under Reddit's Responsible Builder Policy; see Section 6 and "Remaining" below. Community-sentiment layer retired in favor of extending professional review extraction (Phase 8); a YouTube-based alternative is a separate, optional PoC (Phase 8.5).
- ✅ LLM architecture: GPT-4o BYOK, iOS Keychain — **updated 2026-07-28:** covers label scanning, tag extraction, and review extraction (Phase 7–8); no longer includes Reddit synthesis or a raw-excerpt fallback.
- ✅ Data source architecture: additive layer model — each source distinct, not blended
- ✅ WSET framework: fixed at launch
- ✅ The Broke Sommeliers project: reference only, not forking
- ✅ Agentic development toolchain: Claude.ai Projects for planning; Claude Code for filesystem execution; this markdown as shared context. **Amended 2026-08-25 (Phase 10):** extended to include Claude's Design skill (a Claude.ai Artifact-published canvas) for UI/UX design, replacing the originally-planned Magic Patterns step, which was never actually used. The toolchain is deliberately all-Claude — no Cursor, no Magic Patterns, no other external design/build tool — introducing one needs an explicit decision recorded here first. Part of this project's purpose is learning to use Claude well across a full build, not only shipping the app.
- ✅ Wine entry field taxonomy: Tier 1 (canonical, expected on every bottle) and Tier 2 (LLM-enriched, nullable, rule-guided) split defined in Section 3
- ✅ `appellation` renamed to `denomination` to correctly cover AOC/AOP (France), DOC/DOCG (Italy), DO/DOCa (Spain), AVA (USA) without privileging French terminology
- ✅ `quality_classification` added as Tier 2 field: Premier Cru, Grand Cru, Riserva, Reserva, Gran Reserva, Classico, etc.
- ✅ `vineyard` added as Tier 2 field: extracted via quotation marks and known prefixes (Viña, Vina, Vigna, Vigneto, Clos, Les); falls back to null or overflows into `cuvee`
- ✅ `name` field removed: wine identity is expressed as the combination of `producer` + `denomination` + `vintage`, supplemented by Tier 2 fields (`quality_classification`, `vineyard`, `cuvee`). These are the first display fields in the UI.
- ✅ `cuvee` added as Tier 2 field: proper commercial name distinct from denomination/vineyard (e.g. Cristal, Belle Époque, Opus One); also serves as overflow for uncategorised label text
- ✅ `grape_varieties` moved to Tier 2: extracted from label if present; inferred from denomination for well-known appellations; null for obscure or ambiguous denominations
- ✅ Wine identity matching (Phase 9.1, 2026-08-04): a single graded matcher (`scoreMatch`, `shared/utils/wine-match.ts`) judges producer/denomination/bottling/vintage everywhere identity is evaluated, replacing three independently-drifted implicit definitions. Full record in `docs/build-phases.md` Phase 9.1.
- ✅ Serper cost control (Phase 9.2, 2026-08-12): per-wine spend brought down via retailer-search tiering, freshness TTLs with in-flight coalescing, negative-probe memory, and on-click fallback-URL resolution — without narrowing retailer coverage. Calibration against real numbers (WI-7) landed 2026-08-15 — see `docs/build-phases.md` Phase 9.2.
- ✅ Discovery review screen priority (Phase 9.3, 2026-08-16): reviews first, then a preferred-retailer carry-check, then price, then an explicit wishlist/cellar decision — replacing a screen that auto-fetched only price, asked for an unused `cellar_category`, showed a label image that was never persisted, and (for manually-added wines) didn't exist at all. See `docs/specs/2026-08-16-phase-9.3-discovery-review-ui.md`. **Timing superseded by Phase 9.4** — see below.
- ✅ Scan-first enrichment and the draft/promote decision (Phase 9.4, 2026-08-19): reviews are fetched automatically the moment label parsing returns, bounded to the `primary` retailer tier, so review context is on screen *before* the keep/discard decision rather than after it; the deeper escalation ladder stays behind a click. A scanned wine is persisted immediately but stays a **draft** (`promoted_at IS NULL`) — invisible to every list — until the user selects at least one list tag and presses **Save to Collection**. `tag_discovered` stops being automatic. Abandoned drafts are swept after 24 hours; `DELETE /api/wines/:id` gives an explicit discard. See `docs/specs/2026-08-19-phase-9.4-scan-first-enrichment.md`.
- ✅ Delete/discard action (Phase 9.4, 2026-08-19): yes, wanted, and made mandatory by the draft model — a row now exists before the user has decided anything, so there has to be a way to remove it. `DELETE /api/wines/:id` refuses when the wine has tasting notes rather than cascading them away.
- ✅ Serper billing reality (Phase 9.4, 2026-08-19): the free allowance was one-time, not monthly, and is spent. On the first $50 / 50,000-credit pack, which will expire largely unused at current volume — so per-scan Serper thrift is not where the money is. See Section 6's Serper.dev row.
- ✅ Cellar-organisation feature / `cellar_category` (resolved 2026-09-03): not reintroduced as a standalone field. The need is served by a Cellar tab drinking-window filter (ready to drink / needs more time / no window identified) instead, using that feature's own terminology — not yet built (Phase 11), but the decision itself is settled. `cellar_category` stays reserved and unused.
- ✅ Community sentiment via YouTube (Phase 8.5, descoped 2026-09-03): confirmed closed, not merely paused — no reliable data source was found (Reddit retired 2026-07-28; the YouTube PoC was scoped but never run). `community_sentiment`/`community_excerpts` stay reserved, unpopulated columns with no active plan to fill them.
- ✅ Phase 10.5 backend/frontend gap closure (2026-09-03): `include_drafts` route bug fixed, `wine_color` and `cellar_capacity` (`app_settings`) added, cross-tab search (`q` param) shipped, plus the corresponding frontend (search box, `CellarStats.tsx`, Discovered-tab quick tag chips, three-state retailer links). Full detail in `docs/build-phases.md` Phase 10.5; documentation catch-up in Phase 10.6.

### Remaining
- [ ] App name
- [ ] Price crawl retailer coverage: verify K&L NYC store coordinates and confirm all configured retailers (twelve as of Phase 9.1) have searchable product pages for Burgundy, Barolo, and Rioja
- [ ] On-site search URL patterns for several Phase 7.3/9.1 retailers (Sokolin, Acker, Wine Library, Morrell, Crush, Flatiron, Thatcher's, JJ Buckley) are unverified — currently fall through to a generic guess. Live-check with Puppeteer before trusting search-button click-throughs against them.
- [ ] GPT-4o Mini evaluation: test against GPT-4o for label scanning once feature is built; potential 75% cost reduction for clean labels
- [ ] Burgundy Report integration: ToS permits note reproduction for active subscribers with attribution. Evaluate as a future data layer after Phase 6.6 is stable.
- [ ] Drinking-window reasoning/rationale text: considered for Phase 8, tabled 2026-07-28 as too prose-like to extract reliably as a structured fact. Revisit only if a structured (non-prose) capture method is found.
- [ ] Whether the scanned label image should actually be persisted (currently discarded at every creation path) — raised by Phase 9.3's review; the visual-first principle (Section 5) assumes it is, but the shipped code never has been.
