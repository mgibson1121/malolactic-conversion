import XCTest
@testable import WineApp

/// Memory instead of the Keychain, so session tests never touch the real key.
final class MemoryAccessKeyStore: AccessKeyStore {
    var key: String?
    init(_ key: String? = nil) { self.key = key }
    func read() -> String? { key }
    func write(_ key: String?) { self.key = key }
}

/// Phase 13 WI-7 (access key, build configurations) and WI-8 (426).
@MainActor
final class Phase13SessionTests: XCTestCase {
    private var defaults: UserDefaults!

    override func setUp() {
        defaults = UserDefaults(suiteName: "Phase13SessionTests")!
        defaults.removePersistentDomain(forName: "Phase13SessionTests")
    }

    private func release(key: String? = nil) -> (AppSession, MemoryAccessKeyStore) {
        let store = MemoryAccessKeyStore(key)
        return (AppSession(defaults: defaults, keyStore: store, mode: .fixed(ServerMode.productionURL)), store)
    }

    private func debug(key: String? = nil, fallback: String = "http://localhost:3000") -> (AppSession, MemoryAccessKeyStore) {
        let store = MemoryAccessKeyStore(key)
        return (AppSession(defaults: defaults, keyStore: store, mode: .configurable(fallback: fallback)), store)
    }

    func testTheTestHostIsADebugBuildOnLocalhost() {
        XCTAssertEqual(ServerMode.current, .configurable(fallback: "http://localhost:3000"))
    }

    func testReleaseHasTheProductionAddressBuiltInAndIgnoresAnyOther() {
        defaults.set("192.168.1.20:3000", forKey: "backendBaseURL")
        let (session, _) = release()
        XCTAssertEqual(session.api?.baseURL.absoluteString, "https://malolactic-conversion.fly.dev")
        session.setBaseURL("http://evil.example")
        XCTAssertEqual(session.hostDescription, "malolactic-conversion.fly.dev")
        XCTAssertFalse(session.canChangeServer)
        XCTAssertEqual(session.unreachableMessage, "Couldn't reach the server. Check your connection.")
    }

    func testReleaseAsksForTheKeyBeforeAnythingElse() {
        let (session, store) = release()
        XCTAssertTrue(session.needsSetup, "no address step, but no key yet")
        session.setAccessKey("  key-abc  ")
        XCTAssertFalse(session.needsSetup)
        XCTAssertEqual(store.key, "key-abc", "trimmed and stored")
        XCTAssertEqual(session.api?.accessKey, "key-abc")
    }

    func testReleaseWithAStoredKeyGoesStraightToTheApp() {
        let (session, _) = release(key: "stored")
        XCTAssertFalse(session.needsSetup)
    }

    func testDebugNeedsNoKeyAndKeepsTheLANSetup() {
        let (session, _) = debug()
        XCTAssertFalse(session.needsSetup)
        XCTAssertNil(session.api?.accessKey)
        XCTAssertTrue(session.canChangeServer)
        XCTAssertTrue(session.unreachableMessage.contains("localhost"))

        let (phone, _) = debug(fallback: "")
        XCTAssertTrue(phone.needsSetup, "a phone on Debug still asks for the Mac's address")
        phone.setBaseURL("192.168.1.20:3000")
        XCTAssertFalse(phone.needsSetup)
        XCTAssertEqual(phone.api?.baseURL.absoluteString, "http://192.168.1.20:3000")
    }

    func testARefusedStoredKeyIsDroppedAndTheUserToldItWasntAccepted() {
        let (session, store) = release(key: "revoked")
        let before = session.collectionRevision
        session.handle(.unauthorized, sentKey: "revoked")
        XCTAssertNil(store.key, "removed from the Keychain")
        XCTAssertNil(session.accessKey)
        XCTAssertEqual(session.accessKeyPrompt, .rejected)
        XCTAssertTrue(session.needsSetup)

        session.setAccessKey("fresh")
        XCTAssertNil(session.accessKeyPrompt)
        XCTAssertFalse(session.needsSetup)
        XCTAssertGreaterThan(session.collectionRevision, before, "every list re-fetches with the new key")
    }

