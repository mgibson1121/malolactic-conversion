import Foundation

/// Everything the Cellar dashboard's widgets show, derived from the one
/// `GET /api/wines?tag_cellar=true` + one `GET /api/settings` the dashboard
/// makes (implementation spec §6.1 — never a request per widget).
struct CellarSummary: Hashable {
    let totalBottles: Int
    let capacity: Int?
    /// Wine counts (not bottles) per segment — tapping a segment filters the
    /// list of wines below it.
    let readiness: [ReadinessSegment: Int]
    /// Bottle counts by region, largest first. Same grouping as the web's
    /// `CellarStats`: `region`, with nil as "Unspecified", zero-bottle regions
    /// dropped.
    let regions: [RegionAllocation]
    /// Bottle counts by colour across the whole cellar.
    let colours: ColourCounts

    init(wines: [Wine], settings: AppSettings?, today: Date, calendar: Calendar = .current) {
        totalBottles = wines.reduce(0) { $0 + $1.cellarQuantity }
        capacity = settings?.cellarCapacity

        var readiness = Dictionary(uniqueKeysWithValues: ReadinessSegment.allCases.map { ($0, 0) })
        for wine in wines {
            readiness[DrinkReadiness.of(wine.drinkingWindow, today: today, calendar: calendar).segment, default: 0] += 1
        }
        self.readiness = readiness

        var byRegion: [String: ColourCounts] = [:]
        var colours = ColourCounts()
        for wine in wines {
            byRegion[wine.region ?? "Unspecified", default: ColourCounts()].add(wine.cellarQuantity, colour: wine.wineColor)
            colours.add(wine.cellarQuantity, colour: wine.wineColor)
        }
        regions = byRegion
            .map { RegionAllocation(region: $0.key, counts: $0.value) }
            .filter { $0.total > 0 }
            // Ties broken by name so the order is stable across refreshes.
            .sorted { $0.total != $1.total ? $0.total > $1.total : $0.region < $1.region }
        self.colours = colours
    }

    /// `round(total / capacity * 100)`, as the web computes it. Nil when no
    /// capacity is set (the widget shows "Set cellar capacity" instead).
    var percentFull: Int? {
        guard let capacity, capacity > 0 else { return nil }
        return Int((Double(totalBottles) / Double(capacity) * 100).rounded())
    }

    /// The bar's fill, clamped: over capacity is a real state, shown by the
    /// red percentage and the "Over capacity" pill, not by an overflowing bar.
    var fillFraction: Double? {
        guard let capacity, capacity > 0 else { return nil }
        return min(Double(totalBottles) / Double(capacity), 1)
    }

    var isOverCapacity: Bool {
        guard let capacity, capacity > 0 else { return false }
        return totalBottles > capacity
    }

    /// The widget collapses entirely when every count is zero.
    var hasReadinessData: Bool { readiness.values.contains { $0 > 0 } }
}

struct RegionAllocation: Hashable, Identifiable {
    let region: String
    let counts: ColourCounts
    var id: String { region }
    var total: Int { counts.total }
}

struct ColourCounts: Hashable {
    var red = 0
    var white = 0
    var rose = 0
    var unknown = 0

    var total: Int { red + white + rose + unknown }

    mutating func add(_ bottles: Int, colour: WineColor?) {
        switch colour {
        case .red: red += bottles
        case .white: white += bottles
        case .rose: rose += bottles
        case nil: unknown += bottles
        }
    }
}
