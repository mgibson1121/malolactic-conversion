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

/// Whether a wine has a usable drinking window — computed once by the
/// backend on every read (Phase 12.1 WI-2); the app never re-derives it.
enum WindowStatus: String, Codable, Hashable {
    /// A wine-level window: the developer's own, or one derived from agreeing critics.
    case primary
    /// No window of its own, and critics who disagree: flagged "Check window".
    case check
    /// Raw value `"none"` — named so it can't be confused with `Optional.none`.
    case noWindow = "none"
}

/// One critic score in display order (Phase 12.1 D13, WI-10). The backend
/// orders and de-duplicates; the app renders the order it is given and never
/// re-sorts. Nothing here is averaged or blended.
struct CriticSummaryItem: Codable, Hashable {
    var publication: String
    var score: Double
    /// The vintage the score's page states; nil when it states none.
    var vintage: Int?
    var sameVintage: Bool
    var trusted: Bool
    /// 1 same vintage + trusted · 2 same vintage · 3 trusted · 4 the rest.
    var tier: Int
    var knownPublication: Bool
    var drinkingWindow: CriticDrinkingWindow?
    var vintageCharacter: VintageRating?
    var deal: Bool
    /// Phase 12.2: where this score sits on the review ladder ("1", "2", "3",
    /// "4", "out"), how many years its page is from the wine, and the badge
    /// when the page names a different bottling. Absent on older backends.
    var rung: String?
    var vintageDelta: Int?
    var bottlingBadge: String?

    enum CodingKeys: String, CodingKey {
        case publication, score, vintage
        case sameVintage = "same_vintage"
        case trusted, tier
        case knownPublication = "known_publication"
        case drinkingWindow = "drinking_window"
        case vintageCharacter = "vintage_character"
        case deal, rung
        case vintageDelta = "vintage_delta"
        case bottlingBadge = "bottling_badge"
    }
}

// MARK: - Review ladder and bottling prompt (Phase 12.2)

/// What each rung of the ladder holds, for the explainer sheet.
struct ReviewLadderRung: Codable, Hashable {
    var tier: String
    var pages: Int
    var scores: Int
    var trustedScores: Int
    var critics: [String]
    var vintages: [Int]

    enum CodingKeys: String, CodingKey {
        case tier, pages, scores, critics, vintages
        case trustedScores = "trusted_scores"
    }
}

/// One stored review page on the ladder. `scores == 0` is a page that was found but gave no score.
struct ReviewLadderPage: Codable, Hashable {
    var slug: String
    var name: String
    var productUrl: String
    var pageVintage: Int?
    var scores: Int

    enum CodingKeys: String, CodingKey {
        case slug, name, scores
        case productUrl = "product_url"
        case pageVintage = "page_vintage"
    }
}

/// The tier a wine's reviews were matched at ("1", "2", "3", "4", "none"),
/// computed once in the backend. The app renders it and never re-derives it.
struct ReviewLadder: Codable, Hashable {
    var tier: String
    var rungs: [ReviewLadderRung]
    var pages: [ReviewLadderPage]?
}

/// Tiers 3 and 4 were "3a" and "3b" until Phase 12.3 (mirrors `normalizeTier`
/// in `shared/utils/review-ladder.ts`). Nothing stored holds a tier, but a
/// backend not restarted since the rename still sends the old names, so they
/// are mapped as they are decoded.
enum LadderTier {
    static func normalize(_ tier: String) -> String {
        switch tier {
        case "3a": return "3"
        case "3b": return "4"
        default: return tier
        }
    }
}

extension ReviewLadder {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tier = LadderTier.normalize(try c.decode(String.self, forKey: .tier))
        rungs = try c.decode([ReviewLadderRung].self, forKey: .rungs)
        pages = try c.decodeIfPresent([ReviewLadderPage].self, forKey: .pages)
    }
}

extension ReviewLadderRung {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tier = LadderTier.normalize(try c.decode(String.self, forKey: .tier))
        pages = try c.decode(Int.self, forKey: .pages)
        scores = try c.decode(Int.self, forKey: .scores)
        trustedScores = try c.decode(Int.self, forKey: .trustedScores)
        critics = try c.decode([String].self, forKey: .critics)
        vintages = try c.decode([Int].self, forKey: .vintages)
    }
}

