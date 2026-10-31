/**
 * What a hard refresh costs, in Serper credits (Phase 12.1 WI-7, D6). The
 * figures are the measured ones from the Phase 9.2 cost spec §3
 * (docs/specs/2026-08-12-phase-9.2-enrichment-cost-reduction.md) — not new
 * estimates:
 *
 *  - Reviews: the primary tier alone, which is where most wines succeed,
 *    measured at ~9.3 credits a wine. When the primary tier finds no score
 *    the extended tier and merchant probe run too: ~20–24 credits worst case.
 *  - Price & retailers: exactly 1 credit a wine (a Shopping search; the
 *    Puppeteer listing check is local).
 *
 * One file so a re-measurement is a one-line change. The iOS app mirrors it in
 * `Constants.swift` (`EnrichmentCosts`) — change both. Since Phase 12.3 WI-1
 * the Hard refresh buttons no longer show these figures; the Edit screen's
 * "Refresh searches now?" prompt still does.
 */
export const HARD_REFRESH_CREDITS = {
  reviews: { typical: 9, worstCase: 24 },
  price: { typical: 1, worstCase: 1 },
} as const
