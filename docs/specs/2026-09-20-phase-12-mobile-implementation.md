# Phase 12 — Mobile implementation spec

> Companion to `phase-12-mobile-ios-spec.md` (product scope). This document is
> the build contract: every state, every truncation, every collapsed/expanded
> transition, with exact copy. Written to be handed to Claude Code.
> v1 — 2026-09-20. Landed alongside `docs/build-phases.md` Phase 12 the same day.
>
> **Grounding rule:** every string quoted as "existing copy" below is lifted
> verbatim from the shipped web app. Where this doc introduces new copy it is
> marked **[new]**. Do not paraphrase either kind — copy drift between the two
> clients is a real maintenance cost on a single-developer project.

---

## 1. Foundations

### 1.1 Geometry

| Token | Value | Notes |
|---|---|---|
| Design width | 402 pt | iPhone 17 Pro. Must survive 393 (17) and 440 (17 Pro Max). |
| Side margin | 16 pt | Every screen. Never pinned to a percentage. |
| Card gap | 12 pt (widgets), 10 pt (list rows) | |
| Card radius | 14 pt | Matches web `--radius` usage on `.wine-card` / `.cellar-stat-tile`. |
| Control radius | 10 pt buttons, 8 pt fields | |
| Min hit target | 44 × 44 pt | Including the quantity ± buttons and the score badge. |
| Tab bar | 49 pt + 34 pt safe area | |
| Scan button | 56 pt circle, −18 pt offset, 3 pt surface ring | |
| Dynamic Island clearance | Top safe area only; no content under 54 pt | |

### 1.2 Type ramp

Domine (display) / Work Sans (body), both already licensed in the web app.

| Role | Font | Size / weight | Used on |
|---|---|---|---|
| Large title | Domine | 32 / 700 | Nav large title |
| Inline title | Domine | 17 / 600 | Collapsed nav bar |
| Card title | Domine | 15.5 / 600 | Wine name on a card |
| Detail title | Domine | 19 / 600 | Wine name on detail |
| Section label | Work Sans | 11 / 700, uppercase, 0.06 em | Widget + section headers |
| Body | Work Sans | 13.5 / 400 | Notes, descriptions |
| Meta | Work Sans | 12.5 / 400, muted | Vintage · region, dates |
| Numeral | Work Sans | tabular-nums always | Counts, prices, scores, years |
| Badge | Work Sans | 10–11 / 600-700 | Pills |

Dynamic Type: support up to **xxLarge**. Above that, line-3 badge rows wrap to
two lines and the card height budget is abandoned rather than the text shrunk.
Never scale below the system size.

### 1.3 Tokens

Light set is Phase 11.1's, unchanged. The dark set is **[new]** — same hues,
inverted lightness, for the dim-cellar/restaurant context.

| Token | Light | Dark |
|---|---|---|
| `bg` | `#FBF7F1` | `#191413` |
| `surface` | `#FFFFFF` | `#241C1A` |
| `surface-2` | `#F4ECE2` | `#312624` |
| `line` | `#E6DACB` | `#403230` |
| `text` | `#241C1A` | `#F5EDE5` |
| `text-muted` | `#6E6059` | `#A5948B` |
| `accent` | `#7A2333` | `#C4566A` |
| `accent-soft` | `#F3DFE2` | `#3A1F25` |
| `accent-2` | `#B08A3E` | `#D6AC5C` |
| `accent-2-soft` | `#F1E7D2` | `#372D1B` |
| `green` / `green-soft` | `#3F6B4C` / `#E1EBE3` | `#7FB08E` / `#1E2E23` |
| `red-pill` / `red-soft` | `#B3261E` / `#FBE5E3` | `#E5716A` / `#331C1B` |
| wine colours | `#7A2333` / `#C9A227` / `#B5687F` | unchanged — they encode real wine colour |

Follow the system appearance. No in-app theme switch in v1.

---

## 2. Component inventory

