import Foundation
import Observation
import UIKit

/// The editable identity + Tier 2 fields on the draft review and manual-add
/// screens. Strings, because they're bound to text fields; converted to a
/// `WinePatch` / `NewWine` only on save.
struct WineFields: Equatable {
    var producer = ""
    var denomination = ""
    var vintage = ""
    var region = ""
    var qualityClassification = ""
    var vineyard = ""
    var cuvee = ""
    var wineColor: WineColor?

    init() {}

    init(_ scan: LabelScanResult) {
        producer = scan.producer ?? ""
        denomination = scan.denomination ?? ""
        vintage = scan.vintage.map(String.init) ?? ""
        region = scan.region ?? ""
        qualityClassification = scan.qualityClassification ?? ""
        vineyard = scan.vineyard ?? ""
        cuvee = scan.cuvee ?? ""
        wineColor = scan.wineColor
    }

    init(_ wine: Wine) {
        producer = wine.producer ?? ""
        denomination = wine.denomination ?? ""
        vintage = wine.vintage.map(String.init) ?? ""
        region = wine.region ?? ""
        qualityClassification = wine.qualityClassification ?? ""
        vineyard = wine.vineyard ?? ""
        cuvee = wine.cuvee ?? ""
        wineColor = wine.wineColor
    }

    /// Nil for blank, and for anything that isn't a plausible year — the
    /// server rejects a vintage outside 1800…next year with a 400.
    var vintageValue: Int? {
        let trimmed = vintage.trimmingCharacters(in: .whitespaces)
        guard let year = Int(trimmed), (1800...(Calendar.current.component(.year, from: .now) + 1)).contains(year)
        else { return nil }
        return year
    }

    var vintageIsInvalid: Bool {
        !vintage.trimmingCharacters(in: .whitespaces).isEmpty && vintageValue == nil
    }

    /// The web's bar for Continue: something to call the wine by.
    var canSave: Bool {
        !(producer.trimmed.isEmpty && denomination.trimmed.isEmpty) && !vintageIsInvalid
    }

    var newWine: NewWine {
        NewWine(producer: producer.nilIfBlank, vintage: vintageValue, region: region.nilIfBlank,
                denomination: denomination.nilIfBlank, qualityClassification: qualityClassification.nilIfBlank,
                vineyard: vineyard.nilIfBlank, cuvee: cuvee.nilIfBlank, grapeVarieties: nil, wineColor: wineColor)
    }

    /// Only the fields that differ from what the draft row already holds.
    /// Clearing a field is not expressible here (a nil patch field is
    /// omitted, never sent as null) — acceptable on a draft, where the
    /// fields started from the scan.
    func patch(against wine: Wine) -> WinePatch {
        var patch = WinePatch()
        if producer.nilIfBlank != wine.producer, let v = producer.nilIfBlank { patch.producer = v }
        if denomination.nilIfBlank != wine.denomination, let v = denomination.nilIfBlank { patch.denomination = v }
        if vintageValue != wine.vintage, let v = vintageValue { patch.vintage = v }
        if region.nilIfBlank != wine.region, let v = region.nilIfBlank { patch.region = v }
        if qualityClassification.nilIfBlank != wine.qualityClassification, let v = qualityClassification.nilIfBlank {
            patch.qualityClassification = v
        }
        if vineyard.nilIfBlank != wine.vineyard, let v = vineyard.nilIfBlank { patch.vineyard = v }
        if cuvee.nilIfBlank != wine.cuvee, let v = cuvee.nilIfBlank { patch.cuvee = v }
        if wineColor != wine.wineColor, let v = wineColor { patch.wineColor = v }
        return patch
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    var nilIfBlank: String? { trimmed.isEmpty ? nil : trimmed }
}

extension WinePatch {
    var isEmpty: Bool { self == WinePatch() }