struct BottlingOption: Codable, Hashable {
    var name: String
    var words: [String]
    var retailers: [String]
    var critics: [String]
    var priceRange: PriceRange?
    var links: [BottlingLink]
    var count: Int

    enum CodingKeys: String, CodingKey {
        case name, words, retailers, critics, links, count
        case priceRange = "price_range"
    }
}

struct BottlingLink: Codable, Hashable {
    var name: String
    var url: String
}

/// "Listings name different bottlings, which is yours?" (WI-2.5): non-nil only
/// when something triggers it and the developer has not answered.
struct BottlingPrompt: Codable, Hashable {
    var reasons: [String]
    var options: [BottlingOption]
    var signature: String
}

/// "Bottling: Les Rugiens · Change" (Phase 12.4 WI-4): non-nil only when the
/// wine was answered (Plain, or a vineyard / cuvée it records) and no prompt is
/// showing. `options` lets Change reopen the sheet.
struct BottlingAnswer: Codable, Hashable {
    var label: String
    var options: [BottlingOption]
}

/// What the price list displays (Phase 12.4 WI-1), computed in the backend:
/// listings more than ±3 vintages from the wine stay stored but aren't shown,
/// and "Other vintages" covers only those that are.
struct PriceWindow: Codable, Hashable {
    var hidden: [String]
    var otherVintagePriceRange: PriceRange?
    /// The rows shown, in display order — nearest, preferred A–Z, others A–Z
    /// (Phase 12.4 WI-3). Nil from an older backend.
    var order: [String]?

    enum CodingKeys: String, CodingKey {
        case hidden, order
        case otherVintagePriceRange = "other_vintage_price_range"
    }
}

/// The price block's one state and line (Phase 12.5 WI-1), computed in the
/// backend. "Checking prices…" and "Couldn't check prices" are request
/// states this app owns; they are never stored.
struct PriceState: Codable, Hashable {
    enum Kind: String, Codable {
        case priced, estimated
        case wideRange = "wide_range"
        case similarVintages = "similar_vintages"
        case noAverage = "no_average"
        case nothingFound = "nothing_found"
    }
    var kind: Kind
    var line: String
    var avg: Double?
    var range: PriceRange?
    /// Slugs the price list shows: priced, within ±3 vintages, in display order.
    var priced: [String]
    /// Slugs that are the exact wine and vintage (WI-4 "Exact match").
    var exact: [String]
}

struct CriticSummary: Codable, Hashable {
    var ordered: [CriticSummaryItem]
}

/// Stored enrichment that was fetched for a different version of the wine
/// (Phase 12.1 WI-1). An unstamped blob is unknown, never stale.
struct EnrichmentStale: Codable, Hashable {
    var price: Bool
    var reviews: Bool
}

/// Why a price lookup that found listings has no average (WI-4); `sentence`
/// is the whole line to show.
struct PriceExclusions: Codable, Hashable {
    var found: Int
    var reasons: [String]
    var sentence: String
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
    /// Phase 12.4 WI-6: `.derived` when inferred for an imported wine.
    var wineColorSource: FieldProvenance?
    var vintageRating: VintageRating?
    var vintageRatingSource: FieldProvenance?
    var myRating: MyRating?
    var myTags: [String]
    var wishlistNotes: String?
    var pricePaid: Double?
    /// The developer's own per-750 ml price (Phase 12.1 D12). When set it is
    /// *the* price everywhere (`EffectivePrice`); the automated figures become
    /// informational. Never written by a fetch.
    var manualPrice: Double?
    var purchasedFrom: String?
    var latestTastingNoteId: String?
    /// Derived server-side from the latest tasting note (Phase 12). Absent
    /// on older backends, hence optional twice over.
    var latestTastingNoteDate: String?

