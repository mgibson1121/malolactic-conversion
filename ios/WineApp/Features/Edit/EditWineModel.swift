import Foundation
import Observation

/// Edit a saved wine (Phase 12.1 WI-1). Identity, colour, "Your price" (D12),
/// a manual drinking window (D2), list tags and bottle quantity — and Delete
/// (WI-3, D5).
///
/// Saving a changed identity field on a wine that already has price or review
/// data asks "Refresh searches now?" (D4), stating the credit cost. The
/// decision of whether the identity *really* changed (casing and punctuation
/// don't count) belongs to the server's single `identityKey`, which the app
/// must not port: the PATCH response says whether stored data is now stale
/// (`enrichment_stale`), and the prompt follows from that. Declining keeps the
/// old data, which the server has by then stamped with the identity it was
/// fetched for, so the price and review sections say it may not match.
@MainActor
@Observable
final class EditWineModel {
    let original: Wine
    var fields: WineFields
    var yourPrice: String
    var windowStart: String
    var windowEnd: String
    var tags: [CardTag: Bool]
    var quantity: Int

    private(set) var isBusy = false
    private(set) var busyMessage: String?
    var error: String?
    /// Set after a save that left stored enrichment stale: the wine as saved,
    /// waiting on the developer's answer to "Refresh searches now?".
    private(set) var pendingRefresh: Wine?
    /// Set by `requestDelete`: how many notes will stay after the wine goes.
    private(set) var deletePreview: Int?

    private let api: APIClient

    init(wine: Wine, api: APIClient) {
        original = wine
        self.api = api
        fields = WineFields(wine)
        yourPrice = wine.manualPrice.map { Self.priceText($0) } ?? ""
        windowStart = wine.drinkingWindow.map { String($0.start.prefix(4)) } ?? ""
        windowEnd = wine.drinkingWindow.map { String($0.end.prefix(4)) } ?? ""
        tags = Dictionary(uniqueKeysWithValues: CardTag.allCases.map { ($0, wine[keyPath: $0.keyPath]) })
        quantity = wine.cellarQuantity
    }

    /// Estimated cost of refreshing both searches, from the measured Phase 9.2
    /// figures (`EnrichmentCosts`).
    static var refreshCostLabel: String {
        let typical = EnrichmentCosts.Kind.price.typical + EnrichmentCosts.Kind.reviews.typical
        let worst = EnrichmentCosts.Kind.price.worstCase + EnrichmentCosts.Kind.reviews.worstCase
        return "about \(typical) credits (up to \(worst))"
    }

    var derivedWindowUntouched: Bool {
        original.drinkingWindowSource == .derived && !windowTouched
    }

    var windowTouched: Bool {
        windowStart != (original.drinkingWindow.map { String($0.start.prefix(4)) } ?? "")
            || windowEnd != (original.drinkingWindow.map { String($0.end.prefix(4)) } ?? "")
    }

    // MARK: Building the PATCH

    enum EditError: Error, Equatable {
        case message(String)
    }

    func buildEdit() -> Result<WineEdit, EditError> {
        var edit = WineEdit()
        edit.producer = Self.textEdit(fields.producer, was: original.producer)
        edit.denomination = Self.textEdit(fields.denomination, was: original.denomination)
        edit.region = Self.textEdit(fields.region, was: original.region)
        edit.qualityClassification = Self.textEdit(fields.qualityClassification, was: original.qualityClassification)
        edit.vineyard = Self.textEdit(fields.vineyard, was: original.vineyard)
        edit.cuvee = Self.textEdit(fields.cuvee, was: original.cuvee)

        if fields.vintageIsInvalid { return .failure(.message("Vintage must be a four-digit year, or blank for NV.")) }
        switch (fields.vintageValue, original.vintage) {
        case (nil, nil): break
        case (nil, .some): edit.vintage = .clear
        case (let v?, let was) where v != was: edit.vintage = .set(v)
        default: break
        }

        if fields.wineColor != original.wineColor {
            edit.wineColor = fields.wineColor.map { .set($0) } ?? .clear
        }

        // Your price: blank clears it; anything else must be a positive
        // amount with at most two decimals (the server's ManualPriceSchema).
        let priceText = yourPrice.trimmed.replacingOccurrences(of: "$", with: "")
        if priceText.isEmpty {
            if original.manualPrice != nil { edit.manualPrice = .clear }
        } else {
            guard let value = Double(priceText), value > 0, abs(value * 100 - (value * 100).rounded()) < 1e-6 else {
                return .failure(.message("Your price must be a positive amount with at most two decimals."))
            }
            if value != original.manualPrice { edit.manualPrice = .set(value) }
        }

        // The drinking window is only sent if the developer touched it. A
        // pre-filled "from critics" value left alone is display only: saving it
        // would turn a derived window into a manual one and silently stop
        // future automatic updates.
        if windowTouched {
            let s = windowStart.trimmed
            let e = windowEnd.trimmed
            if s.isEmpty && e.isEmpty {
                edit.drinkingWindow = .clear
            } else if let start = Int(s), let end = Int(e), s.count == 4, e.count == 4, start <= end {
                edit.drinkingWindow = .set(DrinkingWindow(start: "\(s)-01-01", end: "\(e)-12-31"))
            } else {
                return .failure(.message("Drinking window needs a start and end year (start no later than end), or both blank."))
            }
        }

        for tag in CardTag.allCases where tags[tag] != original[keyPath: tag.keyPath] {
            switch tag {
            case .discovered: edit.tagDiscovered = tags[tag]
            case .wishlist: edit.tagWishlist = tags[tag]
            case .cellar: edit.tagCellar = tags[tag]
            case .consumed: edit.tagConsumed = tags[tag]
            }
        }
        if quantity != original.cellarQuantity { edit.cellarQuantity = max(0, quantity) }
        return .success(edit)
    }

