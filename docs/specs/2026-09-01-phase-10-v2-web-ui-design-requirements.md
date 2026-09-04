# Phase 10 v2 — Web UI Design Requirements (corrected, grounded in the shipped app)

**Status:** Requirements only — written 2026-09-01. Supersedes the 2026-08-25 design
pass's *structure*, not its visual language. Nothing has been built or mocked up yet
under this document; it exists to be executed next, either as a new Design-skill canvas
or as direct Claude Code implementation work.

**Why this exists:** The 2026-08-25 canvas modeled six full-page artboards behind a
sidebar nav — Capture, Research, Evaluate, Cellar, Wishlist + Purchasing, Learn —
reflecting `wine-app-product-context.md`'s hotspot map directly. The actual shipped app
(`web/src/App.tsx`, verified by direct read, 2026-09-01) has a completely different
shape: four tabs, two header buttons, and six modal overlays. None of the content was
wrong — the wine data, the Phase 9.4 draft/promote flow, the WSET note, the price/review
displays were all accurate — but the navigation shell the developer's feedback had to be
given against didn't match anything that will actually ship, which is the developer's
own diagnosis for why that round of feedback felt low-value. This document corrects the
shell and re-derives which screens actually need designing, so the next round starts
from a higher floor.

**Decision carried over from the developer, 2026-09-01:** build on the real shipped
navigation (tabs + header actions + modals), not the six-hotspot sidebar. Evolve it,
don't replace it.

**Decision carried over from the developer, 2026-09-01:** the 5 comments left on the
2026-08-25 canvas are archived (`docs/sessions/2026-09-01-phase-10-followup-review.md`)
but are **not** inputs to this pass. They were feedback on a canvas that's being
superseded, not requirements for this one. Whoever builds against this document should
not try to satisfy them.

---

## 1. What to keep unchanged from the 2026-08-25 pass

Nothing here was the problem — carry it forward rather than re-deriving it:

- **Visual direction:** clean, functional, financial-app register (the developer's own
  reference point was Robinhood) — not a mass-market consumer wine app, no Tuscan/Provence
  flourish, no wine-cliché imagery. IBM Plex Sans/Mono, a neutral oklch palette with two
  functional accent hues (green for positive/confirmed states, red for warnings/deals),
  card-based layout, `.pill`/`.scorechip` style small components for tags and scores.
- **The prior session's CSS foundation** (palette variables, icon library, card/pill/
  stat-tile styles) is directly reusable — the correction needed is which pages get built
  and what they contain, not the visual system itself.
- **Real data, not placeholder wines.** Pull from the live `backend/db/wine.db` at build
  time. Show real gaps honestly (a thin Cellar or Wishlist, empty states) rather than
  padding with fabricated content — this was explicitly valued last time and nothing
  about it was part of the feedback.
- **Web-first.** iOS-shaped screens still come later, extending whatever visual language
  this pass establishes — unchanged from the original Phase 10 framing.
- **Static mockups**, not a clickable prototype — carried forward as the default; revisit
  only if the developer says otherwise when this is actually built.

## 2. The real navigation model (ground truth, from `web/src/App.tsx`)

This replaces the six-hotspot sidebar entirely.

**Persistent shell:**
- Header: app title, plus two always-visible action buttons — **📷 Scan Label** and
  **+ Add Wine**. These are actions, not navigation destinations.
- Tab bar: four tabs — **Discovered**, **Wishlist**, **Cellar**, **Tasting Notes**. `Cellar`
  is the default/landing tab (`activeTab` initializes to `'cellar'`) — it is the app's
  home, design it with that weight.
- Tab filtering is a single boolean predicate per tab: `Discovered` → `tag_discovered`,
  `Wishlist` → `tag_wishlist`, `Cellar` → `tag_cellar`, `Tasting Notes` → derived
  (`has_tasting_note`, i.e. `latest_tasting_note_id IS NOT NULL`), sorted most-recent-note
  first. A wine can appear in more than one tab simultaneously — the tag model is
  additive, not a pipeline (`wine-app-product-context.md` §3).

**Modal overlays (not routes — conditionally rendered on top of whatever tab is active):**

| Modal | Opened from | Purpose |
|---|---|---|
| `LabelScanFlow` | Header "Scan Label" button | Photo upload → GPT-4o parse → edit/confirm. Creates the draft wine row the instant parsing returns (Phase 9.4 WI-1). |
| `AddWineForm` | Header "+ Add Wine" button | Manual entry of the same fields, no photo. |
| `DiscoveryReview` | Automatically, right after either creation path resolves | The keep/discard decision screen — see §3.5. |
| `EvaluateForm` | "Evaluate" action on any wine card, any tab | WSET structured tasting note. |
| `TastingNoteHistory` | "View history" on a wine with a tasting note | Read-only list of all past notes for that wine, most recent first. |
| `WineDetailModal` | Tapping any wine card, any tab | Full read-only reference view — identity, tags, price, reviews, drinking window. |

## 3. Screen-by-screen requirements

Nine real states need designing, not six. Priority split below so a first build pass has
a clear stopping point if time is short.

### Tier 1 — the four tabs + the two decision-critical modals

**3.1 Cellar tab (default/landing view)**
Reuse the substance of the old Cellar mockup (stat tiles, environment widget,
allocation-drift bars, per-wine bottle count). Correct the chrome: this renders inside
the tab-bar shell from §2, not a sidebar-nav page. Since this is the landing screen, give
it the strongest first-impression treatment.

**3.2 Wishlist tab**
Reuse the substance of the old Wishlist mockup (price spread, per-retailer lines, review
status, table-wine picks). Same chrome correction as 3.1.