| SwiftUI view | Web counterpart | Owns |
|---|---|---|
| `RootTabView` | `App.tsx` nav | 5 tabs, scan modal presentation |
| `CellarDashboardView` | `App.tsx` + `CellarStats.tsx` | Widgets + embedded list |
| `WineListView` | `WineList.tsx` | List, search, filters, empty/error |
| `WineRowView` | `WineCard.tsx` | The compressed card + swipe actions |
| `WineDetailView` | `WineDetailModal.tsx` | Pushed detail, disclosure groups |
| `ScanFlowView` | `LabelScanFlow.tsx` | 6-state capture machine |
| `DraftReviewView` | `DiscoveryReview.tsx` | Draft/promoted modes |
| `EvaluateFormView` | `EvaluateForm.tsx` | WSET form |
| `PriceTableView` | `PriceSection.tsx` | Retailer table, collapsed by default |
| `CriticScoresView` | `CriticScoreBadges.tsx` | Full score list |
| `RetailerLinksView` | `RetailerLinksSection.tsx` | Search/save/confirm |
| `FreshnessLabel` | `EnrichmentFreshness.tsx` | Cache age + refresh-anyway |

One rule for all of them: **a view never renders a field the API returned as
`nil`.** No dashes, no "—" placeholders, no empty rows. The layout collapses.
The only exception is `PriceSection`'s min/avg/max triple, which keeps its
existing `—` for a null bound because the three read as a set.

---

## 3. Universal state model

Every data-bearing view is in exactly one of six states. Build them as an
enum, not as a pile of booleans — the web app's `loading`/`error`/data triple
already produces ambiguous combinations and should not be ported as-is.

```
enum LoadState<T> { idle, loading, loaded(T), empty, failed(Error), stale(T, Error) }
```

| State | Trigger | Treatment |
|---|---|---|
| `idle` | Never requested | Nothing rendered; no spinner |
| `loading` | First request in flight | Skeleton, not a spinner — see §3.1 |
| `loaded` | Data, non-empty | Normal |
| `empty` | 200 OK, zero rows | Empty state — see §5 |
| `failed` | Request failed, nothing cached | Error state — see §4 |
| `stale` | Request failed, previous data cached | **Render the cached data** + a non-blocking banner. Never blank a populated screen because a refresh failed. |

### 3.1 Skeletons

Lists show **3 skeleton rows** at the real card height (104 pt), `surface-2`
blocks at 60% / 40% / 80% width for the three lines, 1.2 s shimmer. Widgets
show a single skeleton block at their own height. Never a full-screen spinner
— the tab bar and nav title must stay live.

Scan is the one exception: it is a modal task with an unknown 10–30 s duration
and gets the pulsing thumbnail treatment (§6.3), not a skeleton.

---

## 4. Error states

### 4.1 Taxonomy

| Class | Meaning | Presentation |
|---|---|---|
| **Network** | `URLError` — no response at all | Full-state error with retry |
| **Server** | Non-2xx with a body `error` string | Full-state error, show the server's own message |
| **Action** | A single tap failed (tag toggle, quantity, save) | Inline, local to the control |
| **Enrichment** | A metered call failed | Inline under its section; **never** blocks the screen |
| **Validation** | User input rejected | Field-level, red-pill, no alert |
| **Permission** | Camera denied | Alert + fallback path |

### 4.2 Exact copy

The web app already distinguishes "the request never reached the server" from
"the server said no" (`App.tsx`, the `TypeError` branch). Preserve that split.

