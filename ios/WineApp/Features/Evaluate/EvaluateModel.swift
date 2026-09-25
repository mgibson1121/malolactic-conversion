import Foundation
import Observation

/// One WSET vocabulary: the raw values `shared/validation.ts` accepts, in
/// order, with the web form's labels (`EvaluateForm.tsx`).
struct WSETScale: Hashable {
    let values: [String]
    let labels: [String: String]

    func label(_ value: String) -> String {
        labels[value] ?? value.replacingOccurrences(of: "_", with: " ").capitalized
    }

    static let clarity = WSETScale(values: ["clear", "hazy"], labels: [:])
    static let colourIntensity = WSETScale(values: ["pale", "medium", "deep"], labels: [:])
    static let noseCondition = WSETScale(values: ["clean", "unclean"], labels: [:])
    static let intensity = WSETScale(
        values: ["light", "medium", "medium_plus", "pronounced"],
        labels: ["light": "Light", "medium": "Medium", "medium_plus": "Medium+", "pronounced": "Pronounced"])
    static let sweetness = WSETScale(
        values: ["dry", "off_dry", "medium_dry", "medium", "medium_sweet", "sweet", "luscious"],
        labels: ["dry": "Dry", "off_dry": "Off-dry", "medium_dry": "Medium-dry", "medium": "Medium",
                 "medium_sweet": "Medium-sweet", "sweet": "Sweet", "luscious": "Luscious"])
    static let structure = WSETScale(
        values: ["low", "medium_minus", "medium", "medium_plus", "high"],
        labels: ["low": "Low", "medium_minus": "Medium−", "medium": "Medium", "medium_plus": "Medium+", "high": "High"])
    static let body = WSETScale(values: ["light", "medium", "full"], labels: [:])
    static let finish = WSETScale(values: ["short", "medium", "long"], labels: [:])
    static let quality = WSETScale(
        values: ["flawed", "poor", "acceptable", "good", "very_good", "outstanding"],
        labels: ["flawed": "Flawed", "poor": "Poor", "acceptable": "Acceptable",
                 "good": "Good", "very_good": "Very Good", "outstanding": "Outstanding"])
}

/// WSET Section 7 descriptor prompts, as on the web — tap to append.
enum AromaDescriptors {
    static let primary: KeyValuePairs<String, [String]> = [
        "Red fruit": ["raspberry", "strawberry", "red cherry", "cranberry", "redcurrant"],
        "Black fruit": ["blackcurrant", "blackberry", "black cherry", "blueberry", "plum"],
        "Stone fruit": ["peach", "apricot", "nectarine", "cherry", "plum"],
        "Tropical fruit": ["pineapple", "mango", "passion fruit", "lychee", "banana"],
        "Citrus fruit": ["lemon", "lime", "grapefruit", "orange zest"],
        "Floral": ["rose", "violet", "jasmine", "orange blossom", "elderflower"],
        "Herbaceous": ["green pepper", "grass", "tomato leaf", "eucalyptus", "mint"],
        "Spice": ["black pepper", "white pepper", "liquorice"],
    ]
    static let secondary: KeyValuePairs<String, [String]> = [
        "Yeast-derived": ["bread", "brioche", "biscuit", "pastry", "cream"],
        "Malolactic": ["butter", "cream", "crème fraîche", "yoghurt"],
        "Other fermentation": ["beer", "cider", "cheese rind", "nail polish"],
    ]
    static let tertiary: KeyValuePairs<String, [String]> = [
        "Oak-derived": ["vanilla", "clove", "coconut", "cedar", "sandalwood", "smoke", "toast", "coffee", "chocolate"],
        "Oxidative": ["almond", "hazelnut", "walnut", "marzipan", "toffee", "caramel", "dried fruit"],
        "Bottle age (red)": ["leather", "tobacco", "forest floor", "mushroom", "truffle", "game", "earth", "dried herbs"],
        "Bottle age (white)": ["petrol", "honey", "ginger", "toast", "nutty", "waxy", "lanolin"],
    ]

    /// Appends `term` to a comma-separated list unless it's already there.
    static func adding(_ term: String, to list: String) -> String {
        var terms = split(list)
        if !terms.contains(term) { terms.append(term) }
        return terms.joined(separator: ", ")
    }

    static func split(_ list: String) -> [String] {
        list.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
}

/// The form's fields. Every field is required except tannin (nil for most
/// whites and rosés) and the free-text notes — the web's rule, unchanged.
struct EvaluateDraft: Equatable {
    var clarity: String?
    var colourIntensity: String?
    var colour = ""
    var noseCondition: String?
    var noseIntensity: String?
    var nosePrimary = ""
    var noseSecondary = ""
    var noseTertiary = ""
    var sweetness: String?
    var acidity: String?
    var tannin: String?
    var body: String?
    var flavourIntensity: String?
    var finish: String?
    var quality: String?
    var notes = ""

