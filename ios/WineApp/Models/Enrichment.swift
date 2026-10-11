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
    init(publication: String, score: Double, knownPublication: Bool,
         drinkingWindow: CriticDrinkingWindow?, vintageCharacter: VintageRating?, deal: Bool) {
        self.publication = publication
        self.score = score
        self.knownPublication = knownPublication
        self.drinkingWindow = drinkingWindow
        self.vintageCharacter = vintageCharacter
        self.deal = deal
    }

    /// Scores stored before Phase 8 have no `deal`; absent means not flagged.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        publication = try c.decode(String.self, forKey: .publication)
        score = try c.decode(Double.self, forKey: .score)
        knownPublication = try c.decodeIfPresent(Bool.self, forKey: .knownPublication) ?? false
        drinkingWindow = try c.decodeIfPresent(CriticDrinkingWindow.self, forKey: .drinkingWindow)
        vintageCharacter = try c.decodeIfPresent(VintageRating.self, forKey: .vintageCharacter)
        deal = try c.decodeIfPresent(Bool.self, forKey: .deal) ?? false
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
    /// Nil on reviews stored before Phase 9.1 recorded the verdict.
    var match: MatchVerdict?
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
    init(slug: String, name: String, productUrl: String, criticScores: [CriticScore], fetchedAt: String,
         source: ReviewSource, pageVintage: Int?, vintageGap: Int?, match: MatchVerdict?, pagePrice: Double?) {
        self.slug = slug
        self.name = name
        self.productUrl = productUrl
        self.criticScores = criticScores
        self.fetchedAt = fetchedAt
        self.source = source
        self.pageVintage = pageVintage
        self.vintageGap = vintageGap
        self.match = match
        self.pagePrice = pagePrice
    }

    /// Rows stored before Phase 7.3 carry no `source` — every retailer then
    /// was a configured one — and rows before Phase 9.1 carry no `match`.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = try c.decode(String.self, forKey: .slug)
        name = try c.decode(String.self, forKey: .name)
        productUrl = try c.decode(String.self, forKey: .productUrl)
        criticScores = try c.decodeIfPresent([CriticScore].self, forKey: .criticScores) ?? []
        fetchedAt = try c.decodeIfPresent(String.self, forKey: .fetchedAt) ?? ""
        source = try c.decodeIfPresent(ReviewSource.self, forKey: .source) ?? .configured
        pageVintage = try c.decodeIfPresent(Int.self, forKey: .pageVintage)
        vintageGap = try c.decodeIfPresent(Int.self, forKey: .vintageGap)
        match = try c.decodeIfPresent(MatchVerdict.self, forKey: .match)
        pagePrice = try c.decodeIfPresent(Double.self, forKey: .pagePrice)
    }
}

/// A pack, case or magnum counted at a 750 ml-equivalent price (Phase 12.2 D7).
struct NormalizedFormat: Codable, Hashable {
    enum Kind: String, Codable { case pack, `case`, magnum }
    var kind: Kind
    var divisor: Int
    var source: String
    var shelfPrice: Double

    enum CodingKeys: String, CodingKey {
        case kind, divisor, source
        case shelfPrice = "shelf_price"
    }
}

/// One side of an ambiguous price split (Phase 12.2 D10).
struct PriceGroup: Codable, Hashable {
    var min: Double
    var max: Double
    var retailers: [String]
}

/// Why listings were kept out of the headline (Phase 12.2 WI-1).
struct PriceExcludedCounts: Codable, Hashable {
    var otherVintage: Int
    var pack: Int
    var nonStandardFormat: Int
    var suspectedLargeFormat: Int
    var linkOnly: Int
    var outsideBottling: Int
    var outlier: Int

