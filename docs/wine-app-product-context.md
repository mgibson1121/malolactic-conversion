# Wine App — Product Context
> Status: In progress | Last updated: 2026-05-16
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
| `name` | String | Scan / manual | Wine name as labelled. With Tier 2 fields split out, this should be the clean commercial label name without appended vineyard or classification text. |
| `producer` | String | Scan / GPT-4o | Producer / domaine |
| `vintage` | Year | Scan / manual | Null if NV |
| `region` | String | Scan / GPT-4o | Broad geographic region. e.g. Burgundy, Piedmont, Rioja |
| `denomination` | String | Scan / GPT-4o | The controlled designation of origin for the wine, regardless of country-specific naming convention. Maps to AOC/AOP (France), DOC/DOCG (Italy), DO/DOCa (Spain), AVA (USA). e.g. Volnay, Barolo, Rioja DOCa, Chablis |
| `grape_varieties` | Array | Scan / GPT-4o | |
| `label_image` | URL | Scan | Resized to max 1024px before storage |
| `status` | Enum | User action | See status lifecycle below |
| `cellar_category` | Enum | User / inferred | `table`, `near_term`, `long_term` |
| `drinking_window_start` | Date | Data sources | Cached/derived value. Overwritten when new review data arrives. Never manually set. |
| `drinking_window_end` | Date | Data sources | Cached/derived value. Overwritten when new review data arrives. Never manually set. |
| `vintage_rating` | Enum | Data sources | `below_avg`, `avg`, `good`, `very_good` for this region+year |
| `expert_reviews` | Array | Paid subscription APIs | Burghound, Vinous; null if not configured |
| `community_sentiment` | String | Reddit + LLM | GPT-4o synthesis of Reddit data; null if no OpenAI key configured |
| `community_excerpts` | Array | Reddit API | Raw Reddit excerpts; shown as fallback if no LLM key configured |
| `price_data` | Object | Wine-Searcher API | Min/avg/max price, retailer list; null if not configured |
| `my_rating` | Enum | User | `pass`, `ok`, `good`, `great` |
| `my_tasting_notes` | Object | User | Structured WSET tags + free text |
| `my_tags` | Array | User / inferred | Searchable tags derived from tasting notes via GPT-4o tag extraction. Treated as a derived field once a tasting note exists — not manually authored. Must stay consistent with tags on the `tasting_notes` sheet; do not allow the two to diverge. |
| `tasting_note_id` | UUID | System | Foreign key to the `tasting_notes` sheet/table. Null until a tasting note is recorded. Used by the UI to show the Evaluate CTA (null) or a tasting note summary badge (populated). |
| `advice_linked` | Array | User | UUIDs of advice entries attached to this wine. Foreign keys to the `advice` sheet. |
| `wishlist_notes` | String | User | Why I want this |
| `price_paid` | Float | User | |
| `purchased_from` | String | User | Retailer name |
| `date_added` | Timestamp | System | |
| `date_consumed` | Timestamp | User | Populated when status → consumed |

#### Tier 2 — LLM-enriched

These fields are populated by the label scan module using rule-guided extraction. Each has defined fallback behaviour. A field left null is always preferable to a hallucinated value.

| Field | Type | Source | Extraction rules | Fallback |
|---|---|---|---|---|
| `quality_classification` | String | Scan / GPT-4o | Quality or aging tier designation. Extract if label contains: Premier Cru, Grand Cru, 1er Cru, Riserva, Reserva, Gran Reserva, Superiore, Classico, Cru Bourgeois, or equivalent. | Null if no recognised designation found. Never infer from context. |
| `vineyard` | String | Scan / GPT-4o | Specific vineyard or lieu-dit within the denomination. Extract if: (1) text appears in quotation marks on the front label and is not the producer or wine name; (2) text is preceded by a known vineyard prefix: Viña, Vina, Vigna, Vigneto, Clos, Les. If label text remains uncategorised after all Tier 1 and other Tier 2 fields are extracted, attempt to classify it as a vineyard; if confidence is low, append to `name` instead. | Null if no text triggers the above rules. Do not guess. If appending to `name`, do so cleanly — no duplicate text. |

### Status Lifecycle

```
discovered → wishlist → cellar → consumed
```

- `discovered`: Seen or logged in the wild, not yet on wishlist
- `wishlist`: Flagged for future purchase
- `cellar`: Purchased and in physical possession
- `consumed`: Drunk; entry is archived but retained for review history and learning