    enum Field: String, CaseIterable {
        case clarity = "Clarity", colourIntensity = "Color Intensity", colour = "Color"
        case noseCondition = "Nose Condition", noseIntensity = "Nose Intensity"
        case nosePrimary = "Primary Aromas", noseSecondary = "Secondary Aromas", noseTertiary = "Tertiary Aromas"
        case sweetness = "Sweetness", acidity = "Acidity", body = "Body"
        case flavourIntensity = "Flavour Intensity", finish = "Finish", quality = "Quality Assessment"
    }

    var missing: [Field] {
        var m: [Field] = []
        if clarity == nil { m.append(.clarity) }
        if colourIntensity == nil { m.append(.colourIntensity) }
        if colour.trimmed.isEmpty { m.append(.colour) }
        if noseCondition == nil { m.append(.noseCondition) }
        if noseIntensity == nil { m.append(.noseIntensity) }
        if nosePrimary.trimmed.isEmpty { m.append(.nosePrimary) }
        if noseSecondary.trimmed.isEmpty { m.append(.noseSecondary) }
        if noseTertiary.trimmed.isEmpty { m.append(.noseTertiary) }
        if sweetness == nil { m.append(.sweetness) }
        if acidity == nil { m.append(.acidity) }
        if body == nil { m.append(.body) }
        if flavourIntensity == nil { m.append(.flavourIntensity) }
        if finish == nil { m.append(.finish) }
        if quality == nil { m.append(.quality) }
        return m
    }

    /// `my_rating` is derived from the quality assessment — flawed → poor,
    /// the rest 1:1 — so the form asks one question, not two.
    var rating: MyRating? {
        guard let quality else { return nil }
        return quality == "flawed" ? .poor : MyRating(rawValue: quality)
    }

    func noteInput(wineID: String, now: Date = .now) -> NewTastingNote {
        NewTastingNote(
            wineId: wineID,
            tastedAt: ISO8601DateFormatter().string(from: now),
            clarity: clarity, colourIntensity: colourIntensity, colour: colour.nilIfBlank,
            noseCondition: noseCondition, noseIntensity: noseIntensity,
            nosePrimaryAromas: AromaDescriptors.split(nosePrimary),
            noseSecondaryAromas: AromaDescriptors.split(noseSecondary),
            noseTertiaryAromas: AromaDescriptors.split(noseTertiary),
            palateSweetness: sweetness, palateAcidity: acidity, palateTannin: tannin, palateBody: body,
            palateFlavourIntensity: flavourIntensity, palateFinish: finish,
            qualityAssessment: quality, myRating: rating, freeText: notes.nilIfBlank
        )
    }
}

/// Body for `POST /api/tasting-notes`. `tags` is left for the server, which
/// extracts them from aromas and notes (one GPT-4o call, at save time only).
struct NewTastingNote: Encodable, Hashable {
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
    var palateTannin: String?
    var palateBody: String?
    var palateFlavourIntensity: String?
    var palateFinish: String?
    var qualityAssessment: String?
    var myRating: MyRating?
    var freeText: String?

    enum CodingKeys: String, CodingKey {
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
    }
}

struct ReviewTags: Equatable {
    var discovered: Bool
    var wishlist: Bool
    var cellar: Bool
    var consumed: Bool
}

/// The Evaluate sheet: the WSET form, then — once the note is saved and the
/// server has set Consumed — a review of the wine's list tags (web flow).
@MainActor
@Observable
final class EvaluateModel {
    enum Step: Equatable { case form, tagReview }

    let wine: Wine
    var draft = EvaluateDraft()
    private(set) var step: Step = .form
    /// Set on the first Save attempt; missing fields only highlight after it.
    private(set) var attempted = false
    private(set) var isSaving = false
    private(set) var error: String?
    /// Consumed is already true on the server once a note exists.
    var tags: ReviewTags

    private let api: APIClient

    init(wine: Wine, api: APIClient) {
        self.wine = wine
        self.api = api
        tags = ReviewTags(discovered: wine.tagDiscovered, wishlist: wine.tagWishlist,
                          cellar: wine.tagCellar, consumed: true)
    }

    func isMissing(_ field: EvaluateDraft.Field) -> Bool {
        attempted && draft.missing.contains(field)
    }

    func save() async {
        attempted = true
        guard draft.missing.isEmpty else { return }
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            _ = try await api.createTastingNote(draft.noteInput(wineID: wine.id))
            step = .tagReview
        } catch {
            self.error = "Failed to save. Is the backend running?"
        }
    }

    /// Applies the reviewed tags. Always finishes — the note is already
    /// saved, so a failed tag update shouldn't trap the user in the sheet.
    func finishTagReview() async {
        isSaving = true
        defer { isSaving = false }
        _ = try? await api.updateWine(id: wine.id, WinePatch(
            tagDiscovered: tags.discovered, tagWishlist: tags.wishlist,
            tagCellar: tags.cellar, tagConsumed: tags.consumed))
    }
}