| Situation | Copy | Source |
|---|---|---|
| List fetch, network-level | `Could not load wines — is the backend running on port 3000?` | existing (`App.tsx`) |
| List fetch, server responded | *the server's own message*, verbatim | existing |
| Price fetch failed | `Price lookup failed` | existing |
| Review fetch failed | `Review lookup failed` | existing |
| No listings found (200 OK) | `No matching listings found for this wine at the configured retailers.` | existing (`PriceSection`) |
| Retailer links could not be built | `Could not generate retailer links` | existing |
| Saving a retailer URL failed | `Save failed` | existing |
| Removing a saved link failed | `Could not remove saved link` | existing |
| Confirm-and-extract failed | `Could not save and extract from that link` | existing |
| Scan failed | title `Scan Failed`, body `Scan failed: {message}` | existing |
| Non-image picked | `Please select an image file.` | existing |
| Manual save failed | `Failed to save. Is the backend running?` | existing |
| Draft discard blocked (409, has a note) | **[new]** `This wine has a tasting note and can't be discarded. Remove it from your lists instead.` | new — the web app never surfaced the 409 |
| Camera denied | **[new]** title `Camera access is off`, body `Turn it on in Settings to scan labels, or choose a photo from your library.`, buttons `Open Settings` / `Choose photo` | new |
| Offline, cached data present | **[new]** banner: `Offline — showing your last loaded collection.` | new |
| Backend unreachable at launch, no cache | **[new]** `Can't reach the backend at {host}. Check you're on the same network.` + `Change server` button | new (see spec §8 D5) |

**Copy rules.** No exclamation marks. No "Oops" / "Something went wrong" /
"Whoops". Name the thing that failed and the next action. Never show a raw
stack trace, HTTP status code alone, or a JSON blob — `api.ts` already
normalises to `body.error ?? "HTTP {status}"`; show that string.

### 4.3 Placement

- **Full-state** errors replace the content area only. Nav bar and tab bar
  stay interactive. Centred: 28 pt icon (`exclamationmark.triangle`, muted),
  15 pt message, 44 pt `Try again` button below.
- **Banner** (stale/offline) is a 36 pt `surface-2` strip pinned under the nav
  bar, dismissible by swipe, auto-dismissing on the next successful fetch.
- **Inline** errors render in `red-pill` at 12 pt directly beneath the control
  that failed, and clear on the next attempt. An inline error never shifts the
  layout of rows below it by more than its own height.
- **Never an alert** except for camera permission and destructive
  confirmation. iOS alerts interrupt; these failures don't warrant it.

### 4.4 Retry

- `Try again` re-issues the same request. Second consecutive failure of the
  same request adds **[new]** `Still can't reach it.` beneath the button.
- No automatic retry, no exponential backoff, no retry-on-appear for
  **metered** calls (price, reviews, scan). Automatic retry on a paid endpoint
  is a spending bug. Unmetered `GET`s may retry once, silently.
- A failed tag toggle or quantity change **rolls the optimistic update back**
  and shows the inline error. The web app currently leaves the optimistic
  value in place on failure; do not port that.

---

## 5. Empty states

Two kinds, treated differently: **"you have nothing yet"** (offer the action)
vs **"nothing matched"** (offer to clear the filter).

| Location | Condition | Copy | Action |
|---|---|---|---|
| Any list, no filter | zero rows | `No wines here yet.` (existing) | `Scan a label` for Cellar/Discovered; nothing on Notes |
| Any list, search active | zero rows | **[new]** `Nothing in {tab} matches "{query}".` | `Clear search` |
| Notes tab + rating filter | zero rows | **[new]** `No {rating} wines in your notes.` | `Show all ratings` |
| Cellar dashboard | `totalBottles == 0` | **[new]** `Nothing in the cellar yet.` — widgets 1 and 3–6 collapse into this single card | Scan CTA stays visible |
| Capacity widget | `cellar_capacity == nil` | `Set cellar capacity` (existing) | Opens inline editor |
| Ready-to-drink widget | all three counts 0 | Collapse the widget entirely | — |
| By-region widget | zero rows with quantity | Collapse the widget entirely | — |
| Critic scores, detail | `review_data` empty | `No attributed critic scores found yet.` (existing) | `Fetch Reviews` |
| Pricing, detail | `price_data == nil` | `No price data yet.` (existing) | `Fetch Price` |
| Pricing, fetched but nothing | `retailers.isEmpty` | `No matching listings found for this wine at the configured retailers.` + `Checked {date}` (existing) | `Refresh Price` |
| Tasting notes, detail | no notes | `No tasting notes yet.` (existing) | `Evaluate this wine` |
| Drinking window, detail | `drinking_window == nil` and no attributed windows | **omit the section** — do not show an empty state | — |
| Retailer links | none saved | omit the Review Links section (existing behaviour) | — |

