import Foundation
import Observation

/// One metered button's state — the port of `useEnrichmentAction`
/// (implementation spec §9). One tap shows what's stored (the server
/// declines inside its TTL and says so via `cachedAt`); only a separate,
/// explicit Hard refresh sends `force` and spends credits (Phase 12.1 D6).
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
    /// Called after any change the lists must reflect — list membership,
    /// and any stored enrichment (price, reviews, links). The lists hold
    /// their own copy of each wine, and the detail screen opens from that
    /// copy, so a change not reported here is lost on the next open
    /// (found 2026-10-01: refreshed scores vanished on reopen).
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

    /// Re-reads the wine when the screen opens (a free GET). The screen
    /// opens from the list's copy, which can predate a lookup that finished
    /// after the list loaded — a scan saved before its enrichment landed is
    /// the common case (2026-10-04). Runs before the price-once check, so a
    /// wine priced in the background isn't priced again.
    func reload() async {
        guard let fresh = try? await api.getWine(id: wine.id), fresh != wine else { return }
        wine = fresh
        onChanged()
    }

    /// After a note is saved: the wine's rating, tags and latest note all
    /// changed server-side, so re-read both (free GETs).
    func reloadAfterEvaluate() async {
        if let fresh = try? await api.getWine(id: wine.id) { wine = fresh }
        await loadNotes()
        onChanged()
    }

    /// A wine the server returned from another action on this screen
    /// (a saved link, a confirmed retailer page).
    func apply(_ updated: Wine) {
        wine = updated
        PriceOnce.record(updated.id)
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
            actionError = (error as? APIError)?.message(networkMessage: "Couldn't update. Is the backend running?")
                ?? "Couldn't update. Is the backend running?"
        }
    }

    // MARK: Metered — never retried

    /// Opening a wine that has never been priced prices it, once
    /// (developer decision 2026-09-26). A wine with stored prices makes no
    /// call; refreshing is always a tap.
    func fetchPriceOnceIfNeeded() async {
        guard PriceOnce.claim(wine) else { return }
        await fetchPrice()
    }

    func fetchPrice(force: Bool = false) async {
        PriceOnce.record(wine.id)
        price.isBusy = true
        price.error = nil
        defer { price.isBusy = false }
        do {
            let result = try await api.fetchPrice(wineID: wine.id, force: force)
            wine = wine.applying(result.wine, from: .price)
            price.cachedAt = (result.meta.cached == true) ? result.meta.fetchedAt : nil
            onChanged()
        } catch {
            // The request can fail after the server finished and stored (a
            // dropped connection, a timeout): look before saying "failed".
            if let fresh = await storedSince(price: wine.priceData) {
                wine = wine.applying(fresh, from: .price)
                onChanged()
            } else {
                price.error = "Price lookup failed"
            }
        }
    }

    func fetchReviews(force: Bool = false) async {
        reviews.isBusy = true
        reviews.error = nil
        defer { reviews.isBusy = false }
        do {
            let result = try await api.fetchReviews(wineID: wine.id, force: force)
            wine = wine.applying(result.wine, from: .reviews)
            reviews.cachedAt = (result.meta.cached == true) ? result.meta.fetchedAt : nil
            onChanged()
        } catch {
            if let fresh = await storedSince(reviews: wine.reviewData) {
                wine = wine.applying(fresh, from: .reviews)
                onChanged()
            } else {
                reviews.error = "Couldn't check reviews"
            }
        }
    }

    /// The wine as the server now has it, when its stored price changed since
    /// the request went out — i.e. the lookup completed even though the
    /// response never arrived (Phase 12.4 WI-7). Nil otherwise: then it failed.
    private func storedSince(price before: PriceData?) async -> Wine? {
        guard let fresh = try? await api.getWine(id: wine.id),
              let after = fresh.priceData, after.fetchedAt != before?.fetchedAt else { return nil }
        return fresh
    }

    private func storedSince(reviews before: [RetailerReview]?) async -> Wine? {
        guard let fresh = try? await api.getWine(id: wine.id),
              fresh.reviewData != nil, fresh.reviewData != before else { return nil }
        return fresh
    }

    /// Saves the answer to "Which bottling is yours?" and takes the re-scored
    /// wine the server returns (Phase 12.2). Nothing is fetched.
    func chooseBottling(_ choice: BottlingChoice) async -> BottlingOutcome {
        do {
            let response = try await api.chooseBottling(wineID: wine.id, choice: choice)
            wine = response.wine
            onChanged()
            return .done(Self.line(for: choice, response))
        } catch {
            return .failed("Couldn't save your answer. Try again.")
        }
    }

    static func line(for choice: BottlingChoice, _ response: BottlingChoiceResponse) -> String {
        if choice == .notSure { return "Left as it was. We'll ask again if new bottlings turn up." }
        let line = TierCopy.resultLine(tier: response.result.tier, scores: response.result.scores, trusted: response.result.trustedScores)
        let dup = response.result.duplicate.map { $0.kind != "none" } ?? false
        return dup ? line + " This may match another wine in your cellar." : line
    }

    /// The URL to open for a retailer row. A search-results link is resolved
    /// to its real product page first — one Serper credit, spent only at the
    /// moment of the tap, exactly as `RetailerViewLink` does on the web —
    /// falling back to the search after 3 s so the tap is never stranded.
    func url(for retailer: RetailerPrice) async -> URL? {
        resolving.insert(retailer.slug)
        defer { resolving.remove(retailer.slug) }
        let result = await RetailerLinkResolver.resolve(retailer, wineID: wine.id, api: api)
        if let resolved = result.wine {
            wine = wine.applying(resolved, from: .price)
            onChanged()
        }
        return result.url
    }
}