    /// The fields a re-fire is judged against (web `IDENTITY_FIELDS`):
    /// changing any of these changes which wine the search is looking for.
    var changesIdentity: Bool {
        producer != nil || denomination != nil || vintage != nil || cuvee != nil || vineyard != nil
    }
}

extension Wine {
    /// All three Tier 1 identity fields present — the precondition for the
    /// scan path's auto-fire (Phase 9.4, WI-6).
    var hasTier1: Bool { producer != nil && denomination != nil && vintage != nil }
}

/// The scan modal's state machine (implementation spec §6.3), mirroring
/// `LabelScanFlow.tsx`: capture → scanning → duplicate check → "Scan
/// successful — pulling details" → draft review, plus manual entry (spec D4)
/// and the unavailable / error exits.
///
/// Enrichment here and on the detail screen share one `EnrichmentControl`
/// per lookup and one `Wine.applying(_:from:)`, so what the review screen
/// shows and what the saved wine shows cannot diverge (Phase 12.1 WI-9).
@MainActor
@Observable
final class ScanFlowModel {
    enum Step: Equatable {
        case capture
        case manual
        case scanning
        case duplicate(existing: Wine, scanned: LabelScanResult, bottling: BottlingDifference?)
        /// The parse succeeded and the draft exists: hold until the first
        /// critic score lands or `previewHold` passes, then show the review.
        case pulling
        case review
        case unavailable(String)
        case error(String)
    }

    private(set) var step: Step
    private(set) var thumbnail: UIImage?
    /// Set 15 s into a scan: "Still going — labels with a lot of text take longer."
    private(set) var isSlow = false

    /// The draft (or, via the duplicate path, the existing wine) under review.
    private(set) var wine: Wine?
    private(set) var missingTier1: Set<String> = []
    private(set) var vintageNotice: String?
    /// The two lookups' state — busy while one runs, an error if it failed,
    /// both clear once it has landed. The same type the detail screen uses.
    private(set) var reviews = EnrichmentControl()
    private(set) var price = EnrichmentControl()
    /// Retailer slugs whose search link is being resolved right now.
    private(set) var resolving: Set<String> = []
    /// Whether the scan path's auto-fire has gone out for this wine.
    private var enrichmentFired = false

    var fields = WineFields()
    var tags = PromoteTags()
    private(set) var isSaving = false
    private(set) var actionError: String?

    private let api: APIClient
    private let previewHold: Duration
    private var scanTask: Task<Void, Never>?
    private var holdTask: Task<Void, Never>?

    /// Called whenever a background price or review lookup lands — even
    /// after the modal has closed. A new wine takes about a minute to enrich,
    /// and a save made sooner reloaded the lists without it, so nothing
    /// showed until a manual refresh (found 2026-10-04: Collina Dalla Valle
    /// was saved four seconds before its price arrived).
    var onEnrichmentLanded: () -> Void = {}

    init(api: APIClient, startManual: Bool = false, previewHold: Duration = ScanTiming.previewHold) {
        self.api = api
        self.previewHold = previewHold
        step = startManual ? .manual : .capture
    }

    var isDraft: Bool { wine?.isDraft ?? true }

    // MARK: Capture → scan

    func scan(_ image: UIImage) {
        thumbnail = image
        isSlow = false
        step = .scanning
        scanTask?.cancel()
        scanTask = Task { await runScan(image) }
    }

    /// A picked file that couldn't be read as an image (existing web copy).
    func rejectImage() {
        step = .error("Please select an image file.")
    }