A wine entry can be promoted forward through the lifecycle. It should never need to be recreated.

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

- Quick-log flow: take a photo → tap pass / ok / good → done. No further input required in the moment.
- End-of-night digest: user initiates (or is prompted) to review all `good`-tagged captures from the session. App auto-populates wine entry fields from label scan via GPT-4o. User confirms or adjusts.
- Conversation capture: dedicated input for logging tips and advice. Records the tip, who gave it (role: sommelier / friend / etc.), category (producer, technique, value, region), and optionally links to a wine entry.
- Batch processing: a single digest action updates wishlist, creates wine entries, and files advice — replacing the manual spreadsheet workflow.

**Gain Creators**

- Raw inputs (photos, voice notes, typed tips) are aggregated into a structured session digest, updating multiple repositories in one action.
- Producer and region patterns from the user's own tasting history are surfaced automatically — no manual memorisation required.
- Bottle images are displayed prominently throughout the app so visual memory is reinforced passively.

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

**Gains**

| Gain | Score | Description |
|---|---|---|
| A consistent, trusted voice guiding decisions | 3 | Retailer bias and inflated scores stop reaching me |
| Instant triage — investigate or move on | 2 | Within seconds of seeing a bottle, I know if it's worth considering |
| Paywalled spend pays itself back | 2 | I can measure the ROI of subscriptions against bottles I rated good or above |

**Pain Relievers**

- Scan or photograph a label → app returns a populated wine entry card: name, producer, vintage, region, trusted reviews, community excerpts or synthesis, vintage rating.
- Reviewer trust list: user maintains a list of sources they trust and distrust. App surfaces trusted sources first; mistrusted sources flagged, not hidden.
- Vintage intelligence: for each bottle, a summary of professional and community consensus on vintage quality and approachability.
- In-store trigger: camera scan. Web trigger: iOS share sheet (v1), browser extension (future).

**Gain Creators**

- All configured data sources are displayed as distinct layers on the wine entry card — each source speaks in its own voice. The more sources configured, the more complete the picture.
- Successful recommendations (bottles rated `good` or above) are tracked to quantify ROI of paid subscriptions.

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
- Reviews link automatically to the wine entry — no separate spreadsheet required.

**Gain Creators**

- Tasting note characteristics are extracted as structured tags (body, finish, primary/secondary/tertiary aromas). Tags are reused across the app so a wine can be understood at a glance without reading the full note.
- Written or voice notes can be uploaded and transcribed; tags extracted automatically via GPT-4o.
- Tags build a personal flavour vocabulary over time that informs recommendations and learning.

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

- Mark a bottle as consumed directly from the collection view; attach a quick rating and optional note.
- Environment monitoring via SensorPush integration: temperature and humidity readings pulled from SensorPush Cloud API and displayed in-app.

**Gain Creators**

- Collection visualisation: all bottles, filterable and groupable by red/white, region, style, drinking window, cellar category.
- Allocation drift view: user defines a target distribution (e.g. 30% Burgundy, 20% Rioja, 20% table wine). App shows actual vs. target — modelled on a managed investment account drift report.
- Drinking window view: bottles currently in window are surfaced prominently. Drinking windows derived from configured data sources and updated as new reviews are published.
- Capacity indicator: current bottle count vs. total capacity shown as a fraction and visual.

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

- Price comparison via Wine-Searcher API: top retailers sorted by price, with location filtering.
- Shipping policy surfaced inline alongside price — no need to navigate to checkout.
- Drinking window and vintage rating shown on the purchase decision screen.
- Prior ratings of similar wines from the same producer surfaced as a risk signal.

**Gain Creators**

- Shipping confidence indicator: retailer shipping policies (where publicly available) summarised alongside price comparison.
- Collection fit summary: cellar category the bottle would fall into, how many bottles from the same producer and vintage are already held, and how the purchase would affect allocation drift.
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
| Tap all professional and community opinion on a vintage | 4 | Confident drink-or-hold decisions |
| New reviews are integrated as they are published | 4 | Knowledge is never stale |
| Build a mental map that sticks | 4 | Wine feels like a language I speak, not translate |
| Understand good vs. bad years by region | 4 | Vintage context informs every decision |

**Gain Creators**

