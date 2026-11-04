import SwiftUI

enum AppTab: Hashable {
    case cellar, discovered, scan, wishlist, notes
}

/// Five-item tab bar (Phase 12 spec §3). Scan is an action, not a
/// destination: selecting it presents the capture modal and leaves the
/// current tab selected, so dismissing returns to where the user was.
struct RootTabView: View {
    @Environment(AppSession.self) private var session
    @State private var selection: AppTab = .cellar
    @State private var isScanning = false
    @State private var isAddingManually = false
    @State private var isEditingServer = false

    var body: some View {
        Group {
            if session.updateRequired {
                UpdateRequiredView()
            } else if session.needsSetup {
                // First run (no address in Debug on a phone, no key in
                // Release) or the server refused this device's key (401).
                ServerSettingsView(isFirstRun: true)
            } else {
                tabs
            }
        }
        .sheet(isPresented: $isEditingServer) {
            ServerSettingsView(isFirstRun: false)
        }
    }

    private var tabs: some View {
        TabView(selection: Binding(
            get: { selection },
            set: { newValue in
                if newValue == .scan { isScanning = true } else { selection = newValue }
            }
        )) {
            Tab("Cellar", systemImage: "square.grid.2x2", value: AppTab.cellar) {
                CellarDashboardView(onScan: { isScanning = true },
                                    onAddManually: { isAddingManually = true },
                                    onChangeServer: { isEditingServer = true })
            }
            Tab("Discovered", systemImage: "circle.circle", value: AppTab.discovered) {
                WineListView(kind: .discovered, onScan: { isScanning = true }, onChangeServer: { isEditingServer = true })
            }
            Tab("Scan", systemImage: "camera.viewfinder", value: AppTab.scan) {
                Color.clear
            }
            Tab("Wishlist", systemImage: "bookmark", value: AppTab.wishlist) {
                WineListView(kind: .wishlist, onScan: { isScanning = true }, onChangeServer: { isEditingServer = true })
            }
            Tab("Notes", systemImage: "list.bullet.rectangle", value: AppTab.notes) {
                WineListView(kind: .notes, onScan: { isScanning = true }, onChangeServer: { isEditingServer = true })
            }
        }
        .overlay(alignment: .bottom) {
            ScanTabButton { isScanning = true }
        }
        .fullScreenCover(isPresented: $isScanning) {
            if let api = session.api { ScanFlowView(api: api) }
        }
        .fullScreenCover(isPresented: $isAddingManually) {
            if let api = session.api { ScanFlowView(api: api, startManual: true) }
        }
    }
}

/// WI-8: the server answered 426 — this build is older than its minimum.
/// Every request would get the same answer, so the whole app waits here.
private struct UpdateRequiredView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "arrow.down.app")
                .font(.system(size: 28))
                .foregroundStyle(Theme.textMuted)
            Text(APIError.updateRequiredMessage)
                .font(.system(size: 15))
                .foregroundStyle(Theme.text)
                .multilineTextAlignment(.center)
            Button("Try again") { session.retryAfterUpdateRequired() }
                .buttonStyle(.bordered)
                .frame(minHeight: Theme.minHitTarget)
        }
        .padding(.horizontal, Theme.sideMargin)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg)
    }
}

/// The raised, accent-filled centre action: 56 pt circle, 3 pt surface ring,
/// lifted 18 pt above the 49 pt bar (implementation spec §1.1). Sits over the
/// system tab item so the whole centre slot stays a single target.
private struct ScanTabButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "camera.viewfinder")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(Circle().fill(Theme.accent))
                .overlay(Circle().stroke(Theme.surface, lineWidth: 3))
                .shadow(color: .black.opacity(0.18), radius: 6, y: 2)
        }
        .buttonStyle(.plain)
        // Circle bottom = bar height (49) + lift (18) − diameter (56).
        .padding(.bottom, 11)
        .accessibilityLabel("Scan a label")
    }
}
