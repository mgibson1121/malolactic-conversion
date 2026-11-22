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
    /// Follows a search that is running on this wine, including one this screen
    /// did not start (a scan that was saved mid-search): Phase 14 WI-4.
    private let watcher: EnrichmentWatcher
    private var lastReviewsState: JobState?
    private var lastPriceState: JobState?
    /// Called after any change the lists must reflect — list membership,
    /// and any stored enrichment (price, reviews, links). The lists hold
    /// their own copy of each wine, and the detail screen opens from that
    /// copy, so a change not reported here is lost on the next open
    /// (found 2026-10-01: refreshed scores vanished on reopen).
    private let onChanged: () -> Void

    init(wine: Wine, api: APIClient, onChanged: @escaping () -> Void,
         pollInterval: Duration = ScanTiming.pollInterval, watchGrace: Duration = ScanTiming.watchGrace) {
        self.wine = wine
        self.api = api
        self.onChanged = onChanged
        lastReviewsState = wine.enrichmentJob?.reviews?.state
        lastPriceState = wine.enrichmentJob?.price?.state
        watcher = EnrichmentWatcher(interval: pollInterval, startGrace: watchGrace) { id in
            try? await api.getWine(id: id)
        }
        watcher.onWine = { [weak self] in self?.watched($0) }
    }

    /// A review search is running on this wine, started here or elsewhere. The
    /// detail screen shows it as running and will not start a second one.
    var isSearchingReviews: Bool { reviews.isBusy || wine.enrichmentJob?.reviews?.state == .running }

    /// A price lookup is running on this wine, started here or by the scan.
    var isSearchingPrice: Bool { price.isBusy || wine.enrichmentJob?.price?.state == .running }

    /// Called when the screen opens, after `reload`: a wine saved while its scan
    /// was still searching shows that search, not "Not fetched" (Phase 14 F4).
    func watchSearches() {
        if wine.enrichmentJob?.anyRunning == true { watcher.start(wineID: wine.id) }
    }

    private func watched(_ fresh: Wine) {
        guard fresh.id == wine.id else { return }
        wine = wine.applying(fresh, from: .reviews).applying(fresh, from: .price)
        let state = fresh.enrichmentJob?.reviews?.state
        let priceState = fresh.enrichmentJob?.price?.state
        defer { lastReviewsState = state; lastPriceState = priceState }
        // Lists hold their own copy: tell them once a lookup has ended, not on every poll.
        let reviewsEnded = lastReviewsState == .running && state != .running
        let priceEnded = lastPriceState == .running && priceState != .running
        if reviewsEnded || priceEnded { onChanged() }
    }

    func stopWatching() { watcher.stop() }

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
            actionError = (error as? APIError)?.message(networkMessage: NetworkHint.couldnt("update"))
                ?? NetworkHint.couldnt("update")
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

    /// Starts the price lookup, unless one is already running on this wine
    /// (Phase 14 WI-5): a tap, or the open-time price-once, during the scan's
    /// own lookup starts nothing new.
    func fetchPrice(force: Bool = false) async {
        PriceOnce.record(wine.id)
        guard !isSearchingPrice else { return }
        price.isBusy = true
        price.error = nil
        watcher.start(wineID: wine.id)
        defer { price.isBusy = false }
        do {
            let result = try await api.fetchPrice(wineID: wine.id, force: force)
            wine = wine.applying(result.wine, from: .price)
            price.cachedAt = (result.meta.cached == true) ? result.meta.fetchedAt : nil
            lastPriceState = result.wine.enrichmentJob?.price?.state
            if result.wine.enrichmentJob?.anyRunning != true { watcher.stop() }
            onChanged()
        } catch {
            // The request can fail after the server finished and stored (a
            // dropped connection, a timeout), or while it is still working:
            // look before saying "failed".
            if let fresh = await storedSince(price: wine.priceData) {
                wine = wine.applying(fresh, from: .price)
                if fresh.enrichmentJob?.price?.state == .running { watcher.start(wineID: wine.id) }
                onChanged()
            } else {
                price.error = "Price lookup failed"
            }
        }
    }

    /// Starts the review search, unless one is already running on this wine: a
    /// second tap must not start a second search (Phase 14 F5). The button is
    /// disabled then too; this is the same rule where a caller is not the button.
    func fetchReviews(force: Bool = false) async {
        guard !isSearchingReviews else { return }
        reviews.isBusy = true
        reviews.error = nil
        watcher.start(wineID: wine.id)
        defer { reviews.isBusy = false }
        do {
            let result = try await api.fetchReviews(wineID: wine.id, force: force)
            wine = wine.applying(result.wine, from: .reviews)
            reviews.cachedAt = (result.meta.cached == true) ? result.meta.fetchedAt : nil
            lastReviewsState = result.wine.enrichmentJob?.reviews?.state
            // The request returns when the search ends: nothing left to follow.
            if result.wine.enrichmentJob?.anyRunning != true { watcher.stop() }
            onChanged()
        } catch {
            // The request can fail while the search carries on, or after it
            // finished: look at the stored wine before saying "failed".
            if let fresh = await storedSince(reviews: wine.reviewData) {
                wine = wine.applying(fresh, from: .reviews)
                if fresh.enrichmentJob?.reviews?.state == .running { watcher.start(wineID: wine.id) }
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
        guard let fresh = try? await api.getWine(id: wine.id) else { return nil }
        // Still running on the server: the request failed, the lookup did not.
        if fresh.enrichmentJob?.price?.state == .running { return fresh }
        guard let after = fresh.priceData, after.fetchedAt != before?.fetchedAt else { return nil }
        return fresh
    }

    private func storedSince(reviews before: [RetailerReview]?) async -> Wine? {
        guard let fresh = try? await api.getWine(id: wine.id) else { return nil }
        // Still running on the server: the request failed, the search did not.
        if fresh.enrichmentJob?.reviews?.state == .running { return fresh }
        guard fresh.reviewData != nil, fresh.reviewData != before else { return nil }
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
