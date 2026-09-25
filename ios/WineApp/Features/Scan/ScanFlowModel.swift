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
/// `LabelScanFlow.tsx`: capture → scanning → duplicate check → draft review,
/// plus manual entry (spec D4) and the unavailable / error exits.
@MainActor
@Observable
final class ScanFlowModel {
    enum Step: Equatable {
        case capture
        case manual
        case scanning
        case duplicate(existing: Wine)
        case review
        case unavailable(String)
        case error(String)
    }

    enum AutoFire: Equatable {
        case notFired, running, finished, failed
    }

    private(set) var step: Step
    private(set) var thumbnail: UIImage?
    /// Set 15 s into a scan: "Still going — labels with a lot of text take longer."
    private(set) var isSlow = false

    /// The draft (or, via the duplicate path, the existing wine) under review.
    private(set) var wine: Wine?
    private(set) var missingTier1: Set<String> = []
    private(set) var vintageNotice: String?
    /// Whether this review arrived by the fresh-scan path, the only path whose
    /// reviews block auto-fires.
    private(set) var reviewsAutoFire: AutoFire = .notFired
    private(set) var priceAutoFire: AutoFire = .notFired

    var fields = WineFields()
    var tags = PromoteTags()
    private(set) var isSaving = false
    private(set) var actionError: String?

    private let api: APIClient
    private var scanTask: Task<Void, Never>?

    init(api: APIClient, startManual: Bool = false) {
        self.api = api
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
        case .duplicate(let existing):
            pendingScan = result
            step = .duplicate(existing: existing)
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
            return .unavailable("Label scanning is unavailable — OPENAI_API_KEY is not configured on the backend.")
        case .server(_, let message) where message.contains("IMAGE_FORMAT_UNSUPPORTED"):
            return .error("This image format couldn't be processed. Please save the photo as a JPEG and try again.")
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
            step = .review
            if draft.hasTier1 { fireEnrichment(for: draft, force: false) }
        } catch let error as APIError {
            step = .error("Scan failed: \(error.message(networkMessage: error.networkDetail))")
        } catch {}
    }

    // MARK: Duplicate

    func addAnyway() async {
        guard let scan = pendingScan else { return }
        pendingScan = nil
        step = .scanning
        await createDraft(from: scan)
    }

    /// "Open it" — the existing wine in promoted mode. No draft, no metered call.
    func openExisting(_ existing: Wine) {
        pendingScan = nil
        wine = existing
        fields = WineFields(existing)
        missingTier1 = []
        step = .review
    }

    // MARK: Manual entry (spec D4)

    func startManual() {
        fields = WineFields()
        step = .manual
    }

    /// Creates the draft from typed fields. The manual path never auto-fires
    /// (CLAUDE.md §15: "Not the manual + Add Wine path").
    func createManualDraft() async {
        isSaving = true
        defer { isSaving = false }
        actionError = nil
        do {
            wine = try await api.createWine(fields.newWine)
            missingTier1 = []
            tags = PromoteTags()
            step = .review
        } catch let error as APIError {
            actionError = error.message(networkMessage: "Failed to save. Is the backend running?")
        } catch {}
    }

    // MARK: Enrichment — the scan path's one sanctioned auto-fire

    /// Price and the primary review tier, fired once, together. Fire-and-forget
    /// in the sense that nothing retries: a failure is shown inline and left.
    private func fireEnrichment(for draft: Wine, force: Bool) {
        let id = draft.id
        priceAutoFire = .running
        reviewsAutoFire = .running
        Task {
            do {
                let result = try await api.fetchPrice(wineID: id, force: force)
                guard wine?.id == id else { return }
                wine?.priceData = result.wine.priceData
                priceAutoFire = .finished
            } catch {
                if wine?.id == id { priceAutoFire = .failed }
            }
        }
        Task {
            do {
                let result = try await api.fetchReviews(wineID: id, force: force, tier: .primary)
                guard wine?.id == id else { return }
                wine?.reviewData = result.wine.reviewData
                wine?.drinkingWindow = result.wine.drinkingWindow
                wine?.drinkingWindowSource = result.wine.drinkingWindowSource
                wine?.vintageRating = result.wine.vintageRating
                wine?.vintageRatingSource = result.wine.vintageRatingSource
                reviewsAutoFire = .finished
            } catch {
                if wine?.id == id { reviewsAutoFire = .failed }
            }
        }
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
            let alreadyFired = reviewsAutoFire != .notFired
            if updated.hasTier1 && (!alreadyFired || patch.changesIdentity) {
                fireEnrichment(for: updated, force: alreadyFired)
            }
            wine = try await api.promoteWine(id: draft.id, tags: tags)
            return true
        } catch let error as APIError {
            actionError = error.message(networkMessage: "Failed to save. Is the backend running?")
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
            actionError = error.message(networkMessage: "Could not update — is the backend running?")
        } catch {
            wine?[keyPath: tag.wineKeyPath] = previous
        }
    }

    func isOn(_ tag: ListTag) -> Bool {
        guard let wine else { return false }
        return wine.isDraft ? tags[keyPath: tag.promoteKeyPath] : wine[keyPath: tag.wineKeyPath]
    }

    /// Deletes the draft. Returns true when the modal should close. A 409
    /// (the wine has a tasting note) keeps the screen open with the spec's copy.
    func discard() async -> Bool {
        scanTask?.cancel()
        guard let draft = wine, draft.isDraft else { return true }
        do {
            try await api.deleteWine(id: draft.id)
            return true
        } catch APIError.server(409, _) {
            actionError = "This wine has a tasting note and can't be discarded. Remove it from your lists instead."
            return false
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
        reviewsAutoFire = .notFired
        priceAutoFire = .notFired
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
