import Foundation

/// Which metered lookup produced an `EnrichmentResult`.
enum EnrichmentKind {
    case price
    case reviews
}

extension Wine {
    /// The one definition of what an enrichment result changes on a wine
    /// (Phase 12.1 WI-9). The scan flow's preview and the saved wine's detail
    /// screen both apply results through here, so they cannot diverge by
    /// construction — before this, each copied its own subset of fields, and
    /// the derived ones (critic order, window status, stale and exclusion
    /// notes) landed in one and not the other.
    ///
    /// Each kind brings across **only what it owns**. The price and review
    /// lookups run at the same time, and their answers can arrive in either
    /// order: a price response carries whatever review-derived fields the
    /// server had when *it* read the wine, which may predate the review
    /// result that landed first. Taking those would silently erase the
    /// critic order the reviews just produced.
    ///
    /// Fields the developer owns — tags, quantity, the manual price, the wine's
    /// identity — are left exactly as they are here, because the caller may
    /// hold an optimistic edit the response predates.
    func applying(_ fresh: Wine, from kind: EnrichmentKind) -> Wine {
        var wine = self
        switch kind {
        case .price:
            wine.priceData = fresh.priceData
            wine.priceExclusions = fresh.priceExclusions
            wine.enrichmentStale = EnrichmentStale(
                price: fresh.enrichmentStale?.price ?? false,
                reviews: wine.enrichmentStale?.reviews ?? false
            )
        case .reviews:
            wine.reviewData = fresh.reviewData
            // Review extraction can derive these (never over a manual value —
            // the server enforces that), and they feed the Ready-to-drink counts.
            wine.drinkingWindow = fresh.drinkingWindow
            wine.drinkingWindowSource = fresh.drinkingWindowSource
            wine.vintageRating = fresh.vintageRating
            wine.vintageRatingSource = fresh.vintageRatingSource
            wine.windowStatus = fresh.windowStatus
            wine.criticSummary = fresh.criticSummary
            wine.enrichmentStale = EnrichmentStale(
                price: wine.enrichmentStale?.price ?? false,
                reviews: fresh.enrichmentStale?.reviews ?? false
            )
        }
        return wine
    }
}
