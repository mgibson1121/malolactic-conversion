import Foundation
import Observation

/// One metered button's state — the port of `useEnrichmentAction`
/// (implementation spec §9). One tap shows what's stored (the server
/// declines inside its TTL and says so via `cachedAt`); only a second,
/// explicit "Refresh anyway" sends `force` and spends credits.
struct EnrichmentControl: Equatable {
    var isBusy = false
    var error: String?
    /// Set when the last tap returned stored data instead of fetching.
    var cachedAt: String?
}

@MainActor
@Observable
final class WineDetailModel {
    private(set) var wine: Wine
    private(set) var notes: LoadState<[TastingNote]> = .idle
    private(set) var price = EnrichmentControl()
    private(set) var reviews = EnrichmentControl()
    /// Retailer slugs whose search link is being resolved right now.
    private(set) var resolving: Set<String> = []
    /// Inline error under the lists/quantity controls (an Action failure).
    private(set) var actionError: String?

    private let api: APIClient
    /// Called after any change that could move the wine between lists.
    private let onChanged: () -> Void

    init(wine: Wine, api: APIClient, onChanged: @escaping () -> Void) {
        self.wine = wine
        self.api = api
        self.onChanged = onChanged
    }

    // MARK: Reads (free)

    func loadNotes() async {
        guard wine.latestTastingNoteId != nil else {
            notes = .empty
            return
        }
        if notes.value == nil { notes = .loading }
        do {
            notes = .from(try await api.tastingNotes(wineID: wine.id))
        } catch let error as APIError {
            notes = notes.failing(with: error)
        } catch {}
    }

    /// After a note is saved: the wine's rating, tags and latest note all
    /// changed server-side, so re-read both (free GETs).
    func reloadAfterEvaluate() async {
        if let fresh = try? await api.getWine(id: wine.id) { wine = fresh }
        await loadNotes()
        onChanged()
    }

    // MARK: Lists and quantity — optimistic, rolled back on failure (§4.4)

    func toggle(_ keyPath: WritableKeyPath<Wine, Bool>, patch: (Bool) -> WinePatch) async {
        let previous = wine[keyPath: keyPath]
        wine[keyPath: keyPath] = !previous
        await commit(patch(!previous)) { $0[keyPath: keyPath] = previous }
    }

    func changeQuantity(by delta: Int) async {
        let previous = wine.cellarQuantity
        let next = max(0, previous + delta)
        guard next != previous else { return }
        wine.cellarQuantity = next
        await commit(WinePatch(cellarQuantity: next)) { $0.cellarQuantity = previous }
    }

    private func commit(_ patch: WinePatch, rollback: (inout Wine) -> Void) async {
        actionError = nil
        do {
            wine = try await api.updateWine(id: wine.id, patch)
            onChanged()
        } catch {
            rollback(&wine)
            actionError = (error as? APIError)?.message(networkMessage: "Could not update — is the backend running?")
                ?? "Could not update — is the backend running?"
        }
    }

    // MARK: Metered — user-initiated only, never retried

    func fetchPrice(force: Bool = false) async {
        price.isBusy = true
        price.error = nil
        defer { price.isBusy = false }
        do {
            let result = try await api.fetchPrice(wineID: wine.id, force: force)
            wine.priceData = result.wine.priceData
            price.cachedAt = (result.meta.cached == true) ? result.meta.fetchedAt : nil
        } catch {
            price.error = "Price lookup failed"
        }
    }

    func fetchReviews(force: Bool = false) async {
        reviews.isBusy = true
        reviews.error = nil
        defer { reviews.isBusy = false }
        do {
            let result = try await api.fetchReviews(wineID: wine.id, force: force)
            wine.reviewData = result.wine.reviewData
            wine.drinkingWindow = result.wine.drinkingWindow
            wine.drinkingWindowSource = result.wine.drinkingWindowSource
            wine.vintageRating = result.wine.vintageRating
            wine.vintageRatingSource = result.wine.vintageRatingSource
            reviews.cachedAt = (result.meta.cached == true) ? result.meta.fetchedAt : nil
        } catch {
            reviews.error = "Review lookup failed"
        }
    }

    /// The URL to open for a retailer row. A search-results link is resolved
    /// to its real product page first — one Serper credit, spent only at the
    /// moment of the tap, exactly as `RetailerViewLink` does on the web —
    /// falling back to the search after 3 s so the tap is never stranded.
    func url(for retailer: RetailerPrice) async -> URL? {
        let fallback = URL(string: retailer.url)
        guard retailer.isSearchResultsPage else { return fallback }
        resolving.insert(retailer.slug)
        defer { resolving.remove(retailer.slug) }

        let api = self.api
        let wineID = wine.id
        let slug = retailer.slug
        let resolved: Wine? = await withTaskGroup(of: Wine?.self) { group in
            group.addTask { try? await api.resolveRetailerURL(wineID: wineID, slug: slug) }
            group.addTask {
                try? await Task.sleep(for: .seconds(3))
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
        guard let resolved else { return fallback }
        wine.priceData = resolved.priceData
        let url = resolved.priceData?.retailers.first { $0.slug == slug }?.url
        return url.flatMap(URL.init(string:)) ?? fallback
    }
}
