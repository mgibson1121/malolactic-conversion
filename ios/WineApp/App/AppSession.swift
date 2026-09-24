import Foundation
import Observation

/// App-level state: which backend to talk to. Phase 12 is LAN-only (spec D5),
/// so the base URL is the one thing that has to be configurable — the
/// Simulator reaches the Mac as `localhost`, a phone needs the Mac's LAN
/// address, entered once in the Server sheet and kept in `UserDefaults`.
@MainActor
@Observable
final class AppSession {
    private static let defaultsKey = "backendBaseURL"

    #if targetEnvironment(simulator)
    static let fallbackBaseURL = "http://localhost:3000"
    #else
    static let fallbackBaseURL = ""
    #endif

    private(set) var baseURLString: String
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        baseURLString = defaults.string(forKey: Self.defaultsKey) ?? Self.fallbackBaseURL
    }

    /// Nil until a usable server address has been set.
    var api: APIClient? {
        Self.normalisedURL(baseURLString).map { APIClient(baseURL: $0) }
    }

    /// The host shown in "Can't reach the backend at {host}".
    var hostDescription: String {
        Self.normalisedURL(baseURLString)?.host(percentEncoded: false) ?? baseURLString
    }

    func setBaseURL(_ string: String) {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        baseURLString = trimmed
        defaults.set(trimmed, forKey: Self.defaultsKey)
    }

    /// Accepts `192.168.1.20:3000` as well as a full URL; plain HTTP is the
    /// default because the backend is a local dev server.
    nonisolated static func normalisedURL(_ string: String) -> URL? {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let withScheme = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
        guard let url = URL(string: withScheme), url.host(percentEncoded: false)?.isEmpty == false else { return nil }
        return url
    }
}
