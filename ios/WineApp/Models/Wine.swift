import Foundation

// Hand-written mirror of `shared/types.ts` (Phase 12 spec §2.1). That file is
// the contract: when it changes, this file changes in the same PR, and
// `backend/scripts/export-ios-fixtures.ts` regenerates the decoding fixtures
// the tests below read. Explicit CodingKeys rather than a snake_case key
// strategy: the strategy also rewrites dictionary keys (`retailer_links` is
// keyed by retailer slug), which would silently corrupt them.
//
// Deliberately not mirrored: `expert_reviews`, `community_sentiment`,
// `community_excerpts`, `advice_linked`, `review_probe_log` — legacy or
// backend-only fields no screen reads. Decoding ignores unknown keys.

enum WineColor: String, Codable, CaseIterable, Hashable {
    case red
    case white
    case rose = "rosé"
}

enum MyRating: String, Codable, CaseIterable, Hashable {
    case poor
    case acceptable
    case good
    case veryGood = "very_good"
    case outstanding
}

enum VintageRating: String, Codable, Hashable {
    case belowAvg = "below_avg"
    case avg
    case good
    case veryGood = "very_good"
}

enum CellarCategory: String, Codable, Hashable {
    case table
    case nearTerm = "near_term"
    case longTerm = "long_term"
}

/// Whether `drinking_window` / `vintage_rating` was set by hand or derived
/// from review extraction. `derived` gets the Sourced marker in the UI.
enum FieldProvenance: String, Codable, Hashable {
    case manual
    case derived
}

/// Wine-level drinking window, ISO dates (`YYYY-MM-DD`). Null on the wine
/// when critics disagree — never averaged.
struct DrinkingWindow: Codable, Hashable {
    var start: String
    var end: String
}

struct Wine: Codable, Identifiable, Hashable {
    let id: String

    // Tier 1
    var producer: String?
    var vintage: Int?
    var region: String?
    var denomination: String?

    // Tier 2 — nullable by design; a nil collapses, it never renders a dash.
    var qualityClassification: String?
    var vineyard: String?
    var cuvee: String?
    var grapeVarieties: [String]?
    var wineColor: WineColor?
    var labelImageUrl: String?

    // Additive list tags — any combination is valid. There is no status enum.
    var tagDiscovered: Bool
    var tagWishlist: Bool
    var tagCellar: Bool
    var tagConsumed: Bool

    var cellarQuantity: Int
    /// Reserved (CLAUDE.md §3) — decoded, never displayed.
    var cellarCategory: CellarCategory?
    var drinkingWindow: DrinkingWindow?
    var drinkingWindowSource: FieldProvenance?
    var vintageRating: VintageRating?
    var vintageRatingSource: FieldProvenance?
    var myRating: MyRating?
    var myTags: [String]
    var wishlistNotes: String?
    var pricePaid: Double?
    var purchasedFrom: String?
    var latestTastingNoteId: String?
    /// Derived server-side from the latest tasting note (Phase 12). Absent
    /// on older backends, hence optional twice over.
    var latestTastingNoteDate: String?

    var priceData: PriceData?
    /// User-saved retailer URLs keyed by retailer slug.
    var retailerLinks: [String: String]?
    var reviewData: [RetailerReview]?

    let dateAdded: String
    var dateFirstConsumed: String?
    /// `nil` means draft (Phase 9.4): persisted so enrichment can attach, but
    /// excluded from every list until promoted with at least one list tag.
    var promotedAt: String?

    var isDraft: Bool { promotedAt == nil }

    enum CodingKeys: String, CodingKey {
        case id, producer, vintage, region, denomination
        case qualityClassification = "quality_classification"
        case vineyard, cuvee
        case grapeVarieties = "grape_varieties"
        case wineColor = "wine_color"
        case labelImageUrl = "label_image_url"
        case tagDiscovered = "tag_discovered"
        case tagWishlist = "tag_wishlist"
        case tagCellar = "tag_cellar"
        case tagConsumed = "tag_consumed"
        case cellarQuantity = "cellar_quantity"
        case cellarCategory = "cellar_category"
        case drinkingWindow = "drinking_window"
        case drinkingWindowSource = "drinking_window_source"
        case vintageRating = "vintage_rating"
        case vintageRatingSource = "vintage_rating_source"
        case myRating = "my_rating"
        case myTags = "my_tags"
        case wishlistNotes = "wishlist_notes"
        case pricePaid = "price_paid"
        case purchasedFrom = "purchased_from"
        case latestTastingNoteId = "latest_tasting_note_id"
        case latestTastingNoteDate = "latest_tasting_note_date"
        case priceData = "price_data"
        case retailerLinks = "retailer_links"
        case reviewData = "review_data"
        case dateAdded = "date_added"
        case dateFirstConsumed = "date_first_consumed"
        case promotedAt = "promoted_at"
    }
}

