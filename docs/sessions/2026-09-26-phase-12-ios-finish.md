# 2026-09-26 — Phase 12: fonts, fetch-once price, Find reviews

**Branch:** `feature/phase-12-ios-finish` (PR opened at the end of this session; not merged).
**Status:** Build work for Phase 12 is complete. What remains is the device QA pass (implementation spec §13), which the developer is doing themselves.

## What was done

1. **Domine and Work Sans are bundled.** They were downloaded, with approval, from `google/fonts` (variable TTFs, SIL OFL, licences included). They're registered through `UIAppFonts` and applied to UIKit nav titles through `UINavigationBar` appearance. `FontTests` fails if a family stops registering, because `Font.custom` falls back silently. Work Sans is wider than the system face, so "Needs more time" now wraps to two lines instead of truncating.
2. **Price fetch-once rule.** This is a developer decision; see below.
3. **Find reviews** on the detail screen, with an in-app retailer browser.

## Key decisions (and where they live)

- **Price is fetched once per wine, then only on Refresh.** In the developer's words: "The app should fetch prices once and then give me the option to refresh. I don't need a fresh call each time the page is loaded." It applies to iOS detail, draft review, manual add and duplicate "Open it", and to the web's `DiscoveryReview` and `WineDetailModal`. A per-session guard (`PriceOnce.swift` / `priceOnce.ts`) makes "once" hold even when a fetch fails. Reviews are unchanged.
  - The developer explicitly asked for this guard to be documented. It is recorded as the binding rule in `CLAUDE.md` §15 ("Second exception"), and the §15 heading now says "two named exceptions".
  - It is cross-referenced from `CLAUDE.md` §9, the product-context metered-enrichment principle, both Phase 12 specs (amended at the old "no fetch-on-appear" lines), and `build-phases.md` Phase 12.
  - This settles the open question from 2026-09-24. The web's long-standing price auto-fetch on mount is now sanctioned and guarded, not tightened.
- **The guided retailer flow uses an in-app browser, not the clipboard.** Recorded in `build-phases.md` Phase 12 and the implementation spec's component table.

## Checked without spending

Everything was checked visually without triggering a metered call. Domaine Rousseau already had prices, so opening it made no fetch. "Search retailers" is free. The in-app browser was opened on K&L's own search, and "Use this page" was correctly disabled there. Nothing was confirmed, and the collection data is unchanged.

## Follow-up from device testing (2026-09-30)

- **The duplicate check now asks, and it knows about bottlings.** The developer scanned a Sesta di Sopra Brunello. The app offered it as their Sesta di Sopra *Magistra*, a different wine. The matcher now compares cuvée, vineyard and classification. On web and iOS the prompt is now "Same wine?", showing both identities and any bottling difference. "Different wine — add it" creates a separate row with its own id. Details are in `CLAUDE.md` §5 and `build-phases.md` Phase 12.
- **Producer legal forms and sibling appellations** ("S.A." in quoted queries zeroed every retailer search, and a Rosso di Montalcino price was accepted for a Brunello) were fixed in PR #37.

## What's next

The developer's device QA pass against the implementation spec's §13 checklist: 0/1/many bottles, long names at 393/402/440 pt, NV, Dynamic Type at xxLarge, dark appearance, VoiceOver, camera permission, and a real scan end-to-end. Then close Phase 12.
