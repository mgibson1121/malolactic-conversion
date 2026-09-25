# 2026-09-23 — Phase 12: review and iOS foundation

**Branch:** `feature/phase-12-ios-app`
**Status:** Backend changes built and tested. iOS foundation written but **not yet compiled** (no Xcode on the development Mac).
**PR:** opened against `main` at the end of this session, for developer review. Not merged.

## What was done

1. **Reviewed Phase 12 against the real code before building.** The two Phase 12 specs
   assumed "no new endpoints, no schema changes." Checking them against `backend/routes`,
   `web/src/api.ts` and `shared/types.ts` turned up two needs that rule couldn't meet, and one
   plain error:
   - The scan path's free duplicate check is `scoreMatch`, which is TypeScript. Keeping it
     client-side on iOS would have meant a Swift port of wine identity.
   - The Notes tab sorts by, and shows, the latest tasting-note date. The list API only
     returned the note's id.
   - The spec named the scan route `POST /api/scan-label`. It is `POST /api/label-scan`
     (multipart, field `label`).

2. **Developer decisions (asked in-session):** add a free `POST /api/wines/duplicate-check`
   rather than port `scoreMatch` to Swift, and add a derived `latest_tasting_note_date` to
   wine reads rather than fetch notes per row or drop the date. Rejected alternatives and
   reasons are in `docs/build-phases.md` Phase 12, "Backend changes"; the rules an agent
   must follow are in `CLAUDE.md` §3's schema bullets.

3. **Backend (commit `85e4a5f`).** `findDuplicate` moved to `shared/utils/duplicate-match.ts`
   (the web now imports it from there, and its tests moved to `backend/tests/unit/`). There is
   a new route plus route tests. `latest_tasting_note_date` comes from a correlated subquery.
   A JOIN was avoided because `tasting_notes` shares column names with `wines`, and
   `listWines` filters on bare names. `updateWine` now re-reads after writing so the derived
   field can't come back stale. Backend: 448 tests pass (was 434). Web: 124 tests pass (was
   131; the difference is the 7 duplicate-match tests that moved). Both `tsc` runs are clean.

4. **iOS foundation (commit `c808e6b`).** The Xcode project is hand-written and uses
   synchronized folders. It contains Codable models, `APIClient`, `LoadState`, pure logic
   (readiness, critic badge, cellar summary, formatting), theme tokens (light plus the new dark
   set), and the five-tab shell. Scan presents a placeholder modal for now. Also included:
   the server-address sheet, the Cellar dashboard widgets, list tabs with debounced search and
   a Notes rating filter, and a first cut of the compressed card (`ViewThatFits` drops badges
   right to left). XCTest suites decode fixtures that `backend/scripts/export-ios-fixtures.ts`
   generates from the real SQLite adapter.

5. **Doc drift fixed in passing (commit `8b302df`).** `CLAUDE.md` §7 still called the Phase 12
   capture surface AVFoundation, though decision D1 changed that on 2026-09-21. §5 and §6 still
   put SensorPush in Phase 12; since the 2026-09-20 renumbering it belongs to Phase 13.

## Key decisions (and where they now live)

- Duplicate-check endpoint and the derived note date: `CLAUDE.md` §3, `build-phases.md`
  Phase 12, and both Phase 12 specs (marked as amended).
- The Ready-to-drink widget counts wines, not bottles, because a tap filters the list of
  wines. A wine past its window counts as Ready now. Recorded in `build-phases.md` Phase 12
  and the product spec §4.
- A network failure with nothing cached shows the D5 copy ("Can't reach the backend at
  {host}…" plus **Change server**) instead of the web's "port 3000" line, since on a phone the
  likely cause is being on the wrong network. The server-message case is unchanged.
- Four critic abbreviations beyond the spec's seven (JD, TA, GR, GP) cover the rest of
  `critic-keywords.ts`'s canonical publications.
- Explicit `CodingKeys` everywhere instead of `.convertFromSnakeCase`. That strategy also
  rewrites dictionary keys, which would corrupt the slug-keyed `retailer_links`.

## Blocker found

The development Mac has **no Xcode**. It also has a broken Command Line Tools Swift install:
the 6.2.4 compiler doesn't match the SDK, and SwiftPM's manifest won't link. So no Swift was
compiled or run this session. Every file passes `swiftc -parse` (syntax only). Type errors
will surface on the first Xcode build. Installing Xcode (App Store) is the gate for the next
slice.

## What's next

1. Install Xcode, then build and run the tests. Fix any type errors from this uncompiled first
   pass.
2. Add a macOS CI job (`xcodebuild test`) once it builds.
3. Scan flow: the system camera picker plus "Choose from library" and "Enter manually",
   on-device resize, duplicate check, draft, draft review with the primary-tier auto-fire, and
   Discard calling `DELETE`.
4. Detail view (Research / Reviews / Retailers disclosure groups), enrichment controls,
   Evaluate form.
5. Swipe and long-press actions with optimistic rollback. Bundle the Domine and Work Sans font
   files.
