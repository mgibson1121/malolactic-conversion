import XCTest
@testable import WineApp

/// Answers every request with one canned response, recording what was sent.
final class StubURLProtocol: URLProtocol {
    nonisolated(unsafe) static var response: (status: Int, body: Data) = (200, Data())
    nonisolated(unsafe) static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requests.append(request)
        let http = HTTPURLResponse(url: request.url!, statusCode: Self.response.status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.response.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func api() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return APIClient(baseURL: URL(string: "http://stub.local:3000")!, session: URLSession(configuration: config))
    }
}

@MainActor
final class RowActionsTests: XCTestCase {
    private var model: WineListModel!
    private var wine: Wine!
    private var changes = 0

    override func setUp() async throws {
        StubURLProtocol.requests = []
        wine = try Fixture.fullWine
        model = WineListModel(kind: .cellar)
        StubURLProtocol.response = (200, try JSONEncoder().encode([wine!]))
        await model.load(using: StubURLProtocol.api())
        changes = 0
    }

    private var actions: RowActions {
        RowActions(api: StubURLProtocol.api(), target: model, collectionChanged: { self.changes += 1 })
    }

    func testAFailedQuantityChangeRollsBackAndShowsTheError() async throws {
        StubURLProtocol.response = (500, Data(#"{"error":"database is locked"}"#.utf8))
        await actions.setQuantity(wine, to: 4)

        XCTAssertEqual(model.state.value?.first?.cellarQuantity, 3, "rolled back to the stored value")
        XCTAssertEqual(model.rowActionError, "database is locked")
        XCTAssertEqual(changes, 0)
    }

    func testASuccessfulTagToggleKeepsTheServersAnswer() async throws {
        var saved = wine!
        saved.tagWishlist = true
        StubURLProtocol.response = (200, try JSONEncoder().encode(saved))
        await actions.toggle(wine, .wishlist)

        XCTAssertEqual(model.state.value?.first?.tagWishlist, true)
        XCTAssertNil(model.rowActionError)
        XCTAssertEqual(changes, 1, "other lists are told to re-GET")

        let patch = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(patch.httpMethod, "PATCH")
        let body = try XCTUnwrap(patch.httpBodyStream.map(readAll) ?? patch.httpBody)
        XCTAssertEqual(try JSONSerialization.jsonObject(with: body) as? [String: Bool], ["tag_wishlist": true])
    }

    func testQuantityNeverGoesBelowZero() async {
        var empty = wine!
        empty.cellarQuantity = 0
        await actions.setQuantity(empty, to: -1)
        XCTAssertFalse(StubURLProtocol.requests.contains { $0.httpMethod == "PATCH" }, "no request for a no-op")
    }

    func testDeletingAWineWithANoteSurfacesTheSpecCopy() async {
        StubURLProtocol.response = (409, Data(#"{"error":"Cannot delete a wine that has tasting notes."}"#.utf8))
        let error = await actions.delete(wine)
        XCTAssertEqual(error, "This wine has a tasting note and can't be discarded. Remove it from your lists instead.")
        XCTAssertEqual(model.state.value?.count, 1, "nothing removed")
    }

    func testASuccessfulDeleteRemovesTheRow() async {
        StubURLProtocol.response = (204, Data())
        let error = await actions.delete(wine)
        XCTAssertNil(error)
        guard case .empty = model.state else { return XCTFail("expected .empty, got \(model.state)") }
    }

    private func readAll(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
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
