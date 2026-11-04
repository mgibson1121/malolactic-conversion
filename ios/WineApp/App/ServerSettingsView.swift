import SwiftUI

/// Where the backend lives and this device's access key.
///
/// Debug: the backend address (LAN-only, Phase 12 D5 — the phone must be on
/// the same network as the Mac running `npm run dev:backend`) plus an optional
/// key, needed only when that backend has `DEVICE_TOKENS` set. Release
/// (Phase 13 WI-7): the address is built in, so only the key is asked for.
struct ServerSettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let isFirstRun: Bool
    @State private var addressDraft = ""
    @State private var keyDraft = ""

    var body: some View {
        NavigationStack {
            Form {
                if session.mode.isFixed {
                    Section("Server") {
                        Text(session.hostDescription)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section {
                        TextField("192.168.1.20:3000", text: $addressDraft)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    } header: {
                        Text("Backend address")
                    } footer: {
                        Text("The Mac running the backend on this Wi-Fi (port 3000).")
                    }
                }
                Section {
                    SecureField(session.accessKey == nil ? "Paste this phone's key" : "Saved", text: $keyDraft)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityLabel("Access key")
                } header: {
                    Text("Access key")
                } footer: {
                    Text(keyFooter)
                        .foregroundStyle(session.accessKeyPrompt == .rejected ? Theme.redPill : .secondary)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Server")
            .toolbar {
                if !isFirstRun {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(!canSave)
                }
            }
        }
        .onAppear { addressDraft = session.baseURLString }
    }

    private var trimmedKey: String { keyDraft.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var keyFooter: String {
        switch session.accessKeyPrompt {
        case .rejected: return "That key wasn't accepted."
        case .missing: return "The server needs this phone's access key."
        case nil: return session.mode.isFixed ? "Each phone has its own key." : "Only needed if the backend asks for one."
        }
    }

    private var canSave: Bool {
        if !session.mode.isFixed, AppSession.normalisedURL(addressDraft) == nil { return false }
        // Release can't be used without a key; a 401 means the server wants a new one.
        // (After a 401 the refused key has already been removed.)
        let keyRequired = session.mode.isFixed || session.accessKeyPrompt != nil
        return !(keyRequired && trimmedKey.isEmpty && session.accessKey == nil)
    }

    private func save() {
        session.setBaseURL(addressDraft)
        // A blank field keeps the saved key.
        if !trimmedKey.isEmpty { session.setAccessKey(trimmedKey) }
        if !isFirstRun { dismiss() }
    }
}