- Pattern quiz: flashcard-style quizzes testing producer-to-region associations, label recognition, village tasting note characteristics, and good/bad vintage years.
- Visual memory: label images, regional maps, and bottle photos used throughout the app to reinforce visual pattern recognition passively.
- Vintage index: each region has a year-by-year quality rating (`below_avg` → `very_good`) derived from configured data sources. Visible in cellar, on wine entries, and in purchase decisions.
- Advice archive: all tips captured from sommeliers and dining companions, searchable and categorised (producer, technique, region, value). Linked to wine entries where relevant.
- Live-updating knowledge: wine entries, drinking windows, and vintage ratings are refreshed as new reviews are published. The wishlist and cellar are never static.

---

## 5. Cross-Cutting Principles

These apply everywhere in the app. An agent building any feature should check these before making design or implementation decisions.

**Wine entry fields are tiered by extraction reliability.** Tier 1 fields (canonical) are expected on every bottle and must always be populated — surface a manual entry prompt if a scan misses one. Tier 2 fields (LLM-enriched) are nullable by design and follow explicit extraction rules defined in Section 3. A null Tier 2 field is always preferable to a hallucinated value. This distinction governs how the label scan prompt is constructed and how missing values are handled throughout the app.

**Visual first.** The app should use images of bottles, labels, and regional maps wherever possible. Wine is a visual and associative domain. Text-only interfaces miss the point.

**The wine entry is the atom.** Every screen either creates, enriches, reads, or changes the status of a wine entry. There is no feature that does not connect to one.

**Trusted reviewer system.** The user maintains a personal list of sources they trust and distrust. This list influences every review surface in the app. It is configurable and persistent. No review is shown without attribution to its source.

**Live-updating data.** Drinking windows, vintage ratings, and community scores are not static values set at the time of entry. They are recalculated as new reviews are published. The app should reflect the current state of knowledge, not the state at the time of purchase.

**Capture is low-friction above all else.** Any capture interaction that requires more than two taps or ten seconds in the moment has failed. Enrichment can happen later.

**Status is a lifecycle, not a category.** A wine moves from discovered → wishlist → cellar → consumed. This progression should be the primary navigation metaphor for managing a collection.

**Cellar allocation is intentional.** The user has a mental model of what their ideal collection looks like. The app should surface drift from that model, not just report inventory.

**Social context matters for capture.** Notes and ratings taken at a table or in a shop should feel invisible to companions. Speed and discretion are product requirements, not nice-to-haves.

**Information is additive by layer.** Each configured data source adds a distinct type of information to a wine entry. Sources are never blended or synthesised against each other — each speaks in its own voice. A user with more sources configured gets a more complete picture, not a different one.

**All credentials are local.** No API key, subscription credential, or user-supplied secret is ever transmitted to or stored on the app's servers. All credentials live in iOS Keychain on device.

---

## 6. Data Sources & Architecture

### The Additive Layer Model

Three independent layers. Each unlocks a distinct type of information. Configure more layers, get a more complete picture.

| Layer | Source | What it adds | Access model |
|---|---|---|---|
| **Expert opinion** | Burghound, Vinous | Professional tasting notes, scores, drinking windows | BYOK — user supplies subscription credentials; stored in iOS Keychain |
| **Community opinion** | Reddit API + GPT-4o | Synthesised community sentiment, vintage anecdotes, drinking window consensus | Reddit free tier (100 QPM OAuth); GPT-4o key BYOK for synthesis; raw excerpts shown as fallback |
| **Price & availability** | Wine-Searcher API | Retailer pricing, local availability, min/avg/max market price | Paid API — confirm 500 calls/day tier before committing |

### Label Scanning