    private static func textEdit(_ text: String, was: String?) -> Edit<String> {
        let now = text.nilIfBlank
        if now == was { return .unchanged }
        return now.map { .set($0) } ?? .clear
    }

    private static func priceText(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(value)
    }

    // MARK: Save

    /// Saves, then — if the edit changed the identity of a wine whose stored
    /// price or reviews are now stale — leaves `pendingRefresh` set for the
    /// "Refresh searches now?" prompt instead of finishing. Returns the wine to
    /// hand back when the screen can close, or nil when it must stay open.
    func save() async -> Wine? {
        error = nil
        switch buildEdit() {
        case .failure(.message(let message)):
            error = message
            return nil
        case .success(let edit):
            guard !edit.isEmpty else { return original }
            isBusy = true
            busyMessage = "Saving…"
            defer { isBusy = false; busyMessage = nil }
            do {
                let saved = try await api.updateWine(id: original.id, edit: edit)
                let stale = saved.enrichmentStale
                if edit.changesIdentity, stale?.price == true || stale?.reviews == true {
                    pendingRefresh = saved
                    return nil
                }
                return saved
            } catch let apiError as APIError {
                error = apiError.message(networkMessage: "Could not save — is the backend running?")
                return nil
            } catch {
                self.error = "Could not save — is the backend running?"
                return nil
            }
        }
    }

    /// "Refresh now": both lookups, hard, once each. The developer was told
    /// the cost. A lookup that fails leaves the saved wine as it was.
    func refreshNow() async -> Wine? {
        guard var wine = pendingRefresh else { return nil }
        isBusy = true
        busyMessage = "Refreshing searches…"
        defer { isBusy = false; busyMessage = nil }
        if let result = try? await api.fetchPrice(wineID: wine.id, force: true) {
            wine = wine.applying(result.wine, from: .price)
        }
        if let result = try? await api.fetchReviews(wineID: wine.id, force: true) {
            wine = wine.applying(result.wine, from: .reviews)
        }
        pendingRefresh = nil
        return wine
    }

    /// "Not now": keep the old data. The server already marked it stale.
    func declineRefresh() -> Wine? {
        defer { pendingRefresh = nil }
        return pendingRefresh
    }

    // MARK: Delete

    func requestDelete() async {
        error = nil
        do {
            deletePreview = try await api.notesKeptOnDelete(id: original.id)
        } catch let apiError as APIError {
            error = apiError.message(networkMessage: "Could not check this wine's notes — is the backend running?")
        } catch {}
    }

    func cancelDelete() { deletePreview = nil }

    func confirmDelete() async -> Bool {
        isBusy = true
        busyMessage = "Deleting…"
        defer { isBusy = false; busyMessage = nil }
        do {
            try await api.deleteWine(id: original.id)
            return true
        } catch let apiError as APIError {
            error = apiError.message(networkMessage: "Could not delete — is the backend running?")
            return false
        } catch {
            return false
        }
    }

    /// "Delete this wine? Its 2 tasting notes stay in Notes, marked 'wine
    /// removed'." — or the short form when there are none.
    static func deleteMessage(notesKept: Int) -> String {
        guard notesKept > 0 else { return "This can't be undone." }
        let noun = notesKept == 1 ? "tasting note stays" : "tasting notes stay"
        return "Its \(notesKept) \(noun) in Notes, marked “wine removed”."
    }
}
