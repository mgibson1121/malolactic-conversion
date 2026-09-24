import Foundation

/// Display strings for the compressed card (implementation spec §7.1). Views
/// read these rather than formatting inline, so the truncation contract is
/// testable without rendering.
enum WineFormatting {
    /// Line 1. `—` only when both parts are missing (the web's fallback).
    static func title(_ wine: Wine) -> String {
        let parts = [wine.producer, wine.denomination].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? "—" : parts.joined(separator: " · ")
    }

    /// `NV` for a nil vintage — never blank, never a dash.
    static func vintage(_ wine: Wine) -> String {
        wine.vintage.map(String.init) ?? "NV"
    }

    /// Line 2: `2019 · Burgundy`, or just the vintage.
    static func subtitle(_ wine: Wine) -> String {
        guard let region = wine.region, !region.isEmpty else { return vintage(wine) }
        return "\(vintage(wine)) · \(region)"
    }

    /// `Drink '26–'38`. Nil when there is no wine-level window — the disputed
    /// per-critic spread is detail-view only.
    static func drinkWindow(_ window: DrinkingWindow?) -> String? {
        guard let window,
              let start = twoDigitYear(window.start),
              let end = twoDigitYear(window.end) else { return nil }
        return "Drink '\(start)–'\(end)"
    }

    /// Whole dollars with grouping: `$1,240`, never `$1.2k`.
    static func price(_ amount: Double?) -> String? {
        guard let amount else { return nil }
        return currency.string(from: NSNumber(value: amount.rounded()))
    }

    static func rating(_ rating: MyRating) -> String {
        switch rating {
        case .poor: return "Poor"
        case .acceptable: return "Acceptable"
        case .good: return "Good"
        case .veryGood: return "Very Good"
        case .outstanding: return "Outstanding"
        }
    }

    private static func twoDigitYear(_ isoDate: String) -> String? {
        let year = isoDate.prefix(4)
        guard year.count == 4, year.allSatisfy(\.isNumber) else { return nil }
        return String(year.suffix(2))
    }

    private static let currency: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.locale = Locale(identifier: "en_US")
        f.maximumFractionDigits = 0
        return f
    }()
}
