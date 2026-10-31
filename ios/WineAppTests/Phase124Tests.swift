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
