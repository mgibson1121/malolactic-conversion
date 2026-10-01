import Foundation
import Observation

/// "Find reviews" on the detail screen — the port of `RetailerLinksSection`
/// (web Phase 6.6, guided flow Phase 7.2). Search links are built by the
/// backend on request and never stored; a link is persisted only when the
/// user saves one.
///
/// The guided flow is adapted for the phone rather than copied: the web opens
/// the retailer in a new tab and reads the clipboard when the user switches
/// back, but iOS prompts "Allow Paste" on every programmatic clipboard read.
/// Here Search opens the retailer in an in-app browser, and "Use this page"
/// hands its current URL straight to `confirm-retailer-link`.
@MainActor
@Observable
final class FindReviewsModel {
    private(set) var links: LoadState<[RetailerLink]> = .idle
    var editingSlug: String?
    var editValue = ""
    private(set) var savingSlug: String?
    private(set) var saveError: String?
    /// The retailer currently open in the in-app browser.
    var browsing: RetailerLink?
    private(set) var isConfirming = false
    private(set) var confirmError: String?

    private let api: APIClient
    private let wine: () -> Wine
    private let apply: (Wine) -> Void

    init(api: APIClient, wine: @escaping () -> Wine, apply: @escaping (Wine) -> Void) {
        self.api = api
        self.wine = wine
        self.apply = apply
    }

    /// Free — the backend constructs URL strings and fetches nothing.
    func load() async {
        links = .loading
        do {
            links = .from(try await api.retailerLinks(wineID: wine().id))
        } catch let error as APIError {
            links = .failed(error)
        } catch {}
    }

    func startEditing(_ link: RetailerLink) {
        editingSlug = link.slug
        editValue = wine().retailerLinks?[link.slug] ?? link.url
        saveError = nil
    }

    func save(_ slug: String) async {
        var merged = wine().retailerLinks ?? [:]
        merged[slug] = editValue.trimmed
        if await patch(merged, slug: slug, failure: "Save failed") { editingSlug = nil }
    }

    func clear(_ slug: String) async {
        var merged = wine().retailerLinks ?? [:]
        merged[slug] = nil
        _ = await patch(merged, slug: slug, failure: "Could not remove saved link")
    }

    private func patch(_ links: [String: String], slug: String, failure: String) async -> Bool {
        savingSlug = slug
        saveError = nil
        defer { savingSlug = nil }
        do {
            apply(try await api.updateWine(id: wine().id, WinePatch(retailerLinks: links)))
            return true
        } catch let error as APIError {
            if case .server(_, let message) = error, !message.hasPrefix("HTTP") {
                saveError = message
            } else {
                saveError = failure
            }
            return false
        } catch {
            return false
        }
    }

    /// "Save & Extract" — saves `url` for the retailer and runs the Phase 7
    /// extraction against that exact page (a Puppeteer render plus one GPT-4o
    /// call: metered, so only ever on this explicit tap). Returns true when
    /// the browser should close.
    func confirm(_ url: URL, for link: RetailerLink) async -> Bool {
        isConfirming = true
        confirmError = nil
        defer { isConfirming = false }
        do {
            apply(try await api.confirmRetailerLink(wineID: wine().id, slug: link.slug, url: url.absoluteString))
            return true
        } catch {
            confirmError = "Could not save and extract from that link"
            return false
        }
    }

    func clearConfirmError() {
        confirmError = nil
    }
}