/// The three list tags a draft can be promoted into (`POST /:id/promote`).
struct PromoteTags: Encodable, Hashable {
    var tagDiscovered = false
    var tagWishlist = false
    var tagCellar = false

    var hasAny: Bool { tagDiscovered || tagWishlist || tagCellar }

    enum CodingKeys: String, CodingKey {
        case tagDiscovered = "tag_discovered"
        case tagWishlist = "tag_wishlist"
        case tagCellar = "tag_cellar"
    }
}

/// A partial update for `PATCH /api/wines/:id`. Nil fields are omitted from
/// the body, never sent as null — the server treats the mere presence of
/// `drinking_window` / `vintage_rating` as a manual override, so an
/// accidental key would flip provenance to `manual`.
struct WinePatch: Encodable, Hashable {
    var tagDiscovered: Bool?
    var tagWishlist: Bool?
    var tagCellar: Bool?
    var tagConsumed: Bool?
    var cellarQuantity: Int?
    var producer: String?
    var vintage: Int?
    var region: String?
    var denomination: String?
    var qualityClassification: String?
    var vineyard: String?
    var cuvee: String?
    var wineColor: WineColor?

    enum CodingKeys: String, CodingKey {
        case tagDiscovered = "tag_discovered"
        case tagWishlist = "tag_wishlist"
        case tagCellar = "tag_cellar"
        case tagConsumed = "tag_consumed"
        case cellarQuantity = "cellar_quantity"
        case producer, vintage, region, denomination
        case qualityClassification = "quality_classification"
        case vineyard, cuvee
        case wineColor = "wine_color"
    }
}

/// Body for `POST /api/wines`. Every field is optional server-side
/// (`CreateWineSchema`), and a new wine always starts as a draft regardless
/// of the tags sent.
struct NewWine: Encodable, Hashable {
    var producer: String?
    var vintage: Int?
    var region: String?
    var denomination: String?
    var qualityClassification: String?
    var vineyard: String?
    var cuvee: String?
    var grapeVarieties: [String]?
    var wineColor: WineColor?

    enum CodingKeys: String, CodingKey {
        case producer, vintage, region, denomination
        case qualityClassification = "quality_classification"
        case vineyard, cuvee
        case grapeVarieties = "grape_varieties"
        case wineColor = "wine_color"
    }
}

/// `GET /api/wines` query. Tags are AND-ed; `q` is the Phase 10.5 substring
/// search, AND-ed with whatever tab filter is active.
struct WineFilter: Hashable {
    var tagDiscovered = false
    var tagWishlist = false
    var tagCellar = false
    var tagConsumed = false
    var hasTastingNote = false
    var myRating: MyRating?
    var q: String?

    static let cellar = WineFilter(tagCellar: true)
    static let discovered = WineFilter(tagDiscovered: true)
    static let wishlist = WineFilter(tagWishlist: true)
    static let notes = WineFilter(hasTastingNote: true)

    var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        if tagDiscovered { items.append(URLQueryItem(name: "tag_discovered", value: "true")) }
        if tagWishlist { items.append(URLQueryItem(name: "tag_wishlist", value: "true")) }
        if tagCellar { items.append(URLQueryItem(name: "tag_cellar", value: "true")) }
        if tagConsumed { items.append(URLQueryItem(name: "tag_consumed", value: "true")) }
        if hasTastingNote { items.append(URLQueryItem(name: "has_tasting_note", value: "true")) }
        if let myRating { items.append(URLQueryItem(name: "my_rating", value: myRating.rawValue)) }
        if let q, !q.trimmingCharacters(in: .whitespaces).isEmpty {
            items.append(URLQueryItem(name: "q", value: q))
        }
        return items
    }
}

/// `GET`/`PUT /api/settings` — a single app-level row.
struct AppSettings: Codable, Hashable {
    var cellarCapacity: Int?

    enum CodingKeys: String, CodingKey {
        case cellarCapacity = "cellar_capacity"
    }

    // Synthesized encoding would omit a nil capacity; clearing it must send
    // an explicit null.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cellarCapacity, forKey: .cellarCapacity)
    }
}