An empty state is never accompanied by a skeleton, a spinner, or an
illustration. One line of muted 14 pt text, centred, 40 pt vertical padding,
optional single button.

---

## 6. Screen-by-screen states

### 6.1 Cellar dashboard

| Widget | Loading | Empty | Error | Notes |
|---|---|---|---|---|
| Capacity | skeleton bar | `Set cellar capacity` | keeps last value + banner | Over 100%: bar clamps at 100%, the percentage text goes `red-pill`, **[new]** `Over capacity` pill appears |
| Scan CTA | always live | — | — | Never depends on network |
| Ready to drink | skeleton, 3 tiles | collapse | hidden | Counts derived client-side; a wine with `drinking_window == nil` is "No window" and is never guessed at |
| By region | skeleton, 4 rows | collapse | hidden | See §7.4 for >5 regions |
| Colour split | skeleton bar | collapse | hidden | `unknown` segment uses `text-muted`, always last |
| Recently added | 3 skeleton cards | collapse | hidden | |
| Cellar list | 3 skeleton cards | `No wines here yet.` | full-state error | |

The dashboard makes **one** `GET /api/wines?tag_cellar=true` plus one
`GET /api/settings`. Every widget is derived from that single response. Do not
fire a request per widget.

### 6.2 Lists

Pull-to-refresh re-issues the list `GET` only. It never triggers enrichment.

Search: 300 ms debounce, `q` param, AND-ed with the tab's own filter — same
semantics as web. While a search request is in flight the **previous results
stay on screen dimmed to 50%**; they are not replaced by skeletons. Clearing
the field cancels the in-flight request.

### 6.3 Scan flow

Six states, mirroring `LabelScanFlow.tsx`:

| State | UI | Exit |
|---|---|---|
| `capture` | System camera picker, presented immediately | photo / cancel / `Choose from library` / **[new]** `Enter manually` |
| `resizing` | Instant, no UI | → uploading |
| `scanning` | Captured thumbnail at 40% opacity, pulsing 1.2 s, **[new]** `Reading the label…`; after 15 s append **[new]** `Still going — labels with a lot of text take longer.` | result / error |
| `duplicate` | `{producer · denomination} {vintage or NV} looks like a wine you already have — no search has been run.` (existing) | `Open it` / `Add anyway` |
| `review` | Draft review form (§6.4) | save / discard |
| `error` | `Scan Failed` + `Scan failed: {message}` | `Retake` / `Enter manually` / `Cancel` |

Cancelling from `review` must call `DELETE /api/wines/:id` for the draft. A
draft abandoned by force-quitting is swept server-side after 24 h — already
built, do not re-implement client-side.

### 6.4 Draft review

- **Tier 1 field missing from the scan** → field renders in `accent-2` with
  label suffix `· needs input` and `accent-2-soft` fill. Existing web
  behaviour, ported.
- **Tier 2 field missing** → field present, empty, no highlight, no prompt.
- **`Save to collection` disabled** until at least one of
  Discovered/Wishlist/Cellar is selected. Disabled = 40% opacity, still
  focusable, with **[new]** hint `Pick a list first.`
- **Auto-fired primary-tier reviews** land asynchronously into the Critic
  scores block. Until then that block shows a 2-line skeleton, not a spinner.
  If the tier finds nothing, the block **disappears** — it does not show an
  empty state on a screen the user is mid-task on.
- OpenAI key not configured → scan entry point shows the existing
  unavailable message and routes to manual entry.

---

## 7. Truncation and overflow

This is the section most likely to be got wrong. Each rule states what
truncates, where, and what the recovery is.

### 7.1 The card's three lines — hard contract

The card is **exactly three lines plus a right rail**, never four, at default
Dynamic Type. Card height 96–112 pt. Nothing below wraps.

**Line 1 — `producer · denomination` + count**

- One line, tail truncation, `…` at the end.
- Layout: title takes all remaining width after the bottle count reserves its
  intrinsic width (never compressed; `layoutPriority` higher than the title).
