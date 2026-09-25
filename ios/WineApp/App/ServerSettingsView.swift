import SwiftUI

/// Where the backend lives. LAN-only in Phase 12 (spec D5): the phone must be
/// on the same network as the Mac running `npm run dev:backend`.
struct ServerSettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let isFirstRun: Bool
    @State private var draft = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("192.168.1.20:3000", text: $draft)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Backend address")
                } footer: {
                    Text("The Mac running the wine backend, on this Wi-Fi network. Port 3000 unless you changed it.")
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
                    Button("Save") {
                        session.setBaseURL(draft)
                        if !isFirstRun { dismiss() }
                    }
                    .disabled(AppSession.normalisedURL(draft) == nil)
                }
            }
        }
        .onAppear { draft = session.baseURLString }
    }
}