**Model:** GPT-4o vision (high detail mode)
**Input:** Image file resized to max 1024px on longest side before API call. Never send raw input. In Phase 3 this arrives via web file upload; in Phase 10 it arrives from the native iOS SwiftUI camera. The module handles both identically.
**Output:** Structured JSON covering all Tier 1 and Tier 2 wine entry fields. Tier 1 fields (producer, name, vintage, region, denomination, grape varieties) are expected on every scan. Tier 2 fields (quality_classification, vineyard) are nullable — omit rather than hallucinate. See Section 3 for field-level extraction rules.
**Phase 3 capture surface:** Web file upload (HTML file input, image/*) — validates the pipeline without requiring a native app.
**Phase 10 capture surface:** Native iOS SwiftUI camera (AVFoundation) — replaces file upload as the production capture surface. Backend module unchanged.
**Cost:** ~$0.004 per scan at 1024×1024 (765 image tokens + prompt + output at $2.50/1M input, $10.00/1M output)
**Key:** User-supplied OpenAI API key, stored in iOS Keychain
**Future optimisation:** Test GPT-4o Mini ($0.60/1M input) once feature is stable — potential 75% cost saving for clean labels

### LLM Layer (Reddit Synthesis)

**Model:** GPT-4o
**Purpose:** Synthesise unstructured Reddit posts and comments into structured drinking window signals and community sentiment summaries for a specific wine and vintage
**Key management:** BYOK. OpenAI API key stored in iOS Keychain, never on server
**Fallback:** If no key configured, raw Reddit excerpts are displayed. Feature degrades gracefully, never disappears entirely
**v1:** Developer supplies their own key

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
| Reddit | ✅ In use | Official API, free tier, 100 QPM via OAuth 2.0. Sufficient for per-bottle queries at personal usage scale. Key subreddits: r/wine, r/burgundy, r/winetasting, r/barolo, r/wineenthusiast. |
| Wine-Searcher | ✅ In use | Official RESTful API. Returns pricing, retailer availability, aggregated critic scores. Tasting notes excluded (copyright). Paid — confirm tier before building. |
| Vivino | Not pursuing | No public API. Partnership not worth pursuing. Label scanning replaced by GPT-4o vision. |
| Burghound | ✅ BYOK — v1 priority | Paywalled professional reviews, highly trusted for Burgundy. User supplies own active subscription credentials. |
| Vinous | ✅ BYOK — v1 priority | Paywalled professional reviews (Antonio Galloni). User supplies own active subscription credentials. |
| GPT-4o | ✅ In use | Label scanning, tasting note transcription tag extraction, Reddit synthesis. OpenAI API key BYOK, stored in iOS Keychain. |
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
- **My rating:** `pass` / `ok` / `good` / `great` (separate from WSET quality scale)
- **Free text:** open notes field

Tags are extracted from completed notes and attached to the wine entry for cross-app search and display.

---

## 8. Open Questions

### Resolved
- ✅ App name: TBD when ready to decide
- ✅ Platform: iOS primary, web parity follows
- ✅ v1 scope: single user, developer supplies all keys
- ✅ Web research trigger: iOS share sheet in v1; browser extension is future
- ✅ Consumed wines: same wine entry object, status flag (`discovered` → `wishlist` → `cellar` → `consumed`)
- ✅ Label scanning: GPT-4o vision, high detail mode, max 1024px resize before API call
- ✅ Paid subscription APIs at launch: Burghound and Vinous (BYOK)
- ✅ Environment monitoring hardware: SensorPush + G1 WiFi Gateway
- ✅ CellarTracker scraping: prohibited by ToS; personal export is the only legitimate path
- ✅ WineBerserkers: prohibited by ToS; not pursuing
- ✅ Reddit API: viable on free tier for per-bottle queries
- ✅ LLM architecture: GPT-4o BYOK, iOS Keychain, raw Reddit excerpt fallback
- ✅ Data source architecture: additive layer model — each source distinct, not blended
- ✅ WSET framework: fixed at launch
- ✅ The Broke Sommeliers project: reference only, not forking
- ✅ Agentic development toolchain: Claude.ai Projects for planning; Claude Code for filesystem execution; this markdown as shared context
- ✅ Wine entry field taxonomy: Tier 1 (canonical, expected on every bottle) and Tier 2 (LLM-enriched, nullable, rule-guided) split defined in Section 3
- ✅ `appellation` renamed to `denomination` to correctly cover AOC/AOP (France), DOC/DOCG (Italy), DO/DOCa (Spain), AVA (USA) without privileging French terminology
- ✅ `quality_classification` added as Tier 2 field: Premier Cru, Grand Cru, Riserva, Reserva, Gran Reserva, Classico, etc.
- ✅ `vineyard` added as Tier 2 field: extracted via quotation marks and known prefixes (Viña, Vina, Vigna, Vigneto, Clos, Les); falls back to null or appends to `name`

### Remaining
- [ ] App name
- [ ] Wine-Searcher API tier: confirm 500 calls/day ($250/month) is sufficient before committing; consider starting on trial (100 free calls/day) to validate usage patterns
- [ ] GPT-4o Mini evaluation: test against GPT-4o for label scanning once feature is built; potential 75% cost reduction for clean labels
- [ ] Burghound and Vinous BYOK integration specifics: confirm credential format (API key vs. username/password) and data schema for each before building the integration flow
