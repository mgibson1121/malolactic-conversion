# Phase 12 — Mobile build (native iOS)

> v1 — 2026-09-20. Landed in `docs/build-phases.md` Phase 12 the same day; §0's
> renumbering has already been applied there (this section is kept as the record
> of what changed and why, not as an outstanding to-do).
> Read alongside `wine-app-product-context.md`, `CLAUDE.md`, and
> `docs/build-phases.md` Phase 11.1 (warm restyle).

---

## 0. Renumbering (applied 2026-09-20 to `docs/build-phases.md`)

Inserting this phase pushed everything after it back by one:

| Was | Now | Title |
|---|---|---|
| Phase 12 | **Phase 13** | Frontend build → **retitled: Remaining frontend surfaces (web + iOS extras)** |
| Phase 13 | **Phase 14** | Learning features |
| Phase 14 | **Phase 15** | Open source release |

Every cross-reference to "Phase 12" elsewhere in the docs currently means the
*old* frontend-build phase. Those references need rewriting, not just
renumbering — they now split between new-12 and new-13. Known sites:

- `build-phases.md` Phase 3 — "native iOS camera flow (Phase 12)" → **Phase 12** (still correct; this phase owns it)
- `build-phases.md` Phase 4 / 4.5 — "polish deferred to Phase 12" → **Phase 12** (mobile) / **Phase 13** (web)
- `build-phases.md` Phase 10 — "Phase 12 below still holds" (iOS as primary surface) → **Phase 12**
- `build-phases.md` Phase 10.5 — "allocation-drift… is Phase 12/14 scope" → **Phase 13/15**
- `build-phases.md` Phase 10.6 — "still Phase 12 work" (Cellar drinking-window flat list) → **Phase 12** (it ships here, as the Ready-to-drink widget)
- `build-phases.md` Phase 11 — "remain Phase 12 (Frontend build) scope" → **Phase 13**
- `wine-app-product-context.md` §4.4 and §8 — "Phase 12" in the cellar-visualisation and `cellar_category` entries → **Phase 12**
- `docs/specs/2026-09-01-…-design-requirements.md` §4 — advice capture "(Phase 12)" → **Phase 13**

### What new Phase 13 keeps

Per the scoping decision, Phase 12 supersedes most of the old Phase 12. What
remains in Phase 13:

- Web app parity with anything new that mobile introduces (the web app is
  otherwise complete through Phase 11.1)
- iOS share-sheet extension (scan a bottle encountered online by sharing a
  photo or URL from another app) — deliberately deferred; it is a separate app
  target with its own entitlements, not part of the main app build
- SensorPush environment monitoring module (`backend/modules/environment/`)
- Allocation drift view (target distribution vs. actual) — needs a
  target-allocation field that does not exist yet
- The six-hotspot navigation restructure — **recommend killing this outright**,
  see §7 Recommendation R1

---

## 1. Goal

Ship a native iOS app for iPhone that is the primary daily surface for the
collection: a dashboard landing, four browsable lists, a compressed wine card,
and label capture from the phone's own camera. It consumes the existing backend
API. No schema changes. *(Amended 2026-09-23: "no new backend endpoints" gave way to two free additions — `POST /api/wines/duplicate-check` and a derived `latest_tasting_note_date` on wine reads. See `docs/build-phases.md` Phase 12, "Backend changes".)*

**Target device:** iPhone 17 Pro — 402 × 874 pt logical (@3x), Dynamic Island,
34 pt home indicator. Portrait only in v1. Layout must survive 393 pt (iPhone
17) and 440 pt (17 Pro Max) without redesign — nothing pinned to 402.

**Not in this phase:** iPad, landscape, Apple Watch, widgets/Live Activities,
offline mode, push notifications, the share extension.

---

## 2. Technical shape

| Decision | Value |
|---|---|
| Framework | Swift + SwiftUI, iOS 18 minimum |
| Networking | `URLSession` + `Codable` against the existing Express API |
| Models | Hand-written Swift structs mirroring `shared/types.ts` — see §2.1 |
| State | `@Observable` view models, one per tab + one app-level session store |
| Camera | `UIImagePickerController` (`sourceType = .camera`) wrapped in `UIViewControllerRepresentable` — **not** a custom AVFoundation capture UI; see D2 |
| Image handling | Resize to max 1024 px longest side **on device** before upload, matching `backend/modules/label-scan`'s existing rule |
| Persistence | None. Network-only, same as the web app. |
| Backend base URL | Configurable in a Settings sheet; defaults to the LAN dev host |

### 2.1 Model parity

`shared/types.ts` is the contract. The Swift models mirror it field for field —
including the things the web app already gets right and a naive port would
break:

