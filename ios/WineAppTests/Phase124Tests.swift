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