**3.3 Discovered tab — new, wasn't designed last time**
The old canvas had no equivalent screen at all — it modeled "Capture" and "Research" as
hotspots instead of designing the actual Discovered list. Needs: a list of promoted wines
with `tag_discovered = true`, in whatever the "I saw this and I'm keeping an eye on it,
not yet ready to wishlist or cellar it" state looks like — likely the lightest-weight card
treatment of the four tabs, since a Discovered wine typically has the least data attached
(no purchase decision made yet). Include quick tag-toggle affordances directly on the
card (add to Wishlist / add to Cellar / remove from Discovered) rather than requiring a
trip into the detail modal for every tag change — this is a real, existing interaction
(`onTagUpdate` via the tag-toggle row, already used elsewhere in the app), just needs a
card-level treatment here rather than being buried in the detail modal.

**3.4 Tasting Notes tab — new, wasn't designed last time**
The old canvas designed a single wine's Evaluate *form* but never the Tasting Notes
*list* (the tab that shows every wine with `latest_tasting_note_id` set, most recent
first). Needs: a browsable list, each row showing the wine identity, the most recent
`my_rating`/WSET conclusion, and a way to open either the full evaluate form again (new
note) or history (past notes for that wine).

**3.5 Discovery Review modal — reuse, correct against the shipped Phase 9.4 behavior**
The old canvas's "Capture" screen approximated this well but predates two things that
have since shipped and changed the actual UI text and state machine:
- The screen shows a **draft** wine (`promoted_at IS NULL`) that appears in no list until
  the developer acts on it. Header must not claim anything like "✓ Saved to Collection"
  for a draft — neutral, undecided framing until promotion.
- The **tag row is the decision itself**: Discovered / Wishlist / Cellar as a multi-select
  with none pre-selected. **Save to Collection is disabled until at least one is chosen.**
  A **Discard** action must also be present (calls the real `DELETE` route) — this is
  mandatory, not optional, per the draft model.
- **Reviews arrive differently depending on how the wine was created.** On the **scan**
  path, the primary-tier review search and the price search are already firing (or have
  already returned) the instant this screen appears — design it showing scores already
  populated or a "searching…" state, not an idle "Fetch Reviews" button. On the **manual
  add** path, nothing auto-fires — design the idle, click-to-fetch state for that case.
  If this pass only has room for one, pick the scan-path (auto-fetched) state, since it's
  the one that most differs from a generic "results loading" pattern.
- **"Search more retailers"** (not "Fetch Reviews") appears only when the primary tier
  found zero critic scores — it's an escalation action, not the primary action, once
  scores already exist.
- Per the still-standing "additive layer" principle in `wine-app-product-context.md` §5–6
  ("each source speaks in its own voice," never blended into one number): **show every
  critic score found, each attributed to its publication, not one prioritized score.**
  Do not design toward a single-headline-score treatment for this pass — that would be a
  real product-principle change the developer hasn't made yet (see the 2026-09-01
  follow-up note for the open question this raises; it's explicitly not resolved, so
  don't design around resolving it here).

**3.6 Wine Detail modal — new as a distinct artifact, wasn't designed last time**
The old canvas's "Research" screen was a filterable browse list with a side detail
panel — that's not what exists. The real thing is a single-wine, full read-only reference
view reached by tapping any card in any tab: identity fields, status tag badges, saved
retailer links, price (min/avg/max, nearest retailer), attributed critic scores (each
shown separately, same rule as 3.5), and drinking window (wine-level value if the critics
agree, or each critic's window shown individually — attributed — if they don't; this is
already shipped behavior, `AttributedDrinkingWindows.tsx`). No edit controls. This is
effectively where "Research" as a hotspot actually lives in the shipped app — not a tab
of its own.

### Tier 2 — lower design novelty, include if time allows

**3.7 Label Scan flow (pre-save)**
The photo-upload → parsed-fields → edit/confirm screen, distinct from 3.5's post-save
Discovery Review. A plain, mostly-form screen; less design-novel than 3.5.

**3.8 Add Wine form**
Manual-entry equivalent of 3.7, no photo. Straightforward form design.

**3.9 Learn tab — aspirational, flag it as such**
Nothing behind this tab exists in the shipped app at all (Phase 12, not started — no
vintage-index aggregation, no quiz mechanism, no advice archive). If this pass designs a
Learn tab, **label it visibly as a forward-looking reference for Phase 12**, not a
description of anything buildable today — don't let it read with the same evidentiary
weight as 3.1–3.6, which are all grounded in real, currently-running code and data.

## 4. Explicitly out of scope for this pass

- The 2026-08-25 canvas's 5 comments — archived, not inputs here (see header).
- The six-hotspot sidebar navigation — superseded by §2.
- Mobile/iOS screens — still deferred to whenever the web pass is solid.
- A clickable/interactive prototype — still static mockups by default.
- Resolving the "one prioritized review vs. every source shown" question raised in the
  2026-09-01 follow-up note — design 3.5/3.6 per the still-standing "never blend"
  principle; don't pre-empt a product decision that hasn't been made.
- Advice-capture UI (the "log a tip from a sommelier" feature) — no backing code exists
  yet (Phase 12); don't invent a screen for it.

## 5. Acceptance check for whoever builds this

Before calling a new mockup done, it should be checkable against `web/src/App.tsx`
line-for-line: same four tab names, same two header actions, same six modals, same
default landing tab. Any screen that doesn't map to something in that file (or to
`wine-app-product-context.md`'s hotspot list, for the explicitly-aspirational Learn
case) shouldn't be in the mockup. That check — cheap, five minutes — is exactly what
would have caught the six-hotspot/sidebar mismatch before the developer had to spend a
review cycle finding it.
