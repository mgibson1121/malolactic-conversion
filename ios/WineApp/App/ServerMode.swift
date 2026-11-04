import Foundation

/// Which backend a build talks to (Phase 13 WI-7).
///
/// - **Debug** keeps Phase 12's LAN setup: the Simulator reaches the Mac as
///   `localhost`; a phone asks for the Mac's LAN address once. Its Info.plist
///   (`Info-Debug.plist`) is the only one with `NSAllowsLocalNetworking`.
/// - **Release** (TestFlight) has the production HTTPS address built in, never
///   asks for one, and its Info.plist has no App Transport Security exception,
///   so iOS refuses any cleartext request.
enum ServerMode: Equatable, Sendable {
    /// The address is typed in the Server screen; `fallback` is used until then.
    case configurable(fallback: String)
    /// The address is built in; the Server screen only takes the access key.
    case fixed(URL)

    /// The production backend (spec D10). Not a secret: the access key is.
    static let productionURL = URL(string: "https://malolactic-conversion.fly.dev")!

    static var current: ServerMode {
        #if DEBUG
        #if targetEnvironment(simulator)
        return .configurable(fallback: "http://localhost:3000")
        #else
        return .configurable(fallback: "")
        #endif
        #else
        return .fixed(productionURL)
        #endif
    }

    var isFixed: Bool {
        if case .fixed = self { return true }
        return false
    }
}

/// This build's number (`CFBundleVersion`), sent on every request as
/// `X-App-Build` so the backend can answer 426 to an old build (WI-8).
enum AppBuild {
    static let header = "X-App-Build"

    static var current: String? {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
    }
}