- If `producer` alone exceeds the available width: truncate producer and
  **move `denomination` to line 2**, prefixed before vintage. Line 2 then
  truncates instead.
- If both producer and denomination are `nil`: render `—` (existing web
  fallback).
- Long Burgundy and Barolo names are the normal case. Test against
  `Domaine Comte Georges de Vogüé · Chambolle-Musigny 1er Cru Les Amoureuses`
  (63 chars) and `Giuseppe Rinaldi · Barolo Brunate–Le Coste` at every
  supported width.

**Line 2 — `vintage · region`**

- `vintage == nil` → `NV`, never blank, never `—`.
- Region tail-truncates at the line, target ~18 characters at 402 pt.
- Never truncate the vintage.

**Line 3 — the badge run**

A single horizontal run that **drops items right-to-left** as width runs out.
Priority, highest first:

1. `my_rating` pill
2. critic score badge
3. avg price
4. drinking window

Implementation: measure at layout time, remove the lowest-priority item that
doesn't fit, re-measure, repeat. Do not scale font, do not wrap, do not
ellipsis a badge — badges are dropped whole. A dropped badge is always still
present on detail.

### 7.2 Critic scores

**Card (truncated to one):**

- Pick the **highest numeric score**. Ties → prefer `known_publication == true`.
  Still tied → first in `getDedupedCriticScores` order (dedupe by publication,
  first occurrence wins — reuse the existing util's semantics exactly).
- Render `{score} {abbrev}` — e.g. `96 WA`. Abbreviations come from a
  `CRITIC_KEYWORDS`-derived map: `WA`, `VN`, `BH`, `WS`, `WE`, `DC`, `JS`.
- `known_publication == false` → show the raw attribution truncated to 12
  chars with a trailing `…`, **and** render the badge with a dashed border, so
  an unnormalized source never reads as a vetted one.
- `+N` suffix when `scores.count > 1`, where N = `count - 1`.
- The badge is a 44 pt-tall tap target; tapping opens detail scrolled to the
  Critic Scores section.

**Detail (full, never truncated):**

- Every deduped score, each with its publication, and its Phase 8 attributes
  when present: stated drinking window, `vintage_character`, `deal`.
- More than 6 scores → show 6, then **[new]** `Show all {n} scores`.
- **Never average. Never pick a "winner" as the wine's score.** The card
  picking a highest score is a *display* truncation with a `+N` affordance,
  not source prioritization — Phase 11 explicitly declined to build
  prioritization and this must not become it by the back door.

### 7.3 Retailers table — collapsed / expanded

Default **collapsed**. This is the largest data structure on the screen (up to
11 configured retailers + fallbacks, 8 badge dimensions each).

**Collapsed (default):**

```
Retailers                    Nearest + 2 · 9 total   ⌄
```

Expanding reveals the header stats and the first three rows:

- Stat line: `Min $180 · Avg $215 · Max $260` (existing `fmt`, `$` + 0 dp; a
  null bound renders `—`).
- `other_vintage_price_range` non-nil → **[new]** second line
  `Other vintages $28–$150`, muted. Never merged into the headline figures.
- Nearest retailer row first, always, marked `Nearest`.
- Then 2 more rows, then `Show all {n} retailers`.
- `Updated {date}` (existing) as the last line.

**A retailer row** is two lines, not a table row — a 402 pt screen cannot hold
8 columns:

```
K&L Wine Merchants                    $215   ›
Verified · 2019 vintage · 12 mi
```

Badge line composition and drop order (right to left, same mechanism as §7.1):
`verification` → `vintage` → `format` → `distance` → `link_only`. Rules:

| Badge | Condition | Copy | Style |
|---|---|---|---|
| Verified | `verification == .verified` | `Verified` | `pill-green` |
| Unverified | `.unverified` | `Unverified` | `pill-red` |
| *(none)* | `.unchecked` | render nothing | absence **is** the state — existing convention |
| Vintage match | `matched_vintage != nil`, no mismatch | `{year} vintage` | neutral |
| Vintage mismatch | `vintage_mismatch` | `{year} vintage` | `red-soft` |
| Format | `non_standard_format` | `format_label` (e.g. `6-pack`, `1.5L`) | `accent-2-soft` |
| Search only | `link_only` | `Search only` | neutral, price cell blank |

Never drop the verification badge to fit — it is the one badge whose absence
is meaningful. Drop distance first.

Retailer name truncates at 22 chars, tail. Price never truncates.

### 7.4 By-region widget

- Top 5 regions by bottle count, then `Show all {n} regions`.
- Region label: fixed 96 pt column, one line, tail truncation
  (`Northern Rhône` fits; `Montagne de Reims` truncates to `Montagne de Re…`).
- A region with a single colour renders one full-width segment; segments below
  4% of the bar are floored at 4% so a 1-of-40 bottle is still visible.
- Expanded: a pushed screen, full list, same rows, scrollable, plus a total.

### 7.5 Other truncations

| Field | Rule |
|---|---|
| Tasting-note excerpt (detail) | 200 chars + `…` — existing web rule, keep it |
| Note tags | 6 chips, then `+{n}` — existing |
| Notes count | `{n} more notes` below the latest — existing |
| Grape varieties | Joined `, `; 2 lines max on detail, then `Show more` |
| Free-text on a card | Never shown |
| Search query in an empty-state message | Truncate the echoed query at 24 chars |
| Region names in filter chips | 14 chars |
| Any number | Never truncated or abbreviated. No `1.2k`. `1,240` in full. |

---

## 8. Disclosure groups — exact behaviour

Three on the detail screen: **Research**, **Reviews**, **Retailers**. One
component, three instances.

**Collapsed row** (56 pt): title left, a *summary* right, chevron `⌄`.
The summary is what makes collapsing acceptable — it must carry the headline
fact so the group only needs opening when the user wants detail.

| Group | Summary when populated | Summary when empty | Behaviour when empty |
|---|---|---|---|
| Research | `{n} scores · ${avg} avg` | `Not fetched` | Still expandable — expanding reveals the `Fetch Reviews` / `Fetch Price` buttons |
| Reviews | `{n} notes` | `No notes` | Expanding reveals `Evaluate this wine` |
| Retailers | `Nearest + 2 · {n} total` | `No listings` | Expanding reveals the empty copy + `Refresh Price` |

Rules:

- **Animation:** 0.25 s ease-out height + chevron rotate to `⌃`. No cross-fade.
- **State persists** per wine for the session (an in-memory `Set<wineID>` per
  group), not across launches. Opening a second wine starts collapsed again.
- **Auto-expand** in exactly two cases: arriving via a tap on the card's critic
  score badge (Research opens, scrolled to scores), and a just-completed
  enrichment fetch (the group the result landed in opens once).
- **Never auto-collapse** a group the user opened, including after a refresh.
- Expanding never triggers a network request. The data is already loaded or
  it is not; the buttons inside are the only fetch triggers.
- Content above a group must not shift when it expands — groups sit in a
  vertical stack, and expansion pushes content *down* only.
- VoiceOver: the row is a single button, label `{title}, {summary}`, trait
  `.button`, value `collapsed` / `expanded`.

Always visible, never behind a disclosure: identity, colour, tags, bottle
quantity, drinking window, latest-note excerpt, Evaluate. Those are the
"standing in a cellar with the bottle in your hand" fields.

---

## 9. Enrichment control states

`fetch-price` and `fetch-reviews` are metered. One control, five states:

| State | Label | Enabled |
|---|---|---|
| Never fetched | `Fetch Price` / `Fetch Reviews` | yes |
| In flight | `Fetching…` | no |
| Fetched, fresh (within TTL) | `Refresh Price` + `FreshnessLabel` | yes — hits cache, costs nothing |
| Fetched, stale | `Refresh Price` + `Updated {date}` | yes |
| Failed | previous label + inline `Price lookup failed` | yes |

`FreshnessLabel` keeps the web component's `Refresh anyway` affordance for
forcing past the TTL. Port the copy as-is.

Hard rules, all inherited from `CLAUDE.md` §15 and Phase 9.4:

- No fetch on view appear. No fetch on pull-to-refresh. No fetch on scroll.
- Auto-fire exists in exactly one place: the scan path, `?tier=primary`, once
  per wine, after the free duplicate check (`POST /api/wines/duplicate-check` on
  iOS — see the product spec §6).
- Backgrounding the app cancels nothing already in flight but starts nothing.
- A `force` refresh requires a deliberate second tap.

---

## 10. Gestures

| Gesture | Context | Action | Feedback |
|---|---|---|---|
| Tap card | any list | Push detail | standard highlight |
| Tap score badge | any list | Push detail, Research expanded, scrolled to scores | |
| Swipe left | any list | `Evaluate` (accent-2, full swipe commits) | |
| Swipe right | Cellar | `−1` / `+1` bottle | haptic `.light`; at 0, `−` is disabled not hidden |
| Swipe right | Discovered | `Wishlist` / `Cellar` / `Remove` | |
| Swipe right | Wishlist | `Cellar` / `Remove` | |
| Long press | any list | Context menu: full 4-way tag toggle + `Evaluate` + `Delete` | `Delete` destructive, red, confirm sheet |
| Pull to refresh | any list | Re-`GET` the list only | |

`Remove` clears that list's tag; it never deletes the wine. `Delete` is the
only destructive action and is confirm-gated, and must surface the 409 copy
(§4.2) when the wine has a tasting note.

---

## 11. Accessibility

- Every interactive element ≥ 44 pt, including badges that navigate.
- Contrast: body text 4.5:1 minimum against its own surface in **both**
  themes. The dark-set `accent` was lightened to `#C4566A` for exactly this.
- Colour is never the only carrier: the wine-colour dot has a VoiceOver label
  (`Red wine`), the verification badge carries text not just a tint, and the
  unknown colour is a *hollow* ring, not a grey fill.
- Truncated text exposes its full value to VoiceOver — always set
  `accessibilityLabel` to the untruncated string.
- A card reads as one element: `"{producer} {denomination}, {vintage},
  {region}, {n} bottles, rated {rating}, {score} from {publication}, plus {n}
  more scores"`.
- `Reduce Motion` → disclosure groups snap instead of animating; the scan
  pulse becomes a static dimmed thumbnail.

---

## 12. Performance budgets

| Metric | Budget |
|---|---|
| Cellar dashboard to first paint | < 400 ms from cache, < 1.2 s cold |
| List scroll | 120 fps on ProMotion; no dropped frames at 500 rows |
| Row layout | Precompute the line-3 drop decision once per row, cache by width — do not measure during scroll |
| Scan end-to-end | < 30 s (inherited Phase 3 target) |
| Image upload | ≤ 1024 px longest side, JPEG q 0.8, resized **on device** |

Lists are `LazyVStack` in a `ScrollView` with stable `id: wine.id`. No
pagination in v1 — a personal collection is hundreds, not thousands — but
`listWines` must stay filter-driven server-side, never fetch-all-then-filter.

---

## 13. QA checklist

Every one of these is a state a build must be walked through before the phase
closes:

1. Cellar with 0 bottles / 1 bottle / 148 bottles / over capacity.
2. A wine with a 63-character name at 393, 402 and 440 pt.
3. A wine with 0, 1, 2 and 9 critic scores; one from an unnormalized source.
4. A wine with `drinking_window == nil` but 3 disagreeing attributed windows.
5. A wine with `price_data` present but `retailers` empty.
6. A retailer row that is simultaneously `link_only`, mismatched-vintage and
   non-standard-format.
7. NV champagne (null vintage) in every list.
8. A wine carrying all four tags at once.
9. Backend stopped mid-session: list, then a tag toggle, then an enrichment
   tap — three different error classes in a row.
10. Camera permission denied, then granted.
11. Scan a wine already in the collection (duplicate path, zero metered calls).
12. Scan, then force-quit at the draft screen; confirm nothing appears in a
    list and the draft is swept.
13. Dynamic Type at xxLarge on the card and the retailer table.
14. Dark appearance on every screen in this list.
15. VoiceOver pass over one populated card and one expanded retailer table.
