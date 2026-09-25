import Foundation

/// The Express API, over `URLSession`. One method per route the app uses;
/// the route list and parameter names follow `web/src/api.ts` so the two
/// clients stay readable side by side.
///
/// Metered routes (`fetchPrice`, `fetchReviews`, `resolveRetailerURL`,
/// `confirmRetailerLink`, `scanLabel`) are never retried here or anywhere
/// else — automatic retry on a paid endpoint is a spending bug (implementation
/// spec §4.4, CLAUDE.md §15).
struct APIClient: Sendable {
    let baseURL: URL
    var session: URLSession = .shared

    // MARK: Wines

    func listWines(_ filter: WineFilter = WineFilter()) async throws -> [Wine] {
        try await send(request("GET", "api/wines", query: filter.queryItems))
    }

    func getWine(id: String) async throws -> Wine {
        try await send(request("GET", "api/wines/\(id)"))
    }

    func createWine(_ input: NewWine) async throws -> Wine {
        try await send(request("POST", "api/wines", json: input))
    }

    func updateWine(id: String, _ patch: WinePatch) async throws -> Wine {
        try await send(request("PATCH", "api/wines/\(id)", json: patch))
    }

    func promoteWine(id: String, tags: PromoteTags) async throws -> Wine {
        try await send(request("POST", "api/wines/\(id)/promote", json: tags))
    }

    /// Rejects with 409 when the wine has a tasting note.
    func deleteWine(id: String) async throws {
        _ = try await perform(request("DELETE", "api/wines/\(id)"))
    }

    /// The free Phase 9.4 duplicate check — a local DB read, no metered call.
    func duplicateCheck(_ scan: LabelScanResult) async throws -> DuplicateOutcome {
        try await send(request("POST", "api/wines/duplicate-check", json: DuplicateCheckRequest(scan)))
    }

    // MARK: Label scan

    /// `jpeg` must already be resized on device (see `LabelImage`).
    func scanLabel(jpeg: Data) async throws -> LabelScanResult {
        let boundary = "WineAppBoundary-\(UUID().uuidString)"
        var req = try request("POST", "api/label-scan")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 60
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"label\"; filename=\"label.jpg\"\r\n".utf8))
        body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
        body.append(jpeg)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        req.httpBody = body
        return try await send(req)
    }

    // MARK: Enrichment (metered)

    func fetchPrice(wineID: String, force: Bool = false) async throws -> EnrichmentResult {
        try await sendEnrichment(request("POST", "api/wines/\(wineID)/fetch-price",
                                         query: enrichmentQuery(force: force, tier: nil)))
    }

    /// `tier: .primary` exists for exactly one caller: the scan path's
    /// auto-fire, once per wine, after the duplicate check.
    func fetchReviews(wineID: String, force: Bool = false, tier: ReviewTier? = nil) async throws -> EnrichmentResult {
        try await sendEnrichment(request("POST", "api/wines/\(wineID)/fetch-reviews",
                                         query: enrichmentQuery(force: force, tier: tier)))
    }

    func resolveRetailerURL(wineID: String, slug: String) async throws -> Wine {
        try await send(request("POST", "api/wines/\(wineID)/resolve-retailer-url", json: ["slug": slug]))
    }

    func confirmRetailerLink(wineID: String, slug: String, url: String) async throws -> Wine {
        try await send(request("POST", "api/wines/\(wineID)/confirm-retailer-link", json: ["slug": slug, "url": url]))
    }

    // MARK: Retailer links (free — URL construction only)

    func retailerLinks(wineID: String) async throws -> [RetailerLink] {
        try await send(request("GET", "api/wines/\(wineID)/retailer-links"))
    }

    // MARK: Tasting notes

    func tastingNotes(wineID: String) async throws -> [TastingNote] {
        try await send(request("GET", "api/tasting-notes/wine/\(wineID)"))
    }

    // MARK: Settings

    func settings() async throws -> AppSettings {
        try await send(request("GET", "api/settings"))
    }

    func updateSettings(_ settings: AppSettings) async throws -> AppSettings {
        try await send(request("PUT", "api/settings", json: settings))
    }

    // MARK: Plumbing

    private func enrichmentQuery(force: Bool, tier: ReviewTier?) -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        if force { items.append(URLQueryItem(name: "force", value: "true")) }
        if let tier { items.append(URLQueryItem(name: "tier", value: tier.rawValue)) }
        return items
    }

    func request(_ method: String, _ path: String, query: [URLQueryItem] = [],
                 json body: (any Encodable)? = nil) throws -> URLRequest {
        var url = baseURL.appending(path: path)
        if !query.isEmpty { url = url.appending(queryItems: query) }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 30
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        return req
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data = try await perform(request)
        return try Self.decode(T.self, from: data)
    }

    private func sendEnrichment(_ request: URLRequest) async throws -> EnrichmentResult {
        let data = try await perform(request)
        return EnrichmentResult(
            wine: try Self.decode(Wine.self, from: data),
            meta: try Self.decode(EnrichmentMeta.self, from: data)
        )
    }

    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    /// Returns the body of a 2xx response; throws `APIError` otherwise.
    /// Cancellation propagates as `CancellationError` so a superseded search
    /// doesn't surface as a failure.
    private func perform(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw APIError.network(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.network("No HTTP response")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.server(status: http.statusCode,
                                  message: APIError.serverMessage(from: data, status: http.statusCode))
        }
        return data
    }
}
