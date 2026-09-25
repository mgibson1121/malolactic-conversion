import SwiftUI

/// The Cellar tab *is* the dashboard (spec D3): widgets on top, the bottle
/// list below them, one vertical scroll, no carousels (§4).
struct CellarDashboardView: View {
    @Environment(AppSession.self) private var session
    @State private var model = CellarDashboardModel()
    @State private var search = WineListModel(kind: .cellar)
    let onScan: () -> Void
    /// Spec D4 — the nav-bar "+" for manual entry.
    let onAddManually: () -> Void
    let onChangeServer: () -> Void

    var body: some View {
        @Bindable var search = search
        NavigationStack {
            ScrollView {
                if isSearching {
                    WineListContent(model: search, onScan: onScan, onChangeServer: onChangeServer, reload: reloadSearch)
                        .padding(.horizontal, Theme.sideMargin)
                } else {
                    if case .stale = model.state { StaleBanner() }
                    dashboard
                        .padding(.horizontal, Theme.sideMargin)
                        .padding(.bottom, 24)
                }
            }
            .background(Theme.bg)
            .navigationTitle("Cellar")
            .searchable(text: $search.query, prompt: "Search Cellar")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: onAddManually) {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Add wine manually")
                }
            }
            .onChange(of: session.collectionRevision) { Task { await reload() } }
            .refreshable {
                if isSearching { await reloadSearch() } else { await reload() }
            }
            .task { if model.state.value == nil { await reload() } }
            .task(id: search.filter) {
                guard isSearching else { return }
                try? await Task.sleep(for: .milliseconds(300))
                if Task.isCancelled { return }
                await reloadSearch()
            }
        }
    }

    private var isSearching: Bool {
        !search.query.trimmingCharacters(in: .whitespaces).isEmpty
    }

    @ViewBuilder
    private var dashboard: some View {
        switch model.state {
        case .idle, .loading:
            VStack(spacing: Theme.widgetGap) {
                ForEach(0..<3, id: \.self) { _ in SkeletonRow() }
            }
        case .empty:
            EmptyView()
        case .failed(let error):
            VStack(spacing: Theme.widgetGap) {
                ScanCTA(action: onScan)
                FullStateErrorView(
                    message: error.isNetwork
                        ? "Can't reach the backend at \(session.hostDescription). Check you're on the same network."
                        : error.message(networkMessage: WineListModel.networkMessage),
                    stillFailing: model.consecutiveFailures > 1,
                    secondaryTitle: error.isNetwork ? "Change server" : nil,
                    secondaryAction: error.isNetwork ? onChangeServer : nil,
                    retry: { Task { await reload() } }
                )
            }
        case .loaded, .stale:
            if let summary = model.summary() {
                widgets(summary)
            }
        }
    }

    @ViewBuilder
    private func widgets(_ summary: CellarSummary) -> some View {
        LazyVStack(alignment: .leading, spacing: Theme.widgetGap) {
            if summary.totalBottles == 0 {
                ScanCTA(action: onScan)
                WidgetCard { EmptyStateView(message: "Nothing in the cellar yet.") }
            } else {
                CapacityWidget(summary: summary, error: model.capacityError) { capacity in
                    guard let api = session.api else { return false }
                    return await model.saveCapacity(capacity, using: api)
                }
                ScanCTA(action: onScan)
                if summary.hasReadinessData {
                    ReadinessWidget(counts: summary.readiness, selection: $model.readinessFilter)
                }
                if !summary.regions.isEmpty {
                    RegionWidget(regions: summary.regions)
                }
                if summary.colours.total > 0 {
                    ColourSplitWidget(counts: summary.colours)
                }
                if !model.recentlyAdded.isEmpty {
                    SectionLabel("Recently added")
                    // Its own container: these wines appear again in the list
                    // below, and a LazyVStack silently drops rows whose IDs
                    // repeat within it.
                    VStack(spacing: Theme.rowGap) {
                        ForEach(model.recentlyAdded) { wine in
                            WineRowView(wine: wine, kind: .cellar)
                        }
                    }
                }
            }

            let listed = model.listedWines()
            SectionLabel(model.readinessFilter.map { "\($0.title) (\(listed.count))" } ?? "In the cellar (\(listed.count))")
            if listed.isEmpty {
                EmptyStateView(message: "No wines here yet.", actionTitle: "Scan a label", action: onScan)
            } else {
                ForEach(listed) { wine in
                    WineRowView(wine: wine, kind: .cellar)
                }
            }
        }
    }

    private func reload() async {
        guard let api = session.api else { return }
        await model.load(using: api)
    }

    private func reloadSearch() async {
        guard let api = session.api else { return }
        await search.load(using: api)
    }
}