    private func runScan(_ image: UIImage) async {
        let slowTimer = Task {
            try? await Task.sleep(for: .seconds(15))
            if !Task.isCancelled { isSlow = true }
        }
        defer { slowTimer.cancel() }

        let jpeg = await Task.detached(priority: .userInitiated) { LabelImage.jpegForUpload(image) }.value
        guard let jpeg else {
            step = .error("Please select an image file.")
            return
        }

        let result: LabelScanResult
        do {
            result = try await api.scanLabel(jpeg: jpeg)
        } catch let error as APIError {
            step = Self.scanFailureStep(error)
            return
        } catch {
            return // cancelled
        }
        if Task.isCancelled { return }

        // WI-4 — the free duplicate check, before any row or metered call.
        let outcome: DuplicateOutcome
        do {
            outcome = try await api.duplicateCheck(result)
        } catch let error as APIError {
            step = .error("Scan failed: \(error.message(networkMessage: error.networkDetail))")
            return
        } catch {
            return
        }

        switch outcome {
        case .duplicate(let existing, let bottling):
            pendingScan = result
            step = .duplicate(existing: existing, scanned: result, bottling: bottling)
        case .vintageMismatch(let existing):
            vintageNotice = "You already have the \(existing.vintage.map(String.init) ?? "NV") — this looks like the \(result.vintage.map(String.init) ?? "NV")."
            await createDraft(from: result)
        case .noMatch:
            await createDraft(from: result)
        }
    }

    /// The scan waiting behind a duplicate prompt, for "Add anyway".
    private var pendingScan: LabelScanResult?

    nonisolated static func scanFailureStep(_ error: APIError) -> Step {
        switch error {
        case .server(503, _):
            return .unavailable("Scanning needs an OpenAI key on the backend.")
        case .server(_, let message) where message.contains("IMAGE_FORMAT_UNSUPPORTED"):
            return .error("Couldn't read this image. Try a JPEG.")
        default:
            return .error("Scan failed: \(error.message(networkMessage: error.networkDetail))")
        }
    }

    private func createDraft(from scan: LabelScanResult) async {
        do {
            let draft = try await api.createWine(scan.draftInput)
            wine = draft
            fields = WineFields(scan)
            missingTier1 = Set(scan.missingTier1Fields)
            tags = PromoteTags()
            // Phase 12.1 WI-5 (D8): "Scan successful — pulling details" holds
            // until the first critic score lands or `previewHold` passes.
            // The lookups are never cancelled when the hold ends — the review
            // screen shows "Looking…" for whatever is still pending.
            step = .pulling
            if draft.hasTier1 { fireEnrichment(for: draft, force: false) }
            holdTask?.cancel()
            holdTask = Task { [previewHold] in
                try? await Task.sleep(for: previewHold)
                if !Task.isCancelled { moveToReview() }
            }
        } catch let error as APIError {
            step = .error("Scan failed: \(error.message(networkMessage: error.networkDetail))")
        } catch {}
    }

    /// Ends the interstitial — whichever of "a score landed" and "the hold
    /// ran out" comes first. A no-op once the screen has moved on, so the
    /// loser of the race does nothing.
    private func moveToReview() {
        guard step == .pulling else { return }
        holdTask?.cancel()
        step = .review
    }

    // MARK: Duplicate

    func addAnyway() async {
        guard let scan = pendingScan else { return }
        pendingScan = nil
        step = .scanning
        await createDraft(from: scan)
    }

    /// "Open it" — the existing wine in promoted mode. No draft. Priced
    /// once only if it has never been priced (`PriceOnce`).
    func openExisting(_ existing: Wine) {
        pendingScan = nil
        wine = existing
        fields = WineFields(existing)
        missingTier1 = []
        step = .review
        fetchPriceOnce(existing)
    }

    // MARK: Manual entry (spec D4)

    func startManual() {
        fields = WineFields()
        step = .manual
    }

    /// Creates the draft from typed fields. The manual path never auto-fires
    /// reviews (CLAUDE.md §15); price follows the fetch-once rule.
    func createManualDraft() async {
        isSaving = true
        defer { isSaving = false }
        actionError = nil
        do {
            let draft = try await api.createWine(fields.newWine)
            wine = draft
            missingTier1 = []
            tags = PromoteTags()
            step = .review
            fetchPriceOnce(draft)
        } catch let error as APIError {
            actionError = error.message(networkMessage: "Couldn't save. Is the backend running?")
        } catch {}
    }

