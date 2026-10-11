import Foundation

/// The price the app treats as *the* price (Phase 12.1 D12): the developer's
/// own manual price when set, otherwise the automated average, otherwise
/// nothing. Swift mirror of `shared/utils/effective-price.ts`, covered by the
/// shared-fixture parity test (`effective-price-cases.json`).
///
/// The automated avg/high/low stay visible but become informational when a
/// manual price is set — the same primary/informational pattern as drinking
/// windows. A manual price is never overwritten by any fetch.
struct EffectivePrice: Hashable {
    enum Basis: String, Hashable {
        case manual
        case automated
    }

    let value: Double?
    let basis: Basis?

    init(manualPrice: Double?, automatedAverage: Double?) {
        if let manualPrice {
            value = manualPrice
            basis = .manual
        } else if let automatedAverage {
            value = automatedAverage
            basis = .automated
        } else {
            value = nil
            basis = nil
        }
    }

    init(_ wine: Wine) {
        self.init(manualPrice: wine.manualPrice, automatedAverage: wine.priceData?.priceAvg)
    }

    var isManual: Bool { basis == .manual }
}
