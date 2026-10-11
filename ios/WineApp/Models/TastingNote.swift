import Foundation

// Mirror of `TastingNote` in `shared/types.ts` (WSET, fixed in v1). The
// structured enums are kept as raw strings here: the Evaluate form owns their
// vocabularies, and a list screen only ever reads rating, date, text and tags.

struct TastingNote: Codable, Identifiable, Hashable {
    let id: String
    /// Nil once the wine has been deleted (Phase 12.1 WI-3): the note outlives
    /// the wine and carries its own identity snapshot.
    var wineId: String?
    var wineProducer: String?
    var wineDenomination: String?
    var wineVintage: Int?
    var wineVineyard: String?
    var wineCuvee: String?
    var tastedAt: String

    var clarity: String?
    var colourIntensity: String?
    var colour: String?

    var noseCondition: String?
    var noseIntensity: String?
    var nosePrimaryAromas: [String]
    var noseSecondaryAromas: [String]
    var noseTertiaryAromas: [String]

    var palateSweetness: String?
    var palateAcidity: String?
    /// Nil for white and rosé wines.
    var palateTannin: String?
    var palateBody: String?
    var palateFlavourIntensity: String?
    var palateFinish: String?

    var qualityAssessment: String?
    var myRating: MyRating?
    var freeText: String?
    var tags: [String]

    enum CodingKeys: String, CodingKey {
        case id
        case wineId = "wine_id"
        case wineProducer = "wine_producer"
        case wineDenomination = "wine_denomination"
        case wineVintage = "wine_vintage"
        case wineVineyard = "wine_vineyard"
        case wineCuvee = "wine_cuvee"
        case tastedAt = "tasted_at"
        case clarity
        case colourIntensity = "colour_intensity"
        case colour
        case noseCondition = "nose_condition"
        case noseIntensity = "nose_intensity"
        case nosePrimaryAromas = "nose_primary_aromas"
        case noseSecondaryAromas = "nose_secondary_aromas"
        case noseTertiaryAromas = "nose_tertiary_aromas"
        case palateSweetness = "palate_sweetness"
        case palateAcidity = "palate_acidity"
        case palateTannin = "palate_tannin"
        case palateBody = "palate_body"
        case palateFlavourIntensity = "palate_flavour_intensity"
        case palateFinish = "palate_finish"
        case qualityAssessment = "quality_assessment"
        case myRating = "my_rating"
        case freeText = "free_text"
        case tags
    }
}

extension TastingNote {
    /// The wine this note was written about no longer exists.
    var isWineRemoved: Bool { wineId == nil }

    /// `Georges Roumier · Chambolle-Musigny · 2018`, from the snapshot.
    var wineSummary: String {
        let parts: [String?] = [wineProducer, wineDenomination, wineVintage.map(String.init)]
        let joined = parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        return joined.isEmpty ? "Unknown wine" : joined
    }
}
