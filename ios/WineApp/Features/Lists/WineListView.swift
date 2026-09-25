import SwiftUI

/// Discovered / Wishlist / Notes. Same compressed card and nav pattern as the
/// Cellar list; tab-scoped search, 300 ms debounce (§6.2). A `List` rather
/// than a ScrollView because swipe actions only exist on List rows.
struct WineListView: View {
    @Environment(AppSession.self) private var session
    @State private var model: WineListModel
    @State private var path: [DetailRoute] = []
    @State private var rowSheets = RowSheets()
    let onScan: () -> Void
    let onChangeServer: () -> Void

    init(kind: ListKind, onScan: @escaping () -> Void, onChangeServer: @escaping () -> Void) {
        _model = State(initialValue: WineListModel(kind: kind))
        self.onScan = onScan
        self.onChangeServer = onChangeServer
    }

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $path) {
            List {
                if case .stale = model.state { StaleBanner().cardRow() }
                WineListContent(model: model, onScan: onScan, onChangeServer: onChangeServer, reload: reload,
                                open: { path.append($0) }, sheets: rowSheets)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
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
            .navigationDestination(for: DetailRoute.self) { route in
                if let api = session.api {
                    WineDetailView(route: route, api: api, onChanged: { session.collectionChanged() })
                }
            }
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
            .rowSheets(rowSheets, target: model)
        }
    }

    private func reload() async {
        guard let api = session.api else { return }
        await model.load(using: api)
    }
}

/// The Evaluate sheet and Delete confirmation a card's gestures can open —
/// owned by the list screen, shared by every row on it.
@MainActor
@Observable
final class RowSheets {
    var evaluating: Wine?
    var deleting: Wine?
    var deleteError: String?
}

private struct RowSheetsModifier: ViewModifier {
    @Environment(AppSession.self) private var session
    @Bindable var sheets: RowSheets
    let target: WineRowActionTarget

    func body(content: Content) -> some View {
        content
            .sheet(item: $sheets.evaluating) { wine in
                if let api = session.api {
                    EvaluateFormView(wine: wine, api: api) { session.collectionChanged() }
                }
            }
            .confirmationDialog(
                "Delete \(sheets.deleting.map(WineFormatting.title) ?? "this wine")?",
                isPresented: Binding(get: { sheets.deleting != nil }, set: { if !$0 { sheets.deleting = nil } }),
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    guard let wine = sheets.deleting, let api = session.api else { return }
                    Task {
                        let actions = RowActions(api: api, target: target, collectionChanged: { session.collectionChanged() })
                        sheets.deleteError = await actions.delete(wine)
                    }
                }
            } message: {
                Text("This removes the wine from every list. It can't be undone.")
            }
            .alert("Couldn't delete", isPresented: Binding(get: { sheets.deleteError != nil },
                                                          set: { if !$0 { sheets.deleteError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(sheets.deleteError ?? "")
            }
    }
}

extension View {
    func rowSheets(_ sheets: RowSheets, target: WineRowActionTarget) -> some View {
        modifier(RowSheetsModifier(sheets: sheets, target: target))
    }
}

/// The list rows in every state — used inside a `List`. Shared with the
/// Cellar tab's search results.
struct WineListContent: View {
    let model: WineListModel
    let onScan: () -> Void
    let onChangeServer: () -> Void
    let reload: () async -> Void
    let open: (DetailRoute) -> Void
    let sheets: RowSheets
    @Environment(AppSession.self) private var session

    var body: some View {
        if let error = model.rowActionError {
            Text(error).font(.system(size: 12)).foregroundStyle(Theme.redPill).cardRow()
        }
        switch model.state {
        case .idle:
            EmptyView()
        case .loading:
            ForEach(0..<3, id: \.self) { _ in SkeletonRow().cardRow() }
        case .empty:
            emptyState.cardRow()
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
            .cardRow()
        case .loaded(let wines), .stale(let wines, _):
            let actions = session.api.map {
                RowActions(api: $0, target: model, collectionChanged: { session.collectionChanged() })
            }
            ForEach(wines) { wine in
                WineRowView(wine: wine, kind: model.kind) { focus in
                    open(DetailRoute(wine: wine, focusScores: focus))
                }
                .opacity(model.isSearching ? 0.5 : 1)
                .wineRowActions(wine, kind: model.kind, actions: actions,
                                evaluate: { sheets.evaluating = $0 }, requestDelete: { sheets.deleting = $0 })
                .cardRow()
            }
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
