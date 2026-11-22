import UIKit
import XCTest
@testable import WineApp

/// A scan that misses a Tier 1 field fires no lookup; filling the field in on
/// the review screen fires price and the primary review tier, once
/// (2026-11-15, the Littorai scan with no denomination).
@MainActor
final class ScanFillInTests: XCTestCase {
    private let draftID = "draft-fill"
    private var draftDenomination: String?

    override func setUp() async throws {
        StubURLProtocol.requests = []
        PriceOnce.reset()
        draftDenomination = nil
        StubURLProtocol.router = { [unowned self] request in
            let path = request.url!.path
            switch (request.httpMethod ?? "GET", path) {
            case ("POST", "/api/label-scan"):
                return (200, Data(#"{"producer":"Littorai","vintage":2024,"region":"Sonoma","denomination":null,"quality_classification":null,"vineyard":null,"cuvee":null,"grape_varieties":null,"wine_color":null,"missing_tier1_fields":["denomination"],"raw_response":""}"#.utf8))
            case ("POST", "/api/wines/duplicate-check"):
                return (200, Data(#"{"kind":"none"}"#.utf8))
            case ("POST", "/api/wines"):
                return (201, self.draftJSON())
            case ("PATCH", "/api/wines/\(self.draftID)"):
                if let body = request.bodyData,
                   let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                   let denomination = json["denomination"] as? String {
                    self.draftDenomination = denomination
                }
                return (200, self.draftJSON())
            case ("POST", "/api/wines/\(self.draftID)/promote"):
                return (200, self.draftJSON(promoted: true))
            case (_, let p) where p.hasSuffix("/fetch-price") || p.hasSuffix("/fetch-reviews"):
                return (200, self.draftJSON())
            default:
                return (404, Data(#"{"error":"unrouted \#(path)"}"#.utf8))
            }
        }
    }

    override func tearDown() {
        StubURLProtocol.router = nil
    }

    func testNoLookupUntilTheMissingFieldIsFilledThenExactlyOne() async throws {
        let model = try await reviewScreen()
        XCTAssertTrue(lookups().isEmpty, "a partial identity fires nothing")

        model.fields.denomination = "Sonoma Coast"
        model.identityEdited()
        try await waitUntil { self.lookups().count == 2 }

        XCTAssertEqual(draftDenomination, "Sonoma Coast", "the field is saved to the draft before the search")
        let reviews = try XCTUnwrap(lookups().first { $0.url!.path.hasSuffix("/fetch-reviews") })
        // Phase 14: the scan searches every shop and asks for no tier; nothing is click-gated.
        XCTAssertFalse(reviews.url!.query?.contains("tier") ?? false, "no ?tier=primary: the full search")

        // More edits don't fire again, and neither does Save.
        model.fields.region = "Sonoma County"
        model.identityEdited()
        await model.toggle(.wishlist)
        _ = await model.saveToCollection()
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(lookups().count, 2)
    }

    func testTypingDoesNotFireUntilItPauses() async throws {
        let model = try await reviewScreen(fillInDelay: .milliseconds(300))
        for partial in ["S", "So", "Sonoma", "Sonoma Coast"] {
            model.fields.denomination = partial
            model.identityEdited()
        }
        XCTAssertTrue(lookups().isEmpty)
        try await waitUntil { self.lookups().count == 2 }
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertEqual(lookups().count, 2, "one set of lookups for the whole edit")
    }

    func testSaveBeforeThePauseFiresOnceFromSave() async throws {
        let model = try await reviewScreen(fillInDelay: .seconds(5))
        model.fields.denomination = "Sonoma Coast"
        model.identityEdited()
        await model.toggle(.wishlist)
        _ = await model.saveToCollection()
        try await waitUntil { self.lookups().count == 2 }
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(lookups().count, 2)
    }

    // MARK: helpers

    private func reviewScreen(fillInDelay: Duration = .milliseconds(50)) async throws -> ScanFlowModel {
        let model = ScanFlowModel(api: StubURLProtocol.api(), previewHold: .zero, fillInDelay: fillInDelay)
        model.scan(UIGraphicsImageRenderer(size: CGSize(width: 20, height: 30)).image { _ in })
        try await waitUntil { model.step == .review }
        XCTAssertEqual(model.wine?.id, draftID)
        return model
    }

    private func lookups() -> [URLRequest] {
        StubURLProtocol.requests.filter {
            $0.url!.path.hasSuffix("/fetch-price") || $0.url!.path.hasSuffix("/fetch-reviews")
        }
    }

    private func draftJSON(promoted: Bool = false) -> Data {
        var wine = try! Fixture.fullWine
        wine.promotedAt = promoted ? "2026-11-15T00:00:00.000Z" : nil
        // The draft holds what the scan read, as the real backend's would.
        wine.producer = "Littorai"
        wine.denomination = draftDenomination
        wine.vintage = 2024
        wine.region = "Sonoma"
        wine.qualityClassification = nil
        wine.vineyard = nil
        wine.cuvee = nil
        wine.wineColor = nil
        wine.priceData = nil
        wine.reviewData = nil
        var json = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(wine)) as! [String: Any]
        json["id"] = draftID
        return try! JSONSerialization.data(withJSONObject: json)
    }

    private func waitUntil(_ condition: @escaping () -> Bool, timeout: TimeInterval = 5) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline {
                return XCTFail("timed out; requests: \(StubURLProtocol.requests.map { "\($0.httpMethod ?? "") \($0.url!.path)" })")
            }
            try await Task.sleep(for: .milliseconds(20))
        }
    }
}

private extension URLRequest {
    /// URLProtocol sees a body stream, not `httpBody`.
    var bodyData: Data? {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return nil }
        stream.open(); defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }
}
