import Foundation

/// The price rule (developer decision, 2026-09-26): a wine with no stored
/// price data is priced automatically, **once**; after that, price changes
/// only when the user taps Refresh. Opening a wine that already has prices
/// never makes a call.
///
/// "Once" is guarded per session, not just by `price_data == nil`: a fetch
/// that fails leaves `price_data` nil, and without this set every reopen of
/// that wine would fire another paid request — automatic retry by another
/// name (implementation spec §4.4).
@MainActor
enum PriceOnce {
    private static var attempted: Set<String> = []

    /// True — and records the attempt — when this wine should be priced now.
    static func claim(_ wine: Wine) -> Bool {
        guard wine.priceData == nil, !attempted.contains(wine.id) else { return false }
        attempted.insert(wine.id)
        return true
    }

    /// Marks a wine as priced by another path (the scan auto-fire, a tap).
    static func record(_ wineID: String) {
        attempted.insert(wineID)
    }

    /// Tests only.
    static func reset() {
        attempted = []
    }
}
