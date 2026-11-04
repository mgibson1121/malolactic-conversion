import Foundation
import Security

/// Where this phone's device access key lives (Phase 13 WI-7, spec D9).
///
/// The cloud backend refuses any `/api` call without
/// `Authorization: Bearer <key>`; each device has its own key, typed once in
/// the Server screen. It is the only credential the app holds (CLAUDE.md §6):
/// never in the repo, never in `UserDefaults`. A protocol so tests can use
/// memory instead of the Keychain.
protocol AccessKeyStore: AnyObject {
    func read() -> String?
    /// `nil` removes the key.
    func write(_ key: String?)
}

/// The Keychain, as one generic-password item. Readable after the first
/// unlock (so a launch from the background still has it) and never synced
/// or restored to another device: a key belongs to this phone.
final class KeychainAccessKeyStore: AccessKeyStore {
    private let service: String
    private let account: String

    init(service: String = "com.mgibson.WineApp.access-key", account: String = "device") {
        self.service = service
        self.account = account
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    func read() -> String? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let key = String(data: data, encoding: .utf8),
              !key.isEmpty
        else { return nil }
        return key
    }

    func write(_ key: String?) {
        SecItemDelete(query as CFDictionary)
        guard let key, !key.isEmpty else { return }
        var item = query
        item[kSecValueData as String] = Data(key.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }
}