    // Derived server-side on every read (Phase 12.1) — optional because an
    // older backend sends none of them.
    var windowStatus: WindowStatus?
    var criticSummary: CriticSummary?
    var enrichmentStale: EnrichmentStale?
    var priceExclusions: PriceExclusions?
    var reviewLadder: ReviewLadder?
    var bottlingPrompt: BottlingPrompt?
    var bottlingAnswer: BottlingAnswer?
    var priceWindow: PriceWindow?
    var priceState: PriceState?
    /// The developer answered "Plain / no special bottling".
    var bottlingPlain: Bool?

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
        case wineColorSource = "wine_color_source"
        case vintageRating = "vintage_rating"
        case vintageRatingSource = "vintage_rating_source"
        case myRating = "my_rating"
        case myTags = "my_tags"
        case wishlistNotes = "wishlist_notes"
        case pricePaid = "price_paid"
        case manualPrice = "manual_price"
        case purchasedFrom = "purchased_from"
        case latestTastingNoteId = "latest_tasting_note_id"
        case latestTastingNoteDate = "latest_tasting_note_date"
        case windowStatus = "window_status"
        case criticSummary = "critic_summary"
        case enrichmentStale = "enrichment_stale"
        case priceExclusions = "price_exclusions"
        case reviewLadder = "review_ladder"
        case bottlingPrompt = "bottling_prompt"
        case bottlingAnswer = "bottling_answer"
        case priceWindow = "price_window"
        case priceState = "price_state"
        case bottlingPlain = "bottling_plain"
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
    /// The whole slug-keyed map, as the web sends it — the server replaces
    /// rather than merges, so callers merge first.
    var retailerLinks: [String: String]?

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
        case retailerLinks = "retailer_links"
    }
}

/// A field of a PATCH that can be left alone, set, or explicitly cleared
/// (sent as `null`). `WinePatch` omits nil fields, so it can't clear one;
/// the Edit screen needs to (Phase 12.1 WI-1).
enum Edit<Value: Hashable & Encodable>: Hashable {
    case unchanged
    case set(Value)
    case clear

    var isChange: Bool { self != .unchanged }
}

/// `PATCH /api/wines/:id` as the Edit screen sends it: only what changed,
/// with clears sent as `null`. A `drinkingWindow` key — set *or* cleared —
/// is the developer taking over (or handing back) the wine's primary window,
/// so it is only ever sent when the developer touched that field.
struct WineEdit: Encodable, Hashable {
    var producer: Edit<String> = .unchanged
    var denomination: Edit<String> = .unchanged
    var vintage: Edit<Int> = .unchanged
    var region: Edit<String> = .unchanged
    var qualityClassification: Edit<String> = .unchanged
    var vineyard: Edit<String> = .unchanged
    var cuvee: Edit<String> = .unchanged
    var wineColor: Edit<WineColor> = .unchanged
    var manualPrice: Edit<Double> = .unchanged
    var drinkingWindow: Edit<DrinkingWindow> = .unchanged
    var tagDiscovered: Bool?
    var tagWishlist: Bool?
    var tagCellar: Bool?
    var tagConsumed: Bool?
    var cellarQuantity: Int?

    var isEmpty: Bool { self == WineEdit() }

    /// Any of the identity fields — the ones a stored price or critic score
    /// was searched for (`identityKey` on the server).
    var changesIdentity: Bool {
        producer.isChange || denomination.isChange || vintage.isChange
            || qualityClassification.isChange || vineyard.isChange || cuvee.isChange
    }

    enum CodingKeys: String, CodingKey {
        case producer, denomination, vintage, region
        case qualityClassification = "quality_classification"
        case vineyard, cuvee
        case wineColor = "wine_color"
        case manualPrice = "manual_price"
        case drinkingWindow = "drinking_window"
        case tagDiscovered = "tag_discovered"
        case tagWishlist = "tag_wishlist"
        case tagCellar = "tag_cellar"
        case tagConsumed = "tag_consumed"
        case cellarQuantity = "cellar_quantity"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        func put<V>(_ edit: Edit<V>, _ key: CodingKeys) throws {
            switch edit {
            case .unchanged: break
            case .set(let v): try c.encode(v, forKey: key)
            case .clear: try c.encodeNil(forKey: key)
            }
        }
        try put(producer, .producer)
        try put(denomination, .denomination)
        try put(vintage, .vintage)
        try put(region, .region)
        try put(qualityClassification, .qualityClassification)
        try put(vineyard, .vineyard)
        try put(cuvee, .cuvee)
        try put(wineColor, .wineColor)
        try put(manualPrice, .manualPrice)
        try put(drinkingWindow, .drinkingWindow)
        try c.encodeIfPresent(tagDiscovered, forKey: .tagDiscovered)
        try c.encodeIfPresent(tagWishlist, forKey: .tagWishlist)
        try c.encodeIfPresent(tagCellar, forKey: .tagCellar)
        try c.encodeIfPresent(tagConsumed, forKey: .tagConsumed)
        try c.encodeIfPresent(cellarQuantity, forKey: .cellarQuantity)
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