- Boolean tags are additive and independent (`tag_discovered`, `tag_wishlist`,
  `tag_cellar`, `tag_consumed`). There is no `status` enum. A wine can be in
  several lists at once.
- `promoted_at == nil` means **draft**. Drafts never appear in a list.
- `drinking_window` is `nil` when critics disagree — in that case
  `review_data`'s per-critic windows are shown attributed, never averaged.
- `vintage_rating` renders as **"Year"** in UI copy.
- `*_source == "derived"` gets the **Sourced** marker.
- Critic scores are never blended into a single number.
- Tier 2 nulls collapse — no empty rows, no placeholder dashes.

### 2.2 Enrichment stays user-initiated

Metered calls (`fetch-price`, `fetch-reviews`) keep the web app's rules exactly:
explicit user action, TTL cache respected, `?tier=primary` auto-fire on the scan
path only, once per wine, after the free duplicate check. A phone in
someone's pocket must not become a new way to spend Serper credits — no
pull-to-refresh-triggers-enrichment, no fetch-on-appear.

---

## 3. Navigation

A five-item bottom tab bar, fixed, above the home indicator. 49 pt bar + 34 pt
safe area. Every tap target ≥ 44 pt.

| Position | Tab | Icon (SF Symbol) | Destination |
|---|---|---|---|
| 1 | **Cellar** | `square.grid.2x2` | Dashboard landing — see §4 |
| 2 | **Discovered** | `circle.circle` | List |
| 3 | **Scan** | `camera.viewfinder` | Modal capture flow — see §6 |
| 4 | **Wishlist** | `bookmark` | List |
| 5 | **Notes** | `list.bullet.rectangle` | Tasting Notes list |

Scan sits centre as a raised accent-filled circular button that presents a
full-screen modal rather than switching tabs — it is an action, not a
destination. Dismissing returns to whichever tab was active.

> **D3 (§8) — confirmed 2026-09-21:** the Cellar tab *is* the dashboard
> landing. Widgets on top, the bottle list below them in the same scroll view.
> There is no separate "Home" tab.

---

## 4. Screen 1 — Cellar (dashboard landing)

One vertical scroll. Full-width widget cards, 16 pt side margin, 12 pt gap,
14 pt corner radius, `--surface` on `--bg`. No horizontal carousels.

Large-title nav bar: "Cellar", collapsing to inline on scroll. Trailing
search icon expands into the existing `q`-scoped search (300 ms debounce,
scoped to this tab, AND-ed with the tab filter — unchanged from web).

**Widget order (v1):**

1. **Capacity** — `{totalBottles}` bottles / `{capacity}` slots, a horizontal
   fill bar, and "{n}% full". Tap to edit capacity inline (`PUT /api/settings`).
   Over 100% is a real state — the bar clamps and the number goes red-pill.
   No capacity set → "Set cellar capacity" CTA instead of a percentage.
2. **Scan a label** — accent-filled CTA row, camera glyph, "Scan a label" +
   one-line subtitle. Duplicate of the tab-bar action, deliberately: it is the
   highest-frequency task and shouldn't rely on discovering the centre button.
3. **Ready to drink** — the Phase 10.6 drinking-window flat list, finally
   shipping. Three counts as tappable segments: **Ready now** /
   **Needs more time** / **No window**. Tapping filters the cellar list below.
   *(Decided 2026-09-23 while building: counts are wines, not bottles; a wine
   past the end of its window counts as Ready now.)*
   Derived client-side from `drinking_window` vs. today; wines with a null
   window (critic disagreement included) fall in "No window", never guessed at.
4. **By region** — the existing `CellarStats` allocation bars, mobile-shaped:
   region label truncated to one line, stacked colour bar, bottle count right,
   `font-variant-numeric: tabular`. Top 5 regions, then "Show all ({n})".
5. **Colour split** — red / white / rosé / unknown as a single segmented bar
   with a count legend. Uses the same four colours as the web app
   (`--red-wine`, `--white-wine`, `--rosé-wine`, `--text-muted`).
6. **Recently added** — 3 most recent by `date_added`, as compressed cards.
7. **Cellar list** — section header "In the cellar ({n})", then the compressed
   cards (§5). This is the same list the web Cellar tab shows; it lives at the
   bottom of the same scroll rather than behind another tap.

Empty state: if the cellar is empty, widgets 1 and 3–6 collapse to a single
"Nothing in the cellar yet" card and the scan CTA stays.

---

## 5. The compressed wine card

**Requirement: at least 3 cards fully visible in portrait below the dashboard
header.** Budget: ~190 pt of list viewport per card at most. Target height
**96–112 pt** for a typical card, so 5–6 are visible on a pure list screen.