    func testA401WithNoKeyAsksForOne() {
        let (session, _) = debug()
        session.handle(.unauthorized, sentKey: nil)
        XCTAssertEqual(session.accessKeyPrompt, .missing)
        XCTAssertTrue(session.needsSetup)
    }

    func testALate401ForAReplacedKeyIsIgnored() {
        let (session, store) = release(key: "new")
        session.handle(.unauthorized, sentKey: "old")
        XCTAssertEqual(store.key, "new")
        XCTAssertNil(session.accessKeyPrompt)
    }

    func testA426ShowsTheUpdateScreenUntilTryAgain() {
        let (session, _) = release(key: "k")
        session.handle(.updateRequired(minBuild: 12), sentKey: "k")
        XCTAssertTrue(session.updateRequired)
        session.retryAfterUpdateRequired()
        XCTAssertFalse(session.updateRequired)
    }

    func testTheSessionsClientReportsRefusalsBackToTheSession() async throws {
        let (session, _) = release(key: "revoked")
        let api = try XCTUnwrap(session.api)
        api.onRefused?(.unauthorized)
        // The hop to the main actor is a Task.
        for _ in 0..<20 where session.accessKeyPrompt == nil { await Task.yield() }
        XCTAssertEqual(session.accessKeyPrompt, .rejected)
    }
}

final class Phase13ClientTests: XCTestCase {
    /// What the client reported through `onRefused`.
    private var box = RefusalBox()

    override func setUp() {
        StubURLProtocol.requests = []
        StubURLProtocol.router = nil
        box = RefusalBox()
    }

    private func api(key: String?) -> APIClient {
        var api = StubURLProtocol.api()
        api.accessKey = key
        api.appBuild = "7"
        let box = box
        api.onRefused = { box.append($0) }
        return api
    }