    // MARK: Enrichment — the scan path's one sanctioned auto-fire

    /// Price and the primary review tier, fired once, together. Fire-and-forget
    /// in the sense that nothing retries: a failure is shown inline, with a
    /// "Try again" the developer can tap.
    private func fireEnrichment(for draft: Wine, force: Bool) {
        enrichmentFired = true
        PriceOnce.record(draft.id)
        firePrice(draft.id, force: force)
        fireReviews(draft.id, force: force, tier: .primary)
    }

    private func fireReviews(_ id: String, force: Bool, tier: ReviewTier?) {
        reviews.isBusy = true
        reviews.error = nil
        Task {
            do {
                let result = try await api.fetchReviews(wineID: id, force: force, tier: tier)
                guard wine?.id == id else { return }
                wine = wine?.applying(result.wine, from: .reviews)
                reviews.isBusy = false
                onEnrichmentLanded()
                // The first critic score ends the interstitial early (D8).
                if !(wine?.criticSummary?.ordered.isEmpty ?? true) { moveToReview() }
            } catch {
                guard wine?.id == id else { return }
                reviews.isBusy = false
                reviews.error = "Couldn't check reviews"
            }
        }
    }

    /// Price once for a wine that has none (developer decision 2026-09-26).
    private func fetchPriceOnce(_ wine: Wine) {
        guard PriceOnce.claim(wine) else { return }
        firePrice(wine.id, force: false)
    }

    private func firePrice(_ id: String, force: Bool) {
        price.isBusy = true
        price.error = nil
        Task {
            do {
                let result = try await api.fetchPrice(wineID: id, force: force)
                guard wine?.id == id else { return }
                wine = wine?.applying(result.wine, from: .price)
                price.isBusy = false
                onEnrichmentLanded()
            } catch {
                guard wine?.id == id else { return }
                price.isBusy = false
                price.error = "Price lookup failed"
            }
        }
    }

    // MARK: Developer-initiated lookups on the review screen (click-gated)

    /// "Try again" after a failed review lookup — a deliberate tap, not a retry.
    func retryReviews() {
        guard let id = wine?.id, !reviews.isBusy else { return }
        fireReviews(id, force: false, tier: .primary)
    }

    /// "Search more retailers" when the primary tier found nothing: the full
    /// tier, which adds the extended shops. Still a click (CLAUDE.md §15).
    func searchMoreRetailers() {
        guard let id = wine?.id, !reviews.isBusy else { return }
        fireReviews(id, force: false, tier: nil)
    }

    /// "Which bottling is yours?" on the review screen (Phase 12.2).
    func chooseBottling(_ choice: BottlingChoice) async -> BottlingOutcome {
        guard let id = wine?.id else { return .failed("Nothing to save the answer to yet.") }
        do {
            let response = try await api.chooseBottling(wineID: id, choice: choice)
            wine = response.wine
            onEnrichmentLanded()
            return .done(WineDetailModel.line(for: choice, response))
        } catch {
            return .failed("Couldn't save your answer. Try again.")
        }
    }

    func retryPrice() {
        guard let id = wine?.id, !price.isBusy else { return }
        firePrice(id, force: false)
    }

    /// The URL to open for a retailer on the review screen — resolved on tap
    /// exactly as the detail screen does it.
    func url(for retailer: RetailerPrice) async -> URL? {
        guard let id = wine?.id else { return nil }
        resolving.insert(retailer.slug)
        defer { resolving.remove(retailer.slug) }
        let result = await RetailerLinkResolver.resolve(retailer, wineID: id, api: api)
        if let resolved = result.wine, wine?.id == id {
            wine = wine?.applying(resolved, from: .price)
            onEnrichmentLanded()
        }
        return result.url
    }

    // MARK: Save / discard

