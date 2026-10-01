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

final class RetailerHostTests: XCTestCase {
    func testMatchesTheWebsRule() {
        XCTAssertTrue(RetailerHost.matches("www.klwines.com", "klwines.com"))
        XCTAssertTrue(RetailerHost.matches("shop.klwines.com", "www.klwines.com"))
        XCTAssertTrue(RetailerHost.matches("WWW.Zachys.com", "zachys.com"))
        XCTAssertFalse(RetailerHost.matches("doubleclick.net", "zachys.com"))
        XCTAssertFalse(RetailerHost.matches(nil, "zachys.com"))
    }
}

@MainActor
final class FindReviewsModelTests: XCTestCase {
    func testSavingALinkSendsTheMergedMapNotJustTheNewEntry() async throws {
        StubURLProtocol.requests = []
        var wine = try Fixture.fullWine            // already has kl saved
        wine.retailerLinks = ["kl": "https://www.klwines.com/p/i?i=1592587"]
        StubURLProtocol.response = (200, try JSONEncoder().encode(wine))
        var current = wine
        let model = FindReviewsModel(api: StubURLProtocol.api(), wine: { current }, apply: { current = $0 })

        model.startEditing(RetailerLink(slug: "zachys", name: "Zachys", url: "https://www.zachys.com/search?q=vogue"))
        model.editValue = "https://www.zachys.com/products/amoureuses-2019"
        await model.save("zachys")

        let body = try XCTUnwrap(StubURLProtocol.requests.last?.httpBodyStream.map(Self.readAll) ?? StubURLProtocol.requests.last?.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: [String: String]])
        XCTAssertEqual(json["retailer_links"], [
            "kl": "https://www.klwines.com/p/i?i=1592587",
            "zachys": "https://www.zachys.com/products/amoureuses-2019",
        ], "the server replaces the map, so both links must be sent")
        XCTAssertNil(model.editingSlug)
    }

    func testAFailedConfirmKeepsTheBrowserOpenWithTheWebsCopy() async throws {
        StubURLProtocol.response = (500, Data(#"{"error":"render failed"}"#.utf8))
        let wine = try Fixture.fullWine
        let model = FindReviewsModel(api: StubURLProtocol.api(), wine: { wine }, apply: { _ in })
        let closed = await model.confirm(URL(string: "https://www.zachys.com/p/1")!,
                                         for: RetailerLink(slug: "zachys", name: "Zachys", url: "https://www.zachys.com"))
        XCTAssertFalse(closed)
        XCTAssertEqual(model.confirmError, "Could not save and extract from that link")
    }

    private static func readAll(_ stream: InputStream) -> Data {
        stream.open(); defer { stream.close() }
        var data = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; data.append(buffer, count: n) }
        return data
    }
}