    /// `outside_bottling` arrived with the bottling answer (Phase 12.2), after
    /// the first blobs carrying `excluded`: absent decodes to 0.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        otherVintage = try c.decodeIfPresent(Int.self, forKey: .otherVintage) ?? 0
        pack = try c.decodeIfPresent(Int.self, forKey: .pack) ?? 0
        nonStandardFormat = try c.decodeIfPresent(Int.self, forKey: .nonStandardFormat) ?? 0
        suspectedLargeFormat = try c.decodeIfPresent(Int.self, forKey: .suspectedLargeFormat) ?? 0
        linkOnly = try c.decodeIfPresent(Int.self, forKey: .linkOnly) ?? 0
        outsideBottling = try c.decodeIfPresent(Int.self, forKey: .outsideBottling) ?? 0
        outlier = try c.decodeIfPresent(Int.self, forKey: .outlier) ?? 0
    }

    enum CodingKeys: String, CodingKey {
        case otherVintage = "other_vintage"
        case pack
        case nonStandardFormat = "non_standard_format"
        case suspectedLargeFormat = "suspected_large_format"
        case linkOnly = "link_only"
        case outsideBottling = "outside_bottling"
        case outlier
    }
}

/// What a listing's title says about the bottling, both directions (WI-2).
struct ListingBottlingDifference: Codable, Hashable {
    var extra: [String]
    var missing: [String]
}

enum HeadlineBasis: String, Codable {
    case singleListing = "single_listing"
    case multiple, ambiguous, none
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
    /// Phase 12.2: set only when the format is certain, see `NormalizedFormat`.
    var normalized: NormalizedFormat?
    var pricePer750: Double?
    var suspectedLargeFormat: Bool?
    var otherStorefront: Bool?
    var listingTitle: String?
    var bottlingDifference: ListingBottlingDifference?
    var outsideBottling: Bool?

    enum CodingKeys: String, CodingKey {
        case slug, name, price, url, normalized
        case listingTitle = "listing_title"
        case bottlingDifference = "bottling_difference"
        case outsideBottling = "outside_bottling"
        case pricePer750 = "price_per_750"
        case suspectedLargeFormat = "suspected_large_format"
        case otherStorefront = "other_storefront"
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
    init(slug: String, name: String, price: Double?, url: String, distanceMiles: Double,
         isPreferredRetailer: Bool, isSearchResultsPage: Bool, matchedVintage: Int?, vintageMismatch: Bool,
         vintageVerdict: MatchDimension, packQuantity: Int, bottleSizeMl: Int?, nonStandardFormat: Bool,
         formatLabel: String, linkOnly: Bool, verification: VerificationState,
         normalized: NormalizedFormat? = nil, pricePer750: Double? = nil,
         suspectedLargeFormat: Bool? = nil, otherStorefront: Bool? = nil) {
        self.slug = slug
        self.name = name
        self.price = price
        self.url = url
        self.distanceMiles = distanceMiles
        self.isPreferredRetailer = isPreferredRetailer
        self.isSearchResultsPage = isSearchResultsPage
        self.matchedVintage = matchedVintage
        self.vintageMismatch = vintageMismatch
        self.vintageVerdict = vintageVerdict
        self.packQuantity = packQuantity
        self.bottleSizeMl = bottleSizeMl
        self.nonStandardFormat = nonStandardFormat
        self.formatLabel = formatLabel
        self.linkOnly = linkOnly
        self.verification = verification
        self.normalized = normalized
        self.pricePer750 = pricePer750
        self.suspectedLargeFormat = suspectedLargeFormat
        self.otherStorefront = otherStorefront
    }