### 5.1 What is on the card

Three lines plus a right rail.

```
┌────────────────────────────────────────────────┐
│ ●  Domaine Dujac · Morey-St-Denis 1er…    3 btl│   line 1
│    2019 · Burgundy                             │   line 2
│    ★ Very Good   96 WA +2   Drink '26–'38  $215│   line 3
└────────────────────────────────────────────────┘
```

| Element | Source | Rule |
|---|---|---|
| Colour dot | `wine_color` | 8 pt filled circle, leading. `unknown` → hollow ring. |
| Producer · denomination | `producer`, `denomination` | Display serif, 16 pt semibold, **one line, tail-truncated** — see §5.2 |
| Bottle count | `cellar_quantity` | Right of line 1, tabular. Cellar contexts only. |
| Vintage · region | `vintage`, `region` | 13 pt muted, one line. `nil` vintage → "NV". |
| My rating | `my_rating` | Pill, existing 5-level colour mapping |
| Critic score | `review_data` | **Truncated: highest score + its publication abbreviation, then "+N"** — see §5.3 |
| Drinking window | `drinking_window` | `Drink '26–'38`, two-digit years. Omitted when null — the disputed per-critic spread is detail-view only. |
| Avg price | `price_data.price_avg` | Right-aligned, whole dollars |

Line 3 is a single horizontal run that drops items right-to-left as width runs
out, in this priority order: **rating > critic score > price > drinking
window**. It never wraps to a second line.

### 5.2 Truncation rules

- **Producer · denomination** — one line, `.truncationMode(.tail)`. If the
  producer alone exceeds the line, producer truncates and denomination is
  dropped to line 2 alongside vintage/region. Long Burgundy names
  ("Domaine Comte Georges de Vogüé Chambolle-Musigny 1er Cru Les Amoureuses")
  are the normal case, not an edge case.
- **Region** — tail-truncated at ~18 characters.
- **Never** truncate the vintage, the bottle count, or a score number.

### 5.3 Critic score truncation

The web app shows every attributed score. On mobile the card shows **one**:

- Highest numeric score wins. Ties → the one from a `known_publication: true`
  source; still tied → first by source order.
- Rendered `96 WA` using a short publication label
  (`CRITIC_KEYWORDS`-derived abbreviation; unknown publications show the raw
  source name truncated to 12 chars, still marked unnormalized).
- `+2` suffix when more scores exist. Tapping the badge opens the detail
  view's scores section directly.

This is **display truncation only** — it does not reintroduce the
preferred-source *prioritization* that Phase 11 explicitly declined to build.
Every score is still stored, still attributed, still shown in full on detail.
No averaging anywhere.

### 5.4 Retailer count truncation

On the detail view's pricing section, the retailer table shows the **nearest
retailer plus 2 more**, then "Show all {n} retailers". Verification badges
(verified / unverified / vintage-mismatch / non-standard-format / link-only)
are preserved on every row shown.

### 5.5 Actions

The card has **no buttons**. Tap → detail. Swipe actions instead:

- Swipe left → **Evaluate** (accent-2/gold)
- Swipe right → **+1 / −1 bottle** on cellar contexts; **list tag toggles** on
  Discovered/Wishlist
- Long press → context menu with the full four-way tag toggle

This is what buys the density. Every action the web card exposes as a button is
still reachable, one gesture or one tap deeper.

---

## 6. Screen — Scan

Full-screen modal, four steps, mirroring `LabelScanFlow.tsx`'s real logic:

1. **Capture** — system camera picker opens immediately on entry. "Choose from
   library" as a secondary option.
2. **Scanning** — resize to 1024 px → `POST /api/label-scan` (multipart, field `label`; corrected 2026-09-23 — the route was never `/api/scan-label`) → pulsing state
   with the captured thumbnail. Target < 30 s, same as Phase 3.
3. **Duplicate check** — the free `scoreMatch`-based check against already-
   promoted wines runs before any row is created. On iOS this is
   `POST /api/wines/duplicate-check` (amended 2026-09-23) — the same
   `shared/utils/duplicate-match.ts` the web runs in-process, not a Swift port. A confident match jumps
   straight to that wine's Discovery Review. A vintage mismatch shows the
   notice and still creates a draft.
4. **Discovery Review** — draft mode: editable Tier 1/Tier 2 fields with
   missing-Tier-1 prompts, the `?tier=primary` review auto-fire result when it
   lands, a three-way Discovered/Wishlist/Cellar picker, **Save to Collection**
   (disabled until a list is picked) and **Discard**.

