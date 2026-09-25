import XCTest
@testable import WineApp

final class DetailFormattingTests: XCTestCase {
    private func score(_ publication: String, _ start: Int?, _ end: Int?) -> CriticScore {
        CriticScore(publication: publication, score: 94, knownPublication: true,
                    drinkingWindow: CriticDrinkingWindow(start: start, end: end), vintageCharacter: nil, deal: false)
    }

    private func review(_ scores: [CriticScore]) -> RetailerReview {
        RetailerReview(slug: "zachys", name: "Zachys", productUrl: "https://example.com", criticScores: scores,
                       fetchedAt: "", source: .configured, pageVintage: nil, vintageGap: nil, match: nil, pagePrice: nil)
    }

    func testAttributedWindowsGroupAgreeingCriticsAndSkipHalfOpenOnes() {
        let windows = DrinkingWindows.attributed([review([
            score("Burghound", 2029, 2045), score("Vinous", 2029, 2045),
            score("Wine Advocate", 2027, 2040), score("Decanter", 2030, nil),
        ])])
        XCTAssertEqual(windows, [
            AttributedDrinkingWindow(start: 2029, end: 2045, publications: ["Burghound", "Vinous"]),
            AttributedDrinkingWindow(start: 2027, end: 2040, publications: ["Wine Advocate"]),
        ])
        XCTAssertEqual(DrinkingWindows.disagreementNote(windows), "3 critics, 2 different windows")
        XCTAssertNil(DrinkingWindows.disagreementNote(Array(windows.prefix(1))))
    }

    func testAgeMatchesTheWebsCoarseBuckets() {
        let now = day("2026-09-24")
        XCTAssertEqual(DetailFormatting.age("2026-09-24T01:00:00.000Z", now: now), "today")
        XCTAssertEqual(DetailFormatting.age("2026-09-23T00:00:00.000Z", now: now), "yesterday")
        XCTAssertEqual(DetailFormatting.age("2026-09-20T00:00:00.000Z", now: now), "4 days ago")
        XCTAssertEqual(DetailFormatting.age("2026-09-14T00:00:00.000Z", now: now), "last week")
        XCTAssertEqual(DetailFormatting.age("2026-08-24T00:00:00.000Z", now: now), "4 weeks ago")
        XCTAssertEqual(DetailFormatting.age("2026-05-01T00:00:00.000Z", now: now), "4 months ago")
        XCTAssertEqual(DetailFormatting.age("not a date", now: now), "recently")
    }

    func testCriticWindowAllowsHalfOpenRanges() {
        XCTAssertEqual(DetailFormatting.criticWindow(CriticDrinkingWindow(start: 2030, end: nil)), "Drink 2030–?")
        XCTAssertNil(DetailFormatting.criticWindow(CriticDrinkingWindow(start: nil, end: nil)))
    }

    func testExcerptAndMoreNotes() {
        XCTAssertEqual(DetailFormatting.excerpt(String(repeating: "a", count: 201)), String(repeating: "a", count: 200) + "…")
        XCTAssertEqual(DetailFormatting.moreNotes(3), "2 more notes")
        XCTAssertEqual(DetailFormatting.moreNotes(2), "1 more note")
        XCTAssertNil(DetailFormatting.moreNotes(1))
    }
}

final class RetailerTableTests: XCTestCase {
    func testNearestRetailerLeadsTheTable() throws {
        var price = try XCTUnwrap(try Fixture.fullWine.priceData)
        price.nearestRetailer = price.retailers[2]
        XCTAssertEqual(RetailerTable.ordered(price).map(\.slug), ["benchmark", "zachys", "kl"])
    }

    func testBadgeOrderPutsVerificationFirstAndDistanceLast() throws {
        let price = try XCTUnwrap(try Fixture.fullWine.priceData)
        let benchmark = try XCTUnwrap(price.retailers.first { $0.slug == "benchmark" })
        XCTAssertEqual(RetailerTable.badges(benchmark),
                       [.unverified, .vintageMismatch(2018), .format("1.5L"), .distance(21.4)])

        let kl = try XCTUnwrap(price.retailers.first { $0.slug == "kl" })
        XCTAssertEqual(RetailerTable.badges(kl), [.searchOnly, .distance(2570.2)],
                       "unchecked verification renders nothing — absence is the state")
    }
}

final class RetailerNamesTests: XCTestCase {
    func testSlugResolvesFromStoredEnrichmentThenFallsBackToTheSlug() throws {
        let wine = try Fixture.fullWine
        XCTAssertEqual(RetailerNames.name(for: "kl", in: wine), "K&L Wine Merchants")
        XCTAssertEqual(RetailerNames.name(for: "fallback-somewine", in: wine), "somewine.example")
        XCTAssertEqual(RetailerNames.name(for: "nowhere", in: wine), "nowhere")
    }
}

final class EvaluateDraftTests: XCTestCase {
    private func complete() -> EvaluateDraft {
        var d = EvaluateDraft()
        d.clarity = "clear"; d.colourIntensity = "medium"; d.colour = "ruby"
        d.noseCondition = "clean"; d.noseIntensity = "medium_plus"
        d.nosePrimary = "red cherry, violet"; d.noseSecondary = "none"; d.noseTertiary = "forest floor"
        d.sweetness = "dry"; d.acidity = "high"; d.body = "medium"
        d.flavourIntensity = "medium_plus"; d.finish = "long"; d.quality = "very_good"
        return d
    }

    func testEverythingButTanninAndNotesIsRequired() {
        XCTAssertEqual(EvaluateDraft().missing.count, 14)
        XCTAssertTrue(complete().missing.isEmpty, "tannin and notes are optional")
        var d = complete()
        d.colour = "  "
        XCTAssertEqual(d.missing, [.colour])
    }

    func testRatingIsDerivedFromQuality() {
        var d = complete()
        XCTAssertEqual(d.rating, .veryGood)
        d.quality = "flawed"
        XCTAssertEqual(d.rating, .poor)
    }

    func testNoteInputSplitsAromasAndDropsBlankNotes() throws {
        let input = complete().noteInput(wineID: "w1", now: day("2026-09-24"))
        XCTAssertEqual(input.nosePrimaryAromas, ["red cherry", "violet"])
        XCTAssertNil(input.freeText)
        XCTAssertNil(input.palateTannin)
        XCTAssertEqual(input.tastedAt, "2026-09-24T00:00:00Z")

        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        XCTAssertEqual(body["wine_id"] as? String, "w1")
        XCTAssertEqual(body["my_rating"] as? String, "very_good")
        XCTAssertNil(body["tags"], "tags are extracted server-side")
    }

    func testDescriptorTapAppendsOnce() {
        XCTAssertEqual(AromaDescriptors.adding("rose", to: "cherry"), "cherry, rose")
        XCTAssertEqual(AromaDescriptors.adding("rose", to: "cherry, rose"), "cherry, rose")
        XCTAssertEqual(AromaDescriptors.adding("rose", to: ""), "rose")
    }
}
