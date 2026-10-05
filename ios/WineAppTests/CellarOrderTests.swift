import XCTest
@testable import WineApp

/// The cellar list is newest first (developer decision 2026-10-04): the API
/// returns oldest first, which put a bottle just added at the very bottom.
@MainActor
final class CellarOrderTests: XCTestCase {
    override func tearDown() {
        StubURLProtocol.router = nil
    }

    func testTheCellarListIsNewestFirstWhateverOrderTheAPIUses() async throws {
        let base = try XCTUnwrap(JSONSerialization.jsonObject(with: Fixture.data("wine-full")) as? [String: Any])
        func wine(_ id: String, added: String) -> [String: Any] {
            var w = base
            w["id"] = id
            w["date_added"] = added
            w["drinking_window"] = NSNull()
            return w
        }
        // Oldest first, as GET /api/wines returns them.
        let list = try JSONSerialization.data(withJSONObject: [
            wine("old", added: "2026-07-26T20:54:03.880Z"),
            wine("tempier", added: "2026-10-04T23:23:54.449Z"),
            wine("caillou", added: "2026-10-04T23:32:00.000Z"),
        ])
        StubURLProtocol.router = { request in
            request.url!.path == "/api/settings" ? (200, Data(#"{"cellar_capacity":null}"#.utf8)) : (200, list)
        }

        let model = CellarDashboardModel()
        await model.load(using: StubURLProtocol.api())
        XCTAssertEqual(model.listedWines().map(\.id), ["caillou", "tempier", "old"])

        model.readinessFilter = .noWindow
        XCTAssertEqual(model.listedWines().map(\.id), ["caillou", "tempier", "old"], "a readiness filter keeps the order")
    }
}
