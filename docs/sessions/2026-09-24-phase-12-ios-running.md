# 2026-09-24 — Phase 12: the iOS app running, then detail, Evaluate and gestures

**Branches:** `feature/phase-12-ios-app` ([#34](https://github.com/mgibson1121/malolactic-conversion/pull/34), merged), then `feature/phase-12-ios-detail` ([#35](https://github.com/mgibson1121/malolactic-conversion/pull/35), open).
**Status:** The app builds, and the iOS suite passes 59/59 locally and in CI. It runs on an iPhone 17 Pro simulator (iOS 27) against the real backend and collection.

## What was done

1. **Toolchain.** Xcode 27 installed. The developer accepted the license and ran the first-launch setup. The iOS 27 Simulator runtime was downloaded (8 GB, with approval). No iPhone 17 Pro simulator ships with the runtime, so one was created to match the spec's target device.
2. **The first compile of yesterday's uncompiled Swift was clean.** The compiler caught one real concurrency error in new code, fixed by marking a pure helper `nonisolated`.
3. **Running against real data found two bugs no fixture could.** See the decisions below.
4. **Scan flow and manual add** committed and merged in #34.
5. **#34 was squash-merged while the CI commit was being pushed.** A direct tree diff (`git diff origin/main origin/<branch>`) showed only that commit was missing: the §13 corollary case again. It was carried to a fresh branch and opened as #35 straight away.
6. **iOS CI.** A separate `ios` job and a committed shared scheme. The job passed on its first run.
7. **Detail screen, Evaluate form, and swipe/long-press actions.** See the commits on #35 and the build status in `docs/build-phases.md` Phase 12.

## Key decisions (and where they live)

- **Stored enrichment JSON is older than its types.** 46 retailer rows had no `verification`, 44 reviews had no `source`/`match`, 13 scores had no `deal`. Missing fields decode to what the web renders for `undefined`. Recorded in `build-phases.md` Phase 12 and `CLAUDE.md` §11.
- **Repeated IDs inside one List/LazyVStack are silently dropped.** This is why "In the cellar" rendered empty. Recently added now has its own container. Noted in the code; it's a SwiftUI fact rather than a project rule.
- **Swipe actions need a `List`,** so the lists and the dashboard became plain Lists styled as cards. An unstyled Button inside a List row claims the whole row, so widget buttons are `.borderless`.
- **Retailer display names come from stored enrichment,** not a Swift copy of `RETAILER_CONFIG`, which would drift.
- **Optimistic tag/quantity changes roll back on failure** (implementation spec §4.4). The web's leave-it-in-place behaviour was deliberately not ported.
- **Nothing metered was spent while testing.** No scan, no Fetch, no Refresh, no retailer resolution, no note saved. The screens were checked by looking at them, not by triggering paid calls.

## Found, not fixed

- The Mettler Family Vineyards wine has its denomination stored as the literal string `"None"`. It's a data issue, not a code issue; it shows as "· None" on both clients.
- The web's `DiscoveryReview` fetches price automatically on mount for any wine without price data, including manual adds and duplicate matches. That is broader than `CLAUDE.md` §15's single exception. The iOS app doesn't copy it. This needs a developer decision.

## What's next

1. Bundle the Domine and Work Sans font files. They're OFL-licensed from Google Fonts; downloading them needs approval.
2. The guided retailer-URL confirmation flow (web Phase 7.2).
3. Walk the implementation spec's §13 QA checklist on a device, including a real scan.
