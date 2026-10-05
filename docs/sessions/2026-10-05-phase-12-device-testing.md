# 2026-09-30 → 2026-10-05: Phase 12 device testing and fixes

**PRs:** #36–#45, all merged to `main`.
**Status:** The iOS app is installed on the developer's iPhone and has been used against the real collection for five days. Every defect found in that time was fixed in the PRs below, except the open items at the end. The formal §13 QA checklist (implementation spec) is still the developer's to walk.

This session followed `2026-09-26-phase-12-ios-finish.md`. It's written as input for planning the next round of changes: the **Open items** section is the backlog, with the options already discussed.

## How testing ran

- **Hosting.** The backend runs on the developer's Mac (`npm run dev:backend`, port 3000). The phone reaches it over home Wi-Fi at `192.168.1.155:3000`, the Mac's router-assigned address.
- **Installing.** The app goes onto the phone from Xcode with the phone plugged in (⌘R). After install, the cable isn't needed.
- **Uncommitted local settings.** `DEVELOPMENT_TEAM` and an `NSLocalNetworkUsageDescription` move in `project.pbxproj` / `Info.plist` are the developer's signing setup. They are deliberately left uncommitted.
- **Connection failures.** The phone occasionally failed to reach the Mac. Causes seen: iOS's Local Network permission resetting after a reinstall, and transient Wi-Fi drops. The developer expects this to fade once the backend is hosted off the Mac, and chose not to add request logging for now.

## What was found, and what fixed it

| # | Symptom on the phone | Cause | Fix |
|---|---|---|---|
| 1 | La Rioja Alta: no critic scores at any retailer | The producer was read as "La Rioja Alta, S.A."; the legal suffix inside a quoted query zeroed every retailer search | #37: `stripLegalForm` |
| 2 | Sesta di Sopra Brunello priced at $42.01 | Its own Rosso di Montalcino listing was accepted as the Brunello | #37: sibling-appellation rule |
| 3 | "Sestadisopra" (label styling) didn't match "Sesta di Sopra" (shop styling) | Producer matching needed every word to be present | #37: spacing-insensitive fallback (8+ letters) |
| 4 | Sesta di Sopra regular Brunello was treated as the Magistra already in the cellar | The duplicate check ignored bottling and never asked | #38: bottling-aware check; it always asks ("Same wine?"), and "Different wine" makes a new row |
| 5 | Refreshed scores vanished from the list and on reopening | Lists hold their own copy of each wine; the detail screen never reported enrichment back | #39: `onChanged` after every fetch, resolve and saved link |
| 6 | La Rioja Alta 904: no price on three refreshes | Cuvée stored as the label subtitle "Selección Especial"; shops sell it as "Gran Reserva 904"; "no bottling word present → mismatch" rejected 14 of 15 correct listings | #40: descriptors confirm but never reject; review queries quote naming words only; `identityOf()`; one shared producer rule (`mentionsProducer`); Weingut/Bodega(s)/Tenuta treated like Domaine; scan prompt asks for the name the wine is sold under |
| 7 | B-21 magnum averaged as a 750 ml bottle ($199.98) | Its Google Shopping title had no size; only the product page's `<h1>` said "(1.5L)" | #41: the product page is rendered when a link is resolved, and its headline is read for the format |
| 8 | Collina Dalla Valle: nothing after scanning, nothing on open, data appeared on refresh, then vanished | A new wine's lookups take ~1 minute; the wine was saved 4 s before its price landed; nothing told the lists. The disappearing was the pre-#39 build still on the phone | #42: scan-flow lookups report when they land (even after the modal closes); detail re-reads the wine on open; `resolve-retailer-url` coalesced (a double tap had paid twice) |
| 9 | New bottles "not in the cellar" | They were the last rows: the API returns oldest first, and "Recently added" repeated them at the top | #43 (developer decision): "Recently added" removed; cellar list newest first |
| 10 | Franck Balthazar Cornas: every listing flagged "12L", no price | "Balthazar" is a 12 L bottle name; the format parser read the producer's name | #44: the wine's own name words are blanked before format parsing |
| 11 | The Cornas (save had failed) came back as saved, in no list | `runMigration` re-ran migration 005's `UPDATE … SET promoted_at = date_added WHERE promoted_at IS NULL` on every start, so **every backend restart saved every open draft** | #45: `schema_migrations`, each file runs once |

#36 (fonts, fetch-once price rule, Find reviews with an in-app browser) was the planned Phase 12 finish from 2026-09-26; it merged at the start of this session.

## Developer decisions made this session

- **A duplicate is always a question.** If a scan looks like a wine already in the collection, ask. "Not a duplicate" creates a separate row with a new id (`CLAUDE.md` §5).
- **Only a name can reject a bottling** (`CLAUDE.md` §5, with the trade-off below).
- **Cellar list newest first, no "Recently added" section** (Phase 12 specs §4 / §6.1 amended).
- **Connection issues are left to hosting.** No request logging for now.
- **K&L can't be read automatically.** It's the developer's main US source for wines like Sesta di Sopra Magistra, but its Cloudflare check blocks automated readers. Getting past it automatically was ruled out.

## Data changed directly (via the API, not the app)