    func testEveryRequestCarriesTheKeyAndTheBuild() async throws {
        StubURLProtocol.response = (200, Data(#"{"draft_ttl_days":30}"#.utf8))
        _ = try? await api(key: "abc").settings()
        let sent = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer abc")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "X-App-Build"), "7")
    }

    func testNoKeyMeansNoAuthorizationHeader() async throws {
        StubURLProtocol.response = (200, Data("[]".utf8))
        _ = try await api(key: nil).listWines()
        let sent = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertNil(sent.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(sent.value(forHTTPHeaderField: "X-App-Build"), "7")
    }

    func testTheBuildNumberComesFromTheBundle() {
        XCTAssertEqual(StubURLProtocol.api().appBuild, Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String)
        XCTAssertNotNil(AppBuild.current)
    }

    func testA401IsReportedAndReadsAsOneSentence() async {
        StubURLProtocol.response = (401, Data(#"{"error":"unauthorized"}"#.utf8))
        do {
            _ = try await api(key: "bad").listWines()
            XCTFail("expected a refusal")
        } catch let error as APIError {
            XCTAssertEqual(error.message(networkMessage: ""), "That access key wasn't accepted.")
        } catch { XCTFail("\(error)") }
        XCTAssertEqual(box.values, [.unauthorized])
    }

    func testA426IsReportedWithTheMinimumBuild() async {
        StubURLProtocol.response = (426, Data(#"{"error":"update_required","min_build":12}"#.utf8))
        do {
            _ = try await api(key: "k").listWines()
            XCTFail("expected a refusal")
        } catch let error as APIError {
            XCTAssertEqual(error.message(networkMessage: ""), "Update available in TestFlight.")
        } catch { XCTFail("\(error)") }
        XCTAssertEqual(box.values, [.updateRequired(minBuild: 12)])
    }

    func testOtherFailuresAreNotRefusals() async {
        StubURLProtocol.response = (500, Data(#"{"error":"database is locked"}"#.utf8))
        _ = try? await api(key: "k").listWines()
        StubURLProtocol.response = (429, Data(#"{"error":"rate_limited"}"#.utf8))
        _ = try? await api(key: "k").listWines()
        XCTAssertEqual(box.values, [])
    }
}

/// Collects refusals from the client's `@Sendable` callback.
final class RefusalBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [APIRefusal] = []
    func append(_ refusal: APIRefusal) { lock.withLock { stored.append(refusal) } }
    var values: [APIRefusal] { lock.withLock { stored } }
}

/// App Transport Security per configuration (WI-7). Debug's Info-Debug.plist
/// allows cleartext to local hosts; Release's Info.plist has no exception.
/// Measured 2026-11-03 on a Release build: iOS refuses cleartext to a named
/// host (-1022) but, even with no exception, still lets `localhost`, IP
/// addresses and `.local` names try. And any `*.dev` host is upgraded to
/// HTTPS by iOS's built-in HSTS list, so it can't show the refusal either.
/// Hence `example.com`. Run the Release half with
/// `xcodebuild test -configuration Release ENABLE_TESTABILITY=YES …`.
final class TransportSecurityTests: XCTestCase {
    private func cleartextError(_ url: String) async -> URLError? {
        let session = URLSession(configuration: .ephemeral)
        var request = URLRequest(url: URL(string: url)!)
        request.timeoutInterval = 5
        do {
            _ = try await session.data(for: request)
            return nil
        } catch {
            return error as? URLError
        }
    }

    func testCleartextToANamedHostIsRefused() async {
        let error = await cleartextError("http://example.com/")
        XCTAssertEqual(error?.code, .appTransportSecurityRequiresSecureConnection)
    }

    #if DEBUG
    func testDebugReachesTheLocalBackendInCleartext() async {
        // Port 9 (discard): nothing listens, so the request fails to connect — but ATS lets it try.
        let error = await cleartextError("http://localhost:9/healthz")
        XCTAssertNotEqual(error?.code, .appTransportSecurityRequiresSecureConnection)
    }
    #endif

    func testOnlyDebugCarriesALocalNetworkingException() {
        let ats = Bundle.main.object(forInfoDictionaryKey: "NSAppTransportSecurity") as? [String: Any]
        #if DEBUG
        XCTAssertEqual(ats?["NSAllowsLocalNetworking"] as? Bool, true)
        #else
        XCTAssertNil(ats, "Release has no ATS exception at all")
        #endif
    }
}

final class KeychainAccessKeyStoreTests: XCTestCase {
    /// An unsigned build (CI's `CODE_SIGNING_ALLOWED=NO`) has no Keychain
    /// entitlement, so every Keychain call fails with -34018. Signed builds —
    /// Xcode's own Simulator runs and every TestFlight build — have one.
    private func requireKeychain() throws {
        let probe: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: "com.mgibson.WineApp.tests",
                                    kSecAttrAccount as String: "probe"]
        SecItemDelete(probe as CFDictionary)
        var item = probe
        item[kSecValueData as String] = Data("x".utf8)
        let status = SecItemAdd(item as CFDictionary, nil)
        SecItemDelete(probe as CFDictionary)
        if status == errSecMissingEntitlement { throw XCTSkip("Keychain needs a signed build (unsigned test run)") }
        XCTAssertEqual(status, errSecSuccess)
    }

    func testRoundTripAndRemove() throws {
        try requireKeychain()
        let store = KeychainAccessKeyStore(service: "com.mgibson.WineApp.tests", account: "roundtrip")
        store.write(nil)
        XCTAssertNil(store.read())
        store.write("first")
        store.write("second")
        XCTAssertEqual(store.read(), "second", "a second write replaces the first")
        store.write(nil)
        XCTAssertNil(store.read())
    }
}

/// Failed-request copy fits the build (developer, 2026-11-03): Release talks
/// to the cloud, so it never mentions "the backend".
final class NetworkHintTests: XCTestCase {
    func testReleaseAsksAboutTheConnection() {
        let release = ServerMode.fixed(ServerMode.productionURL)
        XCTAssertEqual(NetworkHint.couldnt("save", mode: release), "Couldn't save. Check your connection.")
        XCTAssertFalse(NetworkHint.hint(for: release).contains("backend"))
    }

    func testDebugStillAsksAboutTheBackend() {
        let debug = ServerMode.configurable(fallback: "http://localhost:3000")
        XCTAssertEqual(NetworkHint.couldnt("load wines", mode: debug), "Couldn't load wines. Is the backend running?")
    }

    func testTheTestHostIsDebugSoTheDefaultIsTheBackendHint() {
        XCTAssertEqual(NetworkHint.couldnt("delete"), "Couldn't delete. Is the backend running?")
    }
}