    /// `price_data` is stored JSON, written by whichever phase last fetched
    /// it: rows from before Phase 9.1 have no `verification` or
    /// `vintage_verdict`, and older still no pack/format or `link_only`
    /// fields. Each absence decodes to what the web renders for `undefined`:
    /// unchecked (no badge), unknown, a single standard bottle, not link-only.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = try c.decode(String.self, forKey: .slug)
        name = try c.decode(String.self, forKey: .name)
        price = try c.decodeIfPresent(Double.self, forKey: .price)
        url = try c.decode(String.self, forKey: .url)
        distanceMiles = try c.decodeIfPresent(Double.self, forKey: .distanceMiles) ?? 0
        isPreferredRetailer = try c.decodeIfPresent(Bool.self, forKey: .isPreferredRetailer) ?? false
        isSearchResultsPage = try c.decodeIfPresent(Bool.self, forKey: .isSearchResultsPage) ?? false
        matchedVintage = try c.decodeIfPresent(Int.self, forKey: .matchedVintage)
        vintageMismatch = try c.decodeIfPresent(Bool.self, forKey: .vintageMismatch) ?? false
        vintageVerdict = try c.decodeIfPresent(MatchDimension.self, forKey: .vintageVerdict) ?? .unknown
        packQuantity = try c.decodeIfPresent(Int.self, forKey: .packQuantity) ?? 1
        bottleSizeMl = try c.decodeIfPresent(Int.self, forKey: .bottleSizeMl)
        nonStandardFormat = try c.decodeIfPresent(Bool.self, forKey: .nonStandardFormat) ?? false
        formatLabel = try c.decodeIfPresent(String.self, forKey: .formatLabel) ?? ""
        linkOnly = try c.decodeIfPresent(Bool.self, forKey: .linkOnly) ?? false
        verification = try c.decodeIfPresent(VerificationState.self, forKey: .verification) ?? .unchecked
        normalized = try c.decodeIfPresent(NormalizedFormat.self, forKey: .normalized)
        pricePer750 = try c.decodeIfPresent(Double.self, forKey: .pricePer750)
        suspectedLargeFormat = try c.decodeIfPresent(Bool.self, forKey: .suspectedLargeFormat)
        otherStorefront = try c.decodeIfPresent(Bool.self, forKey: .otherStorefront)
        listingTitle = try c.decodeIfPresent(String.self, forKey: .listingTitle)
        bottlingDifference = try c.decodeIfPresent(ListingBottlingDifference.self, forKey: .bottlingDifference)
        outsideBottling = try c.decodeIfPresent(Bool.self, forKey: .outsideBottling)
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
    /// Phase 12.2 WI-1, absent on blobs fetched before it.
    var excluded: PriceExcludedCounts?
    var normalizedCount: Int?
    var headlineBasis: HeadlineBasis?
    var priceGroups: [PriceGroup]?
    var headlineEstimated: Bool?

    enum CodingKeys: String, CodingKey {
        case excluded
        case normalizedCount = "normalized"
        case headlineBasis = "headline_basis"
        case priceGroups = "price_groups"
        case headlineEstimated = "headline_estimated"
        case priceMin = "price_min"
        case priceAvg = "price_avg"
        case priceMax = "price_max"
        case otherVintagePriceRange = "other_vintage_price_range"
        case retailers
        case nearestRetailer = "nearest_retailer"
        case fetchedAt = "fetched_at"
    }
    init(priceMin: Double?, priceAvg: Double?, priceMax: Double?, otherVintagePriceRange: PriceRange?,
         retailers: [RetailerPrice], nearestRetailer: RetailerPrice?, fetchedAt: String,
         excluded: PriceExcludedCounts? = nil, normalizedCount: Int? = nil, headlineBasis: HeadlineBasis? = nil,
         priceGroups: [PriceGroup]? = nil, headlineEstimated: Bool? = nil) {
        self.excluded = excluded
        self.normalizedCount = normalizedCount
        self.headlineBasis = headlineBasis
        self.priceGroups = priceGroups
        self.headlineEstimated = headlineEstimated
        self.priceMin = priceMin
        self.priceAvg = priceAvg
        self.priceMax = priceMax
        self.otherVintagePriceRange = otherVintagePriceRange
        self.retailers = retailers
        self.nearestRetailer = nearestRetailer
        self.fetchedAt = fetchedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        priceMin = try c.decodeIfPresent(Double.self, forKey: .priceMin)
        priceAvg = try c.decodeIfPresent(Double.self, forKey: .priceAvg)
        priceMax = try c.decodeIfPresent(Double.self, forKey: .priceMax)
        otherVintagePriceRange = try c.decodeIfPresent(PriceRange.self, forKey: .otherVintagePriceRange)
        retailers = try c.decodeIfPresent([RetailerPrice].self, forKey: .retailers) ?? []
        nearestRetailer = try c.decodeIfPresent(RetailerPrice.self, forKey: .nearestRetailer)
        fetchedAt = try c.decodeIfPresent(String.self, forKey: .fetchedAt) ?? ""
        excluded = try c.decodeIfPresent(PriceExcludedCounts.self, forKey: .excluded)
        normalizedCount = try c.decodeIfPresent(Int.self, forKey: .normalizedCount)
        headlineBasis = try c.decodeIfPresent(HeadlineBasis.self, forKey: .headlineBasis)
        priceGroups = try c.decodeIfPresent([PriceGroup].self, forKey: .priceGroups)
        headlineEstimated = try c.decodeIfPresent(Bool.self, forKey: .headlineEstimated)
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
