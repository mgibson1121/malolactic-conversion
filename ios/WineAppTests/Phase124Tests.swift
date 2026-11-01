import XCTest
@testable import WineApp

/// Phase 12.4 WI-4: a bottling answer sticks. The backend sends no prompt and
/// a `bottling_answer` instead; the app shows "Bottling: X · Change".
final class BottlingAnswerDecodingTests: XCTestCase {
    func testAnAnsweredWineDecodesItsAnswerAndNoPrompt() throws {
        let wine = try Fixture.decode(Wine.self, "wine-bottling-answered")
        XCTAssertEqual(wine.vineyard, "Castiglione")
        XCTAssertNil(wine.bottlingPrompt)
        let answer = try XCTUnwrap(wine.bottlingAnswer)
        XCTAssertEqual(answer.label, "Castiglione")
        XCTAssertTrue(answer.options.map(\.name).contains("Monvigliero"))
    }

    func testAnUnansweredWineHasNoAnswerRow() throws {
        let wine = try Fixture.decode(Wine.self, "wine-bottling-prompt")
        XCTAssertNotNil(wine.bottlingPrompt)
        XCTAssertNil(wine.bottlingAnswer)
    }

    func testAPriceResponseCarriesTheAnswerAcross() throws {
        let stale = try Fixture.decode(Wine.self, "wine-bottling-prompt")
        let fresh = try Fixture.decode(Wine.self, "wine-bottling-answered")
        XCTAssertEqual(stale.applying(fresh, from: .price).bottlingAnswer, fresh.bottlingAnswer)
    }
}

/// Phase 12.4: colour is a matching dimension. A La Crau Blanc listing for the red.
final class ColourBadgeTests: XCTestCase {
    func testAColourDifferenceSaysWhichColour() {
        let colour = ColourDifference(stated: "blanc", wine: "red")
        XCTAssertEqual(DetailFormatting.bottlingBadge(extra: [], missing: [], colour: colour), "Blanc — yours is red")
        XCTAssertEqual(DetailFormatting.bottlingBadge(extra: ["monvigliero"], missing: []), "Names Monvigliero — yours doesn't")
    }