No camera permission → an alert plus the library fallback; label scan stays
unavailable with a clear message if the OpenAI key isn't configured, exactly as
today.

---

## 7. Screens — the three other lists

Same compressed card, same nav pattern, tab-scoped search. Differences only:

- **Discovered** — quick chips in the swipe-right action (Wishlist / Cellar /
  Remove), matching the web's Phase 10.5 behaviour. No bottle count.
- **Wishlist** — avg price gets priority over drinking window on line 3.
- **Tasting Notes** — sorted by latest note date desc; line 3 shows the rating
  and the note date; a rating filter lives in the nav bar next to search.

**Detail view** is a pushed screen (not a modal) with the same sections as
`WineDetailModal`, in the same order, with two mobile changes: GPT-inferred /
enrichment content — critic scores, drinking window, pricing, retailer links —
sits below a collapsed **"Research"** disclosure group, and the tasting-note
history is a collapsed **"Reviews ({n})"** group. Identity, tags, quantity and
Evaluate are always visible without expanding anything.

---

## 8. Open decisions — all resolved 2026-09-21

All five were reviewed with the developer as product/UX trade-offs (not
technical ones) and resolved. Recorded here with the decision and reasoning;
see `docs/build-phases.md` Phase 12's "Decisions confirmed" note for the
canonical record.

- **D1 — Surface conflict. Resolved: system camera picker**, not a custom
  AVFoundation capture UI. Familiar, faster to build, and iOS's own camera
  screen is already well-designed; the traded-away capability (an in-app
  alignment guide, auto-capture) isn't needed for v1.
- **D2 — Mobile web layout. Resolved: the web app goes desktop-only.**
  Phase 11.1's 860px sidebar→top-bar collapse is retired now that iOS is the
  phone surface — not worth the ongoing design/testing cost of two responsive
  targets for a path the app will make rare. Removal work is Phase 13 scope.
- **D3 — Cellar tab vs. Home tab. Resolved: the Cellar tab *is* the
  dashboard.** See §3's note above.
- **D4 — Where does + Add Wine live? Resolved: a nav-bar `+` on the Cellar
  tab, plus an "Enter manually" option on the scan capture screen** — as
  recommended below, available in two natural places without its own tab or a
  dedicated button competing with Scan.
- **D5 — Auth / network. Resolved: LAN-only for this phase.** The app only
  works on the same network as the backend for v1. A cloud-hosted backend
  reachable from anywhere is deliberately **out of scope here** and deferred to
  its own future, not-yet-scoped phase — see `docs/build-phases.md`, "Open
  questions affecting phases," 2026-09-21 entry. That future phase reverses
  `CLAUDE.md` §15's current no-hosted-backend constraint and will also need to
  resolve authentication and API key custody, neither of which this phase
  touches.

## 9. Recommendations

- **R1 — Kill the six-hotspot navigation.** It was rejected once already
  (Phase 11.1, "the two blend in practice"), and this five-tab bar is now a
  second, independent answer to the same question. Carrying it in Phase 13 as
  live scope invites a future session to rebuild the nav. Recommend closing it
  as a resolved open question rather than deferring it again.
  **Accepted 2026-09-20** — closed under "Open questions affecting phases" in
  `docs/build-phases.md`; not carried into Phase 13.
- **R2 — Keep the Phase 11.1 warm palette.** You said you're not married to it.
  I looked for a reason to change it and didn't find one: burgundy/gold on warm
  paper is genuinely right for this product, it survives the move to a dark
  phone-in-a-cellar context, and it was already derived twice independently.
  What I *would* change on mobile is density, not colour — see §5. One
  addition: a **dark variant** of the same tokens, because the actual usage
  context (a cellar, a restaurant, a shop) is dim. That's a token-set addition,
  not a redesign.
- **R3 — Ship Ready-to-drink as a widget, not a Cellar sub-tab.** It resolves
  the long-standing `cellar_category` question (`wine-app-product-context.md`
  §8) and it's the one thing a phone answers better than a laptop: "what should
  I open tonight."
- **R4 — Don't build pull-to-refresh enrichment.** Tempting on mobile, directly
  contrary to the user-initiated-metered-calls principle (`CLAUDE.md` §15).
  Pull-to-refresh should re-`GET` the list, nothing more.

## 10. Milestone

A native iPhone app, running on device against the local backend, where: the
Cellar tab opens on a dashboard showing capacity, ready-to-drink counts, region
and colour allocation; at least three wine cards are fully visible in portrait;
tapping the centre button captures a label with the phone camera and produces a
populated draft in under 30 seconds; and every list, tag toggle, quantity
change, evaluation and enrichment action available on the web is reachable on
the phone.
