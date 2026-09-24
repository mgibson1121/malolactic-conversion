import Foundation

// Mirror of `TastingNote` in `shared/types.ts` (WSET, fixed in v1). The
// structured enums are kept as raw strings here: the Evaluate form owns their
// vocabularies, and a list screen only ever reads rating, date, text and tags.

struct TastingNote: Codable, Identifiable, Hashable {
    let id: String
    var wineId: String
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
