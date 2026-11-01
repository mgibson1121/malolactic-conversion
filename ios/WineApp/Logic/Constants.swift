import Foundation

/// Phase 12.1 tuning constants, in one file so they change without a code search.
enum ScanTiming {
    /// How long "Scan successful — pulling details" waits for a first critic
    /// score before moving on to the review screen anyway (D8, WI-5), measured
    /// from the moment the parse returns. The lookups are not cancelled when
    /// the hold ends — the review screen shows "Looking…" for whatever is
    /// still pending. Mirrors `PREVIEW_HOLD_MS` in `web/src/constants.ts`.
    static let previewHold: Duration = .milliseconds(3000)
}

/// What a hard refresh costs, in Serper credits (Phase 12.1 WI-7, D6) — the
/// measured Phase 9.2 figures, mirrored from
/// `shared/config/enrichment-costs.config.ts`. Change both together. Since
/// Phase 12.3 WI-1 the Hard refresh buttons don't show them; the Edit
/// screen's "Refresh searches now?" prompt still does.
enum EnrichmentCosts {
    enum Kind {
        case reviews
        case price

        var typical: Int { self == .reviews ? 9 : 1 }
        var worstCase: Int { self == .reviews ? 24 : 1 }
    }
}

/// What each retailer-row badge means (Phase 12.1 WI-8), following the
/// `VerificationState` definition in `shared/types.ts`. "Verified" is honest
/// about its scope: it does not confirm the vintage or the exact bottling.
enum BadgeExplanation {
    static func title(for badge: RetailerBadge) -> String? {
        switch badge {
        case .verified: return "Verified"
        case .unverified: return "Unverified"
        case .searchOnly: return "Search only"
        default: return nil
        }
    }

    static func text(for badge: RetailerBadge) -> String? {
        switch badge {
        case .verified:
            return "Shop page mentions this producer."
        case .unverified:
            return "Couldn't confirm. Price may be outdated."
        case .searchOnly:
            return "Search link, no price."
        default:
            return nil
        }
    }
}
