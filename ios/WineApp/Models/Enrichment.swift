import Foundation

// Price and review enrichment shapes — mirrors of `PriceData`,
// `RetailerPrice`, `RetailerReview`, `CriticScore` and `MatchVerdict` in
// `shared/types.ts` / `shared/utils/wine-match.ts`. Each source speaks in its
// own voice: nothing here blends or averages across sources.

enum VerificationState: String, Codable, Hashable {
    case verified
    case unverified
    /// Never attempted. Absence of a badge *is* this state in the UI.
    case unchecked
}

enum MatchDimension: String, Codable, Hashable {
    case match
    case mismatch
    case unknown
}

/// `MatchVerdict` — note its two numeric keys are camelCase on the wire.
struct MatchVerdict: Codable, Hashable {
    var producer: MatchDimension
    var denomination: MatchDimension
    var bottling: MatchDimension
    var vintage: MatchDimension
    var candidateVintage: Int?
    var vintageGap: Int?
}

struct CriticDrinkingWindow: Codable, Hashable {
    var start: Int?
    var end: Int?
}

struct CriticScore: Codable, Hashable {
    /// Canonical name when `knownPublication`, otherwise raw attribution text.
    var publication: String
    /// A Double, not an Int: 20-point scales use halves (17.5).
    var score: Double
    var knownPublication: Bool
    var drinkingWindow: CriticDrinkingWindow?
    var vintageCharacter: VintageRating?
    var deal: Bool

    enum CodingKeys: String, CodingKey {
        case publication, score
        case knownPublication = "known_publication"
        case drinkingWindow = "drinking_window"
        case vintageCharacter = "vintage_character"
        case deal
    }
}

enum ReviewSource: String, Codable, Hashable {
    case configured
    /// Open-web fallback — a domain the developer hasn't vetted.
    case fallback
}

struct RetailerReview: Codable, Hashable {
    var slug: String
    var name: String
    var productUrl: String
    var criticScores: [CriticScore]
    var fetchedAt: String
    var source: ReviewSource
    var pageVintage: Int?
    var vintageGap: Int?
    var match: MatchVerdict
    var pagePrice: Double?

    enum CodingKeys: String, CodingKey {
        case slug, name
        case productUrl = "product_url"
        case criticScores = "critic_scores"
        case fetchedAt = "fetched_at"
        case source
        case pageVintage = "page_vintage"
        case vintageGap = "vintage_gap"
        case match
        case pagePrice = "page_price"
    }
}

struct RetailerPrice: Codable, Hashable {
    var slug: String
    var name: String
    var price: Double?
    var url: String
    var distanceMiles: Double
    var isPreferredRetailer: Bool
    var isSearchResultsPage: Bool
    var matchedVintage: Int?
    var vintageMismatch: Bool
    var vintageVerdict: MatchDimension
    var packQuantity: Int
    var bottleSizeMl: Int?
    var nonStandardFormat: Bool
    var formatLabel: String
    var linkOnly: Bool
    var verification: VerificationState

    enum CodingKeys: String, CodingKey {
        case slug, name, price, url
        case distanceMiles = "distance_miles"
        case isPreferredRetailer = "is_preferred_retailer"
        case isSearchResultsPage = "is_search_results_page"
        case matchedVintage = "matched_vintage"
        case vintageMismatch = "vintage_mismatch"
        case vintageVerdict = "vintage_verdict"
        case packQuantity = "pack_quantity"
        case bottleSizeMl = "bottle_size_ml"
        case nonStandardFormat = "non_standard_format"
        case formatLabel = "format_label"
        case linkOnly = "link_only"
        case verification
    }
}

struct PriceRange: Codable, Hashable {
    var min: Double
    var max: Double
}

struct PriceData: Codable, Hashable {
    var priceMin: Double?
    var priceAvg: Double?
    var priceMax: Double?
    /// Prices for *other* vintages of the same wine — never merged into the
    /// headline figures.
    var otherVintagePriceRange: PriceRange?
    var retailers: [RetailerPrice]
    var nearestRetailer: RetailerPrice?
    var fetchedAt: String

    enum CodingKeys: String, CodingKey {
        case priceMin = "price_min"
        case priceAvg = "price_avg"
        case priceMax = "price_max"
        case otherVintagePriceRange = "other_vintage_price_range"
        case retailers
        case nearestRetailer = "nearest_retailer"
        case fetchedAt = "fetched_at"
    }
}

struct RetailerLink: Codable, Hashable {
    var slug: String
    var name: String
    var url: String
}

/// The metadata `fetch-price` / `fetch-reviews` add on top of the wine they
/// return (Phase 9.2): `cached` when the server declined to re-fetch inside
/// its TTL, and when the stored data was actually sourced.
struct EnrichmentMeta: Decodable, Hashable {
    var cached: Bool?
    var fetchedAt: String?

    enum CodingKeys: String, CodingKey {
        case cached
        case fetchedAt = "fetched_at"
    }
}

struct EnrichmentResult: Hashable {
    var wine: Wine
    var meta: EnrichmentMeta
}

enum ReviewTier: String {
    case primary
    case full
}
