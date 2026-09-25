import Foundation

/// One distinct drinking window with every publication that stated it —
/// the port of `getAttributedDrinkingWindows` (`web/src/utils/drinkingWindows.ts`).
/// Only complete windows count (both years present), matching
/// `deriveWineLevelFields`, so the phone's notion of "the critics disagree" is
/// the same one that left the wine-level field null.
struct AttributedDrinkingWindow: Hashable {
    let start: Int
    let end: Int
    var publications: [String]
}

enum DrinkingWindows {
    static func attributed(_ reviews: [RetailerReview]?) -> [AttributedDrinkingWindow] {
        var grouped: [AttributedDrinkingWindow] = []
        for score in CriticScores.deduped(reviews) {
            guard let start = score.drinkingWindow?.start, let end = score.drinkingWindow?.end else { continue }
            if let i = grouped.firstIndex(where: { $0.start == start && $0.end == end }) {
                if !grouped[i].publications.contains(score.publication) {
                    grouped[i].publications.append(score.publication)
                }
            } else {
                grouped.append(AttributedDrinkingWindow(start: start, end: end, publications: [score.publication]))
            }
        }
        return grouped
    }

    /// "3 critics, 2 different windows" — counts critics, not windows,
    /// exactly as `AttributedDrinkingWindows.tsx` does. Nil for one window.
    static func disagreementNote(_ windows: [AttributedDrinkingWindow]) -> String? {
        guard windows.count > 1 else { return nil }
        let critics = windows.reduce(0) { $0 + $1.publications.count }
        return "\(critics) critics, \(windows.count) different windows"
    }
}

enum DetailFormatting {
    /// `vintage_rating` is shown as "Year" (developer preference, Phase 8).
    static func vintageRating(_ rating: VintageRating) -> String {
        switch rating {
        case .belowAvg: return "Below Average"
        case .avg: return "Average"
        case .good: return "Good"
        case .veryGood: return "Very Good"
        }
    }

    /// Per-citation vintage character — deliberately different copy from the
    /// wine-level "Year" label so the two are never conflated.
    static func vintageCharacter(_ rating: VintageRating) -> String {
        switch rating {
        case .belowAvg: return "Below-avg vintage"
        case .avg: return "Average vintage"
        case .good: return "Good vintage"
        case .veryGood: return "Very good vintage"
        }
    }

    static func quality(_ raw: String) -> String {
        switch raw {
        case "flawed": return "Flawed"
        case "poor": return "Poor"
        case "acceptable": return "Acceptable"
        case "good": return "Good"
        case "very_good": return "Very Good"
        case "outstanding": return "Outstanding"
        default: return raw
        }
    }

    /// A critic's stated window, half-open allowed: `Drink 2029–2045`,
    /// `Drink 2030–?` — the web's `CriticScoreBadges` rendering.
    static func criticWindow(_ window: CriticDrinkingWindow?) -> String? {
        guard let window, window.start != nil || window.end != nil else { return nil }
        let start = window.start.map(String.init) ?? "?"
        let end = window.end.map(String.init) ?? "?"
        return "Drink \(start)–\(end)"
    }

    /// Wine-level window, `2026 – 2038` (years only; the stored value is ISO dates).
    static func wineWindow(_ window: DrinkingWindow) -> String {
        "\(window.start.prefix(4)) – \(window.end.prefix(4))"
    }

    /// `$215`, or `—` for a null bound — the one place a dash is allowed,
    /// because min/avg/max read as a set (implementation spec §2).
    static func priceBound(_ amount: Double?) -> String {
        WineFormatting.price(amount) ?? "—"
    }

    /// "today" / "yesterday" / "3 days ago" / "last week" / "2 weeks ago" /
    /// "4 months ago" — the web's `formatAge`, coarse on purpose: the question
    /// is whether stored data is old enough to be worth paying to redo.
    static func age(_ iso: String, now: Date = .now) -> String {
        guard let then = NoteDate.parse(iso) else { return "recently" }
        let days = Int(floor(now.timeIntervalSince(then) / 86_400))
        if days <= 0 { return "today" }
        if days == 1 { return "yesterday" }
        if days < 7 { return "\(days) days ago" }
        if days < 14 { return "last week" }
        if days < 60 { return "\(days / 7) weeks ago" }
        return "\(days / 30) months ago"
    }

    /// Tasting-note excerpt: 200 characters then `…` (existing web rule).
    static func excerpt(_ text: String) -> String {
        text.count > 200 ? String(text.prefix(200)) + "…" : text
    }

    /// "1 more note" / "3 more notes".
    static func moreNotes(_ total: Int) -> String? {
        let more = total - 1
        guard more > 0 else { return nil }
        return "\(more) more note\(more == 1 ? "" : "s")"
    }
}

/// A retailer's display name for a slug. The web reads `RETAILER_CONFIG`;
/// the phone has no copy of that config (a second list would drift), but every
/// retailer the wine was ever priced or reviewed at already carries its name
/// in the stored enrichment. The slug is the last resort.
enum RetailerNames {
    static func name(for slug: String, in wine: Wine) -> String {
        if let r = wine.priceData?.retailers.first(where: { $0.slug == slug }) { return r.name }
        if let r = wine.reviewData?.first(where: { $0.slug == slug }) { return r.name }
        return slug
    }
}

/// Which of the detail screen's three disclosure groups (implementation spec §8).
enum DetailGroup: String, Hashable, CaseIterable {
    case research, retailers, reviews
}

/// The retailer table's collapsed ordering (§7.3): nearest first, then the
/// rest in stored order.
enum RetailerTable {
    static let collapsedCount = 3

    static func ordered(_ price: PriceData) -> [RetailerPrice] {
        guard let nearest = price.nearestRetailer,
              let i = price.retailers.firstIndex(where: { $0.slug == nearest.slug }) else {
            return price.retailers
        }
        var rows = price.retailers
        let first = rows.remove(at: i)
        return [first] + rows
    }

    /// The badge line under a retailer row, in drop order (§7.3):
    /// verification is never dropped; distance goes first.
    static func badges(_ r: RetailerPrice) -> [RetailerBadge] {
        var badges: [RetailerBadge] = []
        switch r.verification {
        case .verified: badges.append(.verified)
        case .unverified: badges.append(.unverified)
        case .unchecked: break // absence is the state
        }
        if let year = r.matchedVintage {
            badges.append(r.vintageMismatch ? .vintageMismatch(year) : .vintage(year))
        }
        if r.nonStandardFormat, !r.formatLabel.isEmpty { badges.append(.format(r.formatLabel)) }
        if r.linkOnly { badges.append(.searchOnly) }
        badges.append(.distance(r.distanceMiles))
        return badges
    }
}

enum RetailerBadge: Hashable {
    case verified, unverified
    case vintage(Int), vintageMismatch(Int)
    case format(String)
    case searchOnly
    case distance(Double)

    var text: String {
        switch self {
        case .verified: return "Verified"
        case .unverified: return "Unverified"
        case .vintage(let y), .vintageMismatch(let y): return "\(y) vintage"
        case .format(let label): return label
        case .searchOnly: return "Search only"
        case .distance(let miles): return "\(Int(miles.rounded())) mi"
        }
    }
}