    /// Draft: PATCH any edits, re-fire if the identity changed (web WI-6
    /// step 5), then promote with the picked lists. Returns true when the
    /// modal should close.
    func saveToCollection() async -> Bool {
        guard let draft = wine, tags.hasAny else { return false }
        isSaving = true
        defer { isSaving = false }
        actionError = nil
        do {
            let patch = fields.patch(against: draft)
            let updated = patch.isEmpty ? draft : try await api.updateWine(id: draft.id, patch)
            let alreadyFired = enrichmentFired
            if updated.hasTier1 && (!alreadyFired || patch.changesIdentity) {
                fireEnrichment(for: updated, force: alreadyFired)
            }
            wine = try await api.promoteWine(id: draft.id, tags: tags)
            return true
        } catch let error as APIError {
            actionError = error.message(networkMessage: "Couldn't save. Is the backend running?")
            return false
        } catch {
            return false
        }
    }

    /// Draft mode: the three-way list picker, local until Save.
    /// Promoted mode (the duplicate path): the tag toggles immediately and is
    /// rolled back if the PATCH fails (implementation spec §4.4).
    func toggle(_ tag: ListTag) async {
        guard var current = wine else { return }
        if current.isDraft {
            tags[keyPath: tag.promoteKeyPath].toggle()
            return
        }
        let previous = current[keyPath: tag.wineKeyPath]
        current[keyPath: tag.wineKeyPath] = !previous
        wine = current
        actionError = nil
        do {
            wine = try await api.updateWine(id: current.id, tag.patch(!previous))
        } catch let error as APIError {
            wine?[keyPath: tag.wineKeyPath] = previous
            actionError = error.message(networkMessage: "Couldn't update. Is the backend running?")
        } catch {
            wine?[keyPath: tag.wineKeyPath] = previous
        }
    }

    func isOn(_ tag: ListTag) -> Bool {
        guard let wine else { return false }
        return wine.isDraft ? tags[keyPath: tag.promoteKeyPath] : wine[keyPath: tag.wineKeyPath]
    }

    /// Deletes the draft. Returns true when the modal should close.
    func discard() async -> Bool {
        scanTask?.cancel()
        holdTask?.cancel()
        guard let draft = wine, draft.isDraft else { return true }
        do {
            try await api.deleteWine(id: draft.id)
            return true
        } catch {
            // Anything else: the 24 h server-side sweep collects the draft.
            return true
        }
    }

    /// Back to capture from an error or the review screen, discarding any
    /// draft made along the way.
    func retake() async {
        if wine?.isDraft == true { _ = await discard() }
        wine = nil
        vintageNotice = nil
        reviews = EnrichmentControl()
        price = EnrichmentControl()
        enrichmentFired = false
        actionError = nil
        step = .capture
    }
}

/// The three lists a wine can be saved into.
enum ListTag: CaseIterable, Hashable {
    case discovered, wishlist, cellar

    var title: String {
        switch self {
        case .discovered: return "Discovered"
        case .wishlist: return "Wishlist"
        case .cellar: return "Cellar"
        }
    }

    var wineKeyPath: WritableKeyPath<Wine, Bool> {
        switch self {
        case .discovered: return \.tagDiscovered
        case .wishlist: return \.tagWishlist
        case .cellar: return \.tagCellar
        }
    }

    var promoteKeyPath: WritableKeyPath<PromoteTags, Bool> {
        switch self {
        case .discovered: return \.tagDiscovered
        case .wishlist: return \.tagWishlist
        case .cellar: return \.tagCellar
        }
    }

    func patch(_ value: Bool) -> WinePatch {
        switch self {
        case .discovered: return WinePatch(tagDiscovered: value)
        case .wishlist: return WinePatch(tagWishlist: value)
        case .cellar: return WinePatch(tagCellar: value)
        }
    }
}

extension APIError {
    /// For the scan screen, where "the request never reached the server" is
    /// best said plainly.
    var networkDetail: String {
        if case .network(let detail) = self { return detail }
        return ""
    }
}
