import Foundation
import Observation

/// App-level state: which backend to talk to, and with which access key.
///
/// Debug builds keep Phase 12's LAN setup (spec D5): the Simulator reaches the
/// Mac as `localhost`, a phone needs the Mac's LAN address, entered once in
/// the Server sheet and kept in `UserDefaults`. Release builds have the
/// production address built in (Phase 13 WI-7, `ServerMode`) and need only
/// this device's access key, kept in the Keychain.
@MainActor
@Observable
final class AppSession {
    private static let defaultsKey = "backendBaseURL"

    /// Why the app is asking for the access key.
    enum AccessKeyPrompt: Equatable {
        /// The server wants a key and this device has none.
        case missing
        /// The stored key was refused (revoked or mistyped); it has been removed.
        case rejected
    }

    let mode: ServerMode
    private(set) var baseURLString: String
    /// This device's access key, mirrored from the Keychain.
    private(set) var accessKey: String?
    /// Set when the server answered 401; the app shows the key screen.
    private(set) var accessKeyPrompt: AccessKeyPrompt?
    /// Set when the server answered 426 (WI-8); the app shows "Update available in TestFlight".
    private(set) var updateRequired = false
    /// Bumped whenever something changes which wines are in which list (a
    /// draft saved, a scan's tags applied), so every list re-issues its GET.
    /// Nothing else observes it — in particular it never triggers enrichment.
    private(set) var collectionRevision = 0
    private let defaults: UserDefaults
    private let keyStore: AccessKeyStore

    init(defaults: UserDefaults = .standard,
         keyStore: AccessKeyStore = KeychainAccessKeyStore(),
         mode: ServerMode = .current) {
        self.defaults = defaults
        self.keyStore = keyStore
        self.mode = mode
        switch mode {
        case .configurable(let fallback):
            baseURLString = defaults.string(forKey: Self.defaultsKey) ?? fallback
        case .fixed(let url):
            baseURLString = url.absoluteString
        }
        accessKey = keyStore.read()
    }

    /// Nil until a usable server address has been set.
    var api: APIClient? {
        guard let url = Self.normalisedURL(baseURLString) else { return nil }
        let key = accessKey
        return APIClient(baseURL: url, accessKey: key, onRefused: { [weak self] refusal in
            Task { @MainActor in self?.handle(refusal, sentKey: key) }
        })
    }

    /// True while the app can't show the tabs: no server address yet (Debug
    /// on a phone), no key yet (Release, which always needs one), or a 401.
    var needsSetup: Bool {
        if api == nil { return true }
        if accessKeyPrompt != nil { return true }
        return mode.isFixed && accessKey == nil
    }

    /// The host shown in "Can't reach the backend at {host}".
    var hostDescription: String {
        Self.normalisedURL(baseURLString)?.host(percentEncoded: false) ?? baseURLString
    }

    /// The list screens' "no response" line. Release has no server to change,
    /// so it has no "Change server" button either.
    var unreachableMessage: String {
        mode.isFixed
            ? "Couldn't reach the server. Check your connection."
            : "Can't reach the backend at \(hostDescription). Check you're on the same network."
    }

    var canChangeServer: Bool { !mode.isFixed }

    /// Which detail-screen disclosure groups are open, per wine, for this
    /// session only — reopening a wine keeps what the user opened; a new
    /// wine starts collapsed; nothing survives a relaunch (spec §8).
    var expandedGroups: [String: Set<DetailGroup>] = [:]

    func collectionChanged() {
        collectionRevision += 1
    }

    func setBaseURL(_ string: String) {
        guard !mode.isFixed else { return }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        baseURLString = trimmed
        defaults.set(trimmed, forKey: Self.defaultsKey)
    }

    /// Saves (or, when blank, removes) the access key and re-fetches every list.
    func setAccessKey(_ string: String) {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        let key = trimmed.isEmpty ? nil : trimmed
        keyStore.write(key)
        accessKey = key
        accessKeyPrompt = nil
        collectionChanged()
    }

    /// "Try again" on the update screen: the server may have lowered its minimum.
    func retryAfterUpdateRequired() {
        updateRequired = false
        collectionChanged()
    }

    /// Mirrors `web/src/components/AccessKeyGate.tsx`: a refused stored key is
    /// dropped and the user is told it wasn't accepted; no key at all is
    /// simply asked for. `sentKey` is the key the refused request carried: a
    /// late 401 for a key that has since been replaced is ignored, so it
    /// can't throw away the new one.
    func handle(_ refusal: APIRefusal, sentKey: String?) {
        switch refusal {
        case .unauthorized:
            guard sentKey == accessKey else { return }
            if accessKey != nil {
                keyStore.write(nil)
                accessKey = nil
                accessKeyPrompt = .rejected
            } else if accessKeyPrompt == nil {
                accessKeyPrompt = .missing
            }
        case .updateRequired:
            updateRequired = true
        }
    }

    /// Accepts `192.168.1.20:3000` as well as a full URL; plain HTTP is the
    /// default because the Debug backend is a local dev server.
    nonisolated static func normalisedURL(_ string: String) -> URL? {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let withScheme = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
        guard let url = URL(string: withScheme), url.host(percentEncoded: false)?.isEmpty == false else { return nil }
        return url
    }
}
