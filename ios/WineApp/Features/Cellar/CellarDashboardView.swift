import SwiftUI

/// The Cellar tab *is* the dashboard (spec D3): widgets on top, the bottle
/// list below them, one vertical scroll, no carousels (§4). A `List` so the
/// cellar cards can carry swipe actions; each widget is a plain row.
struct CellarDashboardView: View {
    @Environment(AppSession.self) private var session
    @State private var model = CellarDashboardModel()
    @State private var search = WineListModel(kind: .cellar)
    @State private var path: [DetailRoute] = []
    @State private var rowSheets = RowSheets()
    let onScan: () -> Void
    /// Spec D4 — the nav-bar "+" for manual entry.
    let onAddManually: () -> Void
    let onChangeServer: () -> Void

    var body: some View {
        @Bindable var search = search
        NavigationStack(path: $path) {
            List {
                if isSearching {
                    WineListContent(model: search, onScan: onScan, onChangeServer: onChangeServer, reload: reloadSearch,
                                    open: { path.append($0) }, sheets: rowSheets)
                } else {
                    if case .stale = model.state { StaleBanner().cardRow() }
                    dashboard
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
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
            .onChange(of: session.collectionRevision) {
                Task {
                    await reload()
                    if isSearching { await reloadSearch() }
                }
            }
            .navigationDestination(for: DetailRoute.self) { route in
                if let api = session.api {
                    WineDetailView(route: route, api: api, onChanged: { session.collectionChanged() })
                }
            }
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
            // Search results act on the search model; the dashboard's own
            // cards act on the dashboard model.
            .rowSheets(rowSheets, target: isSearching ? search : model)
        }
    }

    private var isSearching: Bool {
        !search.query.trimmingCharacters(in: .whitespaces).isEmpty
    }

    @ViewBuilder
    private var dashboard: some View {
        switch model.state {
        case .idle, .loading:
            ForEach(0..<3, id: \.self) { _ in SkeletonRow().cardRow(bottom: Theme.widgetGap) }
        case .empty:
            EmptyView()
        case .failed(let error):
            ScanCTA(action: onScan).cardRow(bottom: Theme.widgetGap)
            FullStateErrorView(
                message: error.isNetwork
                    ? "Can't reach the backend at \(session.hostDescription). Check you're on the same network."
                    : error.message(networkMessage: WineListModel.networkMessage),
                stillFailing: model.consecutiveFailures > 1,
                secondaryTitle: error.isNetwork ? "Change server" : nil,
                secondaryAction: error.isNetwork ? onChangeServer : nil,
                retry: { Task { await reload() } }
            )
            .cardRow()
        case .loaded, .stale:
            if let summary = model.summary() {
                widgets(summary)
            }
        }
    }

    @ViewBuilder
    private func widgets(_ summary: CellarSummary) -> some View {
        let gap = Theme.widgetGap / 2
        if summary.totalBottles == 0 {
            ScanCTA(action: onScan).cardRow(top: gap, bottom: gap)
            WidgetCard { EmptyStateView(message: "Nothing in the cellar yet.") }.cardRow(top: gap, bottom: gap)
        } else {
            CapacityWidget(summary: summary, error: model.capacityError) { capacity in
                guard let api = session.api else { return false }
                return await model.saveCapacity(capacity, using: api)
            }
            .cardRow(top: gap, bottom: gap)
            ScanCTA(action: onScan).cardRow(top: gap, bottom: gap)
            if summary.hasReadinessData {
                ReadinessWidget(counts: summary.readiness, selection: $model.readinessFilter)
                    .cardRow(top: gap, bottom: gap)
            }
            if !summary.regions.isEmpty {
                RegionWidget(regions: summary.regions).cardRow(top: gap, bottom: gap)
            }
            if summary.colours.total > 0 {
                ColourSplitWidget(counts: summary.colours).cardRow(top: gap, bottom: gap)
            }
            if !model.recentlyAdded.isEmpty {
                SectionLabel("Recently added").cardRow(top: gap, bottom: 0)
                // Its own container: these wines appear again in the list
                // below, and rows whose IDs repeat within one list are
                // silently dropped.
                VStack(spacing: Theme.rowGap) {
                    ForEach(model.recentlyAdded) { wine in
                        WineRowView(wine: wine, kind: .cellar) { focus in
                            path.append(DetailRoute(wine: wine, focusScores: focus))
                        }
                    }
                }
                .cardRow(top: gap, bottom: gap)
            }
        }

        let listed = model.listedWines()
        SectionLabel(model.readinessFilter.map { "\($0.title) (\(listed.count))" } ?? "In the cellar (\(listed.count))")
            .cardRow(top: gap, bottom: 0)
        if let error = model.rowActionError {
            Text(error).font(.system(size: 12)).foregroundStyle(Theme.redPill).cardRow()
        }
        if listed.isEmpty {
            EmptyStateView(message: "No wines here yet.", actionTitle: "Scan a label", action: onScan).cardRow()
        } else {
            let actions = session.api.map {
                RowActions(api: $0, target: model, collectionChanged: { session.collectionChanged() })
            }
            ForEach(listed) { wine in
                WineRowView(wine: wine, kind: .cellar) { focus in
                    path.append(DetailRoute(wine: wine, focusScores: focus))
                }
                .wineRowActions(wine, kind: .cellar, actions: actions,
                                evaluate: { rowSheets.evaluating = $0 }, requestDelete: { rowSheets.deleting = $0 })
                .cardRow()
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