    func testTheColourDecodesFromAListing() throws {
        let json = Data(#"{"extra":[],"missing":[],"colour":{"stated":"blanc","wine":"red"}}"#.utf8)
        let d = try JSONDecoder().decode(ListingBottlingDifference.self, from: json)
        XCTAssertEqual(d.colour?.stated, "blanc")
        let legacy = try JSONDecoder().decode(ListingBottlingDifference.self, from: Data(#"{"extra":["rocche"],"missing":[]}"#.utf8))
        XCTAssertNil(legacy.colour)
    }
}

/// Phase 12.4 WI-1: one ±3-year display window.
final class SimilarVintageWindowTests: XCTestCase {
    func testThePriceWindowDecodes() throws {
        let json = Data(#"{"hidden":["far-shop"],"other_vintage_price_range":{"min":90,"max":120}}"#.utf8)
        let window = try JSONDecoder().decode(PriceWindow.self, from: json)
        XCTAssertEqual(window.hidden, ["far-shop"])
        XCTAssertEqual(window.otherVintagePriceRange, PriceRange(min: 90, max: 120))
    }

    func testCriticWindowsComeFromTheSummaryWhenThereIsOne() throws {
        let wine = try Fixture.decode(Wine.self, "wine-full")
        let fromSummary = DrinkingWindows.attributed(summary: wine.criticSummary)
        XCTAssertEqual(Set(fromSummary.flatMap(\.publications)).isSubset(of: Set(wine.criticSummary?.ordered.map(\.publication) ?? [])), true)
    }
}

/// Phase 12.4 WI-2: a price-only shop's page that says sold out.
final class SoldOutListingTests: XCTestCase {
    func testASoldOutListingDecodesAndSaysSo() throws {
        let json = Data(#"{"slug":"kermitlynch","name":"Kermit Lynch Wine Merchant","price":105,"url":"https://shop.kermitlynch.com/product/detail/19FVT02","sold_out":true}"#.utf8)
        let r = try JSONDecoder().decode(RetailerPrice.self, from: json)
        XCTAssertEqual(r.soldOut, true)
        XCTAssertEqual(r.price, 105)
    }
}

/// Phase 12.4 WI-7: "failed" only when the lookup failed. A request that
/// errors after the server finished (the phone's timeout, a dropped
/// connection) shows what was stored instead.
@MainActor
final class LookupOutcomeTests: XCTestCase {
    override func tearDown() {
        StubURLProtocol.router = nil
        super.tearDown()
    }

    func testAPriceRequestThatErrorsButStoredShowsTheStoredResultNotFailed() async throws {
        let wine = try Fixture.fullWine
        var stored = wine
        stored.priceData?.fetchedAt = "2026-11-01T12:00:00.000Z"
        stored.priceData?.retailers = []
        let storedJSON = try JSONEncoder().encode(stored)
        StubURLProtocol.requests = []
        StubURLProtocol.router = { request in
            request.httpMethod == "GET" ? (200, storedJSON) : (504, Data(#"{"error":"gateway timeout"}"#.utf8))
        }
        let model = WineDetailModel(wine: wine, api: StubURLProtocol.api(), onChanged: {})

        await model.fetchPrice(force: true)

        XCTAssertNil(model.price.error)
        XCTAssertEqual(model.wine.priceData?.fetchedAt, "2026-11-01T12:00:00.000Z")
        XCTAssertEqual(model.wine.priceData?.retailers.count, 0, "searched, nothing found — not failed")
    }

    func testAPriceRequestThatErrorsAndStoredNothingIsFailed() async throws {
        let wine = try Fixture.fullWine
        let unchanged = try JSONEncoder().encode(wine)
        StubURLProtocol.router = { request in
            request.httpMethod == "GET" ? (200, unchanged) : (503, Data(#"{"error":"no key","outcome":"failed"}"#.utf8))
        }
        let model = WineDetailModel(wine: wine, api: StubURLProtocol.api(), onChanged: {})

        await model.fetchPrice(force: true)

        XCTAssertEqual(model.price.error, "Price lookup failed")
    }

    func testEnrichmentCallsWaitLongerThanTheDefault() {
        XCTAssertGreaterThanOrEqual(APIClient.enrichmentTimeout, 180)
    }
}

/// Phase 12.4 WI-6: an inferred colour decodes with its provenance.
final class WineColourSourceTests: XCTestCase {
    func testADerivedColourDecodes() throws {
        var wine = try Fixture.fullWine
        wine.wineColorSource = .derived
        let round = try JSONDecoder().decode(Wine.self, from: JSONEncoder().encode(wine))
        XCTAssertEqual(round.wineColorSource, .derived)
        let raw = try JSONSerialization.jsonObject(with: JSONEncoder().encode(wine)) as? [String: Any]
        XCTAssertEqual(raw?["wine_color_source"] as? String, "derived")
    }
}

/// Phase 12.5 WI-1: the price state decodes, and the line is the backend's —
/// so web and iOS say the same words.
final class PriceStateDecodingTests: XCTestCase {
    func testEveryKindDecodes() throws {
        for (raw, kind) in [("priced", PriceState.Kind.priced), ("estimated", .estimated), ("wide_range", .wideRange),
                            ("similar_vintages", .similarVintages), ("no_average", .noAverage), ("nothing_found", .nothingFound)] {
            let json = Data(#"{"kind":"\#(raw)","line":"L","avg":null,"range":null,"priced":[],"exact":[]}"#.utf8)
            XCTAssertEqual(try JSONDecoder().decode(PriceState.self, from: json).kind, kind)
        }
    }

    func testTheFullFixtureCarriesTheBackendsLine() throws {
        let wine = try Fixture.fullWine
        let state = try XCTUnwrap(wine.priceState)
        XCTAssertFalse(state.line.isEmpty)
        XCTAssertEqual(Set(state.priced).isSubset(of: Set(wine.priceData?.retailers.map(\.slug) ?? [])), true)
    }
}
