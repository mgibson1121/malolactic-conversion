import Foundation
import Observation

enum ListKind: String, Hashable {
    case cellar, discovered, wishlist, notes

    var title: String {
        switch self {
        case .cellar: return "Cellar"
        case .discovered: return "Discovered"
        case .wishlist: return "Wishlist"
        case .notes: return "Tasting Notes"
        }
    }

    var filter: WineFilter {
        switch self {
        case .cellar: return .cellar
        case .discovered: return .discovered
        case .wishlist: return .wishlist
        case .notes: return .notes
        }
    }
}

/// One tab's list: `GET /api/wines` with the tab filter, the Phase 10.5 `q`
/// search AND-ed on top, and the six-state model. Refreshing re-issues the
/// list GET and nothing else — it never triggers enrichment (spec R4).
@MainActor
@Observable
final class WineListModel: WineRowActionTarget {
    let kind: ListKind
    private(set) var state: LoadState<[Wine]> = .idle
    /// A search is in flight over results already on screen — they stay,
    /// dimmed, rather than being replaced by skeletons (§6.2).
    private(set) var isSearching = false
    private(set) var consecutiveFailures = 0
    var query = ""
    var ratingFilter: MyRating?
    /// A failed swipe/long-press action, shown above the list (§4.3 inline).
    var rowActionError: String?
    /// Notes whose wine has been deleted (Phase 12.1 WI-3) — Notes tab only.
    /// They have no wine row to appear under, so the tab lists them apart.
    private(set) var removedNotes: [TastingNote] = []

    init(kind: ListKind) {
        self.kind = kind
    }

    var filter: WineFilter {
        var filter = kind.filter
        filter.q = query
        if kind == .notes { filter.myRating = ratingFilter }
        return filter
    }

    func load(using api: APIClient) async {
        if state.value == nil { state = .loading } else { isSearching = true }
        defer { isSearching = false }
        do {
            let wines = try await api.listWines(filter)
            state = .from(Self.ordered(wines, for: kind))
            consecutiveFailures = 0
            if kind == .notes { await loadRemovedNotes(using: api) }
        } catch is CancellationError {
            // Superseded by a newer search; that request owns the state.
        } catch let error as APIError {
            state = state.failing(with: error)
            consecutiveFailures += 1
        } catch {
            state = state.failing(with: .network(error.localizedDescription))
            consecutiveFailures += 1
        }
    }

    /// A free GET; a failure just leaves the section as it was — the list
    /// above it is the thing that matters.
    private func loadRemovedNotes(using api: APIClient) async {
        guard let all = try? await api.allTastingNotes() else { return }
        removedNotes = all.filter(\.isWineRemoved)
    }

    /// The removed-wine notes matching the search box (a plain substring over
    /// the identity snapshot and the note text, as the list search does for wines).
    var visibleRemovedNotes: [TastingNote] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return removedNotes.filter { note in
            (ratingFilter == nil || note.myRating == ratingFilter)
                && (q.isEmpty || (note.wineSummary + " " + (note.freeText ?? "")).lowercased().contains(q))
        }
    }

    func replace(_ wine: Wine) {
        guard var wines = state.value, let i = wines.firstIndex(where: { $0.id == wine.id }) else { return }
        wines[i] = wine
        state = .loaded(wines)
    }

    func remove(id: String) {
        guard let wines = state.value else { return }
        state = .from(wines.filter { $0.id != id })
    }

    /// Notes: latest note first (spec §7). Every other tab keeps the server's
    /// order, same as the web.
    static func ordered(_ wines: [Wine], for kind: ListKind) -> [Wine] {
        guard kind == .notes else { return wines }
        return wines.sorted { ($0.latestTastingNoteDate ?? "") > ($1.latestTastingNoteDate ?? "") }
    }

    /// §4.2 — the list's network-level copy, lifted from the web's `App.tsx`.
    static let networkMessage = "Couldn't load wines. Is the backend running?"
}
