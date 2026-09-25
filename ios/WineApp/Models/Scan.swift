import Foundation

/// `POST /api/label-scan` response — mirrors `LabelScanResult` in
/// `web/src/api.ts`.
struct LabelScanResult: Codable, Hashable {
    var producer: String?
    var vintage: Int?
    var region: String?
    var denomination: String?
    var qualityClassification: String?
    var vineyard: String?
    var cuvee: String?
    var grapeVarieties: [String]?
    var wineColor: WineColor?
    var missingTier1Fields: [String]

    enum CodingKeys: String, CodingKey {
        case producer, vintage, region, denomination
        case qualityClassification = "quality_classification"
        case vineyard, cuvee
        case grapeVarieties = "grape_varieties"
        case wineColor = "wine_color"
        case missingTier1Fields = "missing_tier1_fields"
    }

    /// The draft this scan becomes. No list tag: every creation path starts
    /// as a draft and is promoted from the review screen (Phase 9.4).
    var draftInput: NewWine {
        NewWine(
            producer: producer, vintage: vintage, region: region, denomination: denomination,
            qualityClassification: qualityClassification, vineyard: vineyard, cuvee: cuvee,
            grapeVarieties: grapeVarieties, wineColor: wineColor
        )
    }
}

/// `POST /api/wines/duplicate-check` body — the three identity fields
/// `shared/utils/duplicate-match.ts` reads.
struct DuplicateCheckRequest: Encodable, Hashable {
    var producer: String?
    var denomination: String?
    var vintage: Int?

    init(_ scan: LabelScanResult) {
        producer = scan.producer
        denomination = scan.denomination
        vintage = scan.vintage
    }

    // Explicit nulls, matching what the web sends from a scan result.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(producer, forKey: .producer)
        try c.encode(denomination, forKey: .denomination)
        try c.encode(vintage, forKey: .vintage)
    }

    enum CodingKeys: String, CodingKey { case producer, denomination, vintage }
}

/// `DuplicateOutcome` — `{ kind: 'none' | 'duplicate' | 'vintage_mismatch', wine? }`.
enum DuplicateOutcome: Decodable, Hashable {
    /// `kind: 'none'` — named so it can't be confused with `Optional.none`.
    case noMatch
    /// A confident match: open the existing wine, no draft, no metered call.
    case duplicate(Wine)
    /// Same producer and denomination, different vintage: still a new draft,
    /// with a notice naming the wine it is distinct from.
    case vintageMismatch(Wine)

    enum CodingKeys: String, CodingKey { case kind, wine }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "duplicate": self = .duplicate(try c.decode(Wine.self, forKey: .wine))
        case "vintage_mismatch": self = .vintageMismatch(try c.decode(Wine.self, forKey: .wine))
        default: self = .noMatch
        }
    }
}
