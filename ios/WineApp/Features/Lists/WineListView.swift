import SwiftUI

/// Discovered / Wishlist / Notes. Same compressed card and nav pattern as the
/// Cellar list; tab-scoped search, 300 ms debounce (§6.2).
struct WineListView: View {
    @Environment(AppSession.self) private var session
    @State private var model: WineListModel
    let onScan: () -> Void
    let onChangeServer: () -> Void

    init(kind: ListKind, onScan: @escaping () -> Void, onChangeServer: @escaping () -> Void) {
        _model = State(initialValue: WineListModel(kind: kind))
        self.onScan = onScan
        self.onChangeServer = onChangeServer
    }

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            ScrollView {
                if case .stale = model.state { StaleBanner() }
                WineListContent(model: model, onScan: onScan, onChangeServer: onChangeServer, reload: reload)
                    .padding(.horizontal, Theme.sideMargin)
                    .padding(.bottom, 24)
            }
            .background(Theme.bg)
            .navigationTitle(model.kind.title)
            .searchable(text: $model.query, prompt: "Search \(model.kind.title)")
            .toolbar {
                if model.kind == .notes {
                    ToolbarItem(placement: .topBarTrailing) {
                        RatingFilterMenu(selection: $model.ratingFilter)
                    }
                }
            }
            .refreshable { await reload() }
            .onChange(of: session.collectionRevision) { Task { await reload() } }
            // Re-runs on every query/filter change; `.task(id:)` cancels the
            // previous run, which is the debounce and the in-flight cancel.
            .task(id: model.filter) {
                if model.state.value != nil || !model.query.isEmpty {
                    try? await Task.sleep(for: .milliseconds(300))
                    if Task.isCancelled { return }
                }
                await reload()
            }
        }
    }

    private func reload() async {
        guard let api = session.api else { return }
        await model.load(using: api)
    }
}

/// The list body in every state. Shared with the Cellar dashboard.
struct WineListContent: View {
    let model: WineListModel
    let onScan: () -> Void
    let onChangeServer: () -> Void
    let reload: () async -> Void
    @Environment(AppSession.self) private var session

    var body: some View {
        switch model.state {
        case .idle:
            EmptyView()
        case .loading:
            LazyVStack(spacing: Theme.rowGap) {
                ForEach(0..<3, id: \.self) { _ in SkeletonRow() }
            }
        case .empty:
            emptyState
        case .failed(let error):
            FullStateErrorView(
                message: error.isNetwork
                    ? "Can't reach the backend at \(session.hostDescription). Check you're on the same network."
                    : error.message(networkMessage: WineListModel.networkMessage),
                stillFailing: model.consecutiveFailures > 1,
                secondaryTitle: error.isNetwork ? "Change server" : nil,
                secondaryAction: error.isNetwork ? onChangeServer : nil,
                retry: { Task { await reload() } }
            )
        case .loaded(let wines), .stale(let wines, _):
            LazyVStack(spacing: Theme.rowGap) {
                ForEach(wines) { wine in
                    WineRowView(wine: wine, kind: model.kind)
                }
            }
            .opacity(model.isSearching ? 0.5 : 1)
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        let trimmed = model.query.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty {
            EmptyStateView(message: "Nothing in \(model.kind.title) matches \"\(String(trimmed.prefix(24)))\".",
                           actionTitle: "Clear search", action: { model.query = "" })
        } else if model.kind == .notes, let rating = model.ratingFilter {
            EmptyStateView(message: "No \(WineFormatting.rating(rating)) wines in your notes.",
                           actionTitle: "Show all ratings", action: { model.ratingFilter = nil })
        } else if model.kind == .notes || model.kind == .wishlist {
            EmptyStateView(message: "No wines here yet.")
        } else {
            EmptyStateView(message: "No wines here yet.", actionTitle: "Scan a label", action: onScan)
        }
    }
}

private struct RatingFilterMenu: View {
    @Binding var selection: MyRating?

    var body: some View {
        Menu {
            Picker("Rating", selection: $selection) {
                Text("All ratings").tag(MyRating?.none)
                ForEach(MyRating.allCases, id: \.self) { rating in
                    Text(WineFormatting.rating(rating)).tag(MyRating?.some(rating))
                }
            }
        } label: {
            Image(systemName: selection == nil
                  ? "line.3.horizontal.decrease.circle"
                  : "line.3.horizontal.decrease.circle.fill")
                .accessibilityLabel("Filter by rating")
        }
    }
}
