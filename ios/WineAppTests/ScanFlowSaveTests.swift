import UIKit
import XCTest
@testable import WineApp

/// The whole scan → duplicate → "Add anyway" → Save sequence against a stub
/// backend that answers each route the way the real one does.
@MainActor
final class ScanFlowSaveTests: XCTestCase {
    private var promoted = false
    private var draftID = "draft-3"

    override func setUp() async throws {
        StubURLProtocol.requests = []
        PriceOnce.reset()
        promoted = false
        let existing = try Fixture.fullWine
        var draft = existing
        draft = Self.with(draft) { $0.promotedAt = nil; $0.tagCellar = false; $0.tagDiscovered = false; $0.priceData = nil; $0.reviewData = nil }
        let draftJSON = try JSONSerialization.data(withJSONObject: Self.renamed(draft, id: draftID))
        let scanJSON = Data(#"{"producer":"Sesta di Sopra","vintage":2018,"region":"Tuscany","denomination":"Brunello di Montalcino","quality_classification":null,"vineyard":null,"cuvee":null,"grape_varieties":["Sangiovese"],"wine_color":"red","missing_tier1_fields":[],"raw_response":""}"#.utf8)
        let dupJSON = try JSONSerialization.data(withJSONObject: [
            "kind": "duplicate",
            "wine": try JSONSerialization.jsonObject(with: JSONEncoder().encode(existing)),
        ])
        StubURLProtocol.router = { [unowned self] request in
            let path = request.url!.path
            switch (request.httpMethod ?? "GET", path) {
            case ("POST", "/api/label-scan"): return (200, scanJSON)
            case ("POST", "/api/wines/duplicate-check"): return (200, dupJSON)
            case ("POST", "/api/wines"): return (201, draftJSON)
            case ("POST", "/api/wines/\(self.draftID)/promote"):
                self.promoted = true
                var p = try! JSONDecoder().decode(Wine.self, from: draftJSON)
                p.promotedAt = "2026-09-30T00:00:00.000Z"; p.tagCellar = true
                return (200, try! JSONEncoder().encode(p))
            case ("PATCH", "/api/wines/\(self.draftID)"): return (200, draftJSON)
            case (_, let p) where p.hasSuffix("/fetch-price") || p.hasSuffix("/fetch-reviews"): return (200, draftJSON)
            default: return (404, Data(#"{"error":"unrouted \#(path)"}"#.utf8))
            }
        }
    }

    override func tearDown() {
        StubURLProtocol.router = nil
    }

    func testAddAnywayThenSaveCreatesASeparateWine() async throws {
        let model = ScanFlowModel(api: StubURLProtocol.api())
        model.scan(Self.label())
        try await waitUntil { if case .duplicate = model.step { return true }; return false }

        await model.addAnyway()
        XCTAssertEqual(model.step, .review)
        XCTAssertEqual(model.wine?.id, draftID, "a new draft, not the existing wine")
        XCTAssertTrue(model.isDraft)

        await model.toggle(.cellar)
        XCTAssertTrue(model.tags.tagCellar)
        let saved = await model.saveToCollection()
        XCTAssertNil(model.actionError)
        XCTAssertTrue(saved)
        XCTAssertTrue(promoted)
    }

    // MARK: helpers

    private func waitUntil(_ condition: @escaping () -> Bool, timeout: TimeInterval = 5) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { return XCTFail("timed out; requests: \(StubURLProtocol.requests.map { "\($0.httpMethod ?? "") \($0.url!.path)" })") }
            try await Task.sleep(for: .milliseconds(20))
        }
    }

    private static func label() -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 40, height: 60)).image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 40, height: 60))
        }
    }

    private static func with(_ wine: Wine, _ change: (inout Wine) -> Void) -> Wine {
        var w = wine; change(&w); return w
    }

    private static func renamed(_ wine: Wine, id: String) -> [String: Any] {
        var json = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(wine)) as! [String: Any]
        json["id"] = id
        return json
    }
}