| Wine | Change | Cost |
|---|---|---|
| La Rioja Alta Gran Reserva 2015 | cuvée "Selección Especial" → "904" | free |
| La Rioja Alta Gran Reserva 2015 | B-21 link resolved, to verify #41 (now flagged 1.5L; average $135.97 → $103.97) | 1 Serper credit |
| R. López de Heredia Rioja 2013 | into Cellar (1 btl), vineyard "Viña Tondonia" (was saved as Discovered, with no name) | free |
| Franck Balthazar Cornas Chaillot 2020 | Cellar only, 3 btl (had been turned into a saved wine with no list by bug 11) | free |
| Domaine de Villaine Rully 1er Cru 2020 | Cellar only, 1 btl (same cause) | free |

Diagnostics also spent about 5 Serper credits on one-off searches that wrote nothing to the database.

## Open items: the backlog for planning

Grouped by area. None of these has been started.

### Enrichment accuracy
1. **Magnums and packs that only the product page reveals.** #41 catches these only when a link is opened. Every refresh brings back plain search links, so unopened fallback listings stay unchecked. Options discussed:
   - **(a) Flag price outliers (free).** E.g. a listing at ≥ ~1.75× the median of other same-vintage listings is marked "price suggests a larger format" and kept out of the average. It's a guess, so a genuinely expensive shop gets flagged too. *Recommended.*
   - **(b) Render every fallback page during the fetch.** Exact, but up to ~5 extra Serper credits per refresh plus noticeably slower refreshes. An earlier phase (9.2 WI-6) removed exactly this cost.
2. **Descriptor-only cuvées let in a producer's other wines.** With a cuvée like "Selección Especial", the producer's other bottlings (Viña Ardanza, Alberdi…) also pass the bottling check, ranked equal. The real fix is data that names the wine. Possible next step: a "this cuvée has no naming word" hint in the edit form or draft review.
3. **The list card's score badge ignores vintage.** Collina Dalla Valle 2016 shows "94 DC" from the 2021's page. The detail screen labels each review's vintage; the card badge doesn't. Options: badge only same-vintage scores, or mark other-vintage badges.
4. **Review queries quote the producer as stored.** A run-together "Sestadisopra" still zeroes shop searches. #37's spacing fix only helps after a result is found. Options:
   - Fix at the scan: in the prompt, prefer the spelled-out name from the back label over the logo styling.
   - Add a query variant.
5. **Scan parsing misses.** Seen this session:
   - Producer and cuvée merged: "Collina Dalla Valle" should be producer "Dalla Valle", cuvée "Collina".
   - Classification holding the cuvée: Magistra entry has `quality_classification` "Magistra".
   - Missing name: López de Heredia with no "Tondonia".
   - Subtitle as cuvée: "Selección Especial" (addressed in #40's prompt change, which is **not yet verified on a real scan**, ~$0.004).

   A small prompt pass covering these, plus a free cleanup of the affected rows (rename "Sestadisopra" → "Sesta di Sopra"; split Collina; clear Magistra's classification), was offered and not yet approved.
6. **Wine Cellarage (winecellarage.com)** stocks La Rioja Alta 904 near the developer but isn't a configured retailer and didn't appear in Shopping results. Adding it needs its address and site-search pattern.

### Blocked sources
7. **K&L reviews and prices.** K&L is skipped for reviews (`reviews:skipped:unrenderable:kl`) and is link-only for price. Proposed: in the iOS in-app browser (Find reviews), "Use this page" sends the **page text the developer is already viewing** to the backend, instead of the URL for the backend to render. The backend then runs the same GPT extraction. About a cent per use, no Serper credit. It works for any shop that blocks automated readers. Offered; not yet approved.

### App behaviour
8. **Viña Tondonia was saved as Discovered, not Cellar.** The developer hasn't said whether Cellar was picked. If it was, the draft review's list picker needs investigating.
9. **"Third bottle failed to save" (2026-09-30)** couldn't be reproduced, and no screen text was captured. The 2026-10-04 Cornas save failure was a connection-level failure (the app's "is the backend running?" message only appears when no response arrives within 60 s).
10. **Offered, not requested:** a "+1 bottle" shortcut on the duplicate prompt for a second bottle of a wine already in the cellar.
11. **Discovered and Wishlist order.** Still oldest first (only the cellar changed in #43).

### Operations
12. **Hosting off the Mac.** Expected to remove the Wi-Fi and Local Network issues. Until then:
    - After a reinstall, check **Settings → Privacy & Security → Local Network → Wine**.
    - The Mac's address can change; a DHCP reservation on the router would pin it.
    - Restart the backend after merging backend PRs.
13. **Request logging** (method, path, status, time) would have answered "did the phone's request arrive?" instantly. Declined for now, pending hosting.

## Test counts at the end of the session

iOS 74, web 128, backend 505 passed (4 skipped). Both type-checks are clean. CI ran on every PR.

## Where the rules live

- `CLAUDE.md` §3 (Phase 5): each migration file runs once.
- `CLAUDE.md` §5: legal forms, spacing, sibling appellations, duplicate-is-a-question, only-a-name-rejects, one identity / one producer rule.
- `docs/build-phases.md` Phase 12: one dated note per fix above, with the measurements.
- Phase 12 product and implementation specs: duplicate prompt copy; cellar list order; "Recently added" removed.
