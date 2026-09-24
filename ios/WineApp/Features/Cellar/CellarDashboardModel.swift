import Foundation
import Observation

struct CellarSnapshot: Hashable {
    var wines: [Wine]
    var settings: AppSettings
}

/// The Cellar tab's data: exactly one `GET /api/wines?tag_cellar=true` and one
/// `GET /api/settings` per load, from which every widget is derived
/// (implementation spec §6.1).
@MainActor
@Observable
final class CellarDashboardModel {
    private(set) var state: LoadState<CellarSnapshot> = .idle
    private(set) var consecutiveFailures = 0
    /// The Ready-to-drink segment currently filtering the list, if any.
    var readinessFilter: ReadinessSegment?
    /// Inline error under the capacity widget (an Action-class failure).
    private(set) var capacityError: String?

    func load(using api: APIClient) async {
        if state.value == nil { state = .loading }
        do {
            async let wines = api.listWines(.cellar)
            async let settings = api.settings()
            // The dashboard is never "empty" as a state: an empty cellar is
            // its own card with the scan CTA still live.
            state = .loaded(CellarSnapshot(wines: try await wines, settings: try await settings))
            consecutiveFailures = 0
        } catch is CancellationError {
        } catch let error as APIError {
            state = state.failing(with: error)
            consecutiveFailures += 1
        } catch {
            state = state.failing(with: .network(error.localizedDescription))
            consecutiveFailures += 1
        }
    }

    func summary(today: Date = .now) -> CellarSummary? {
        guard let snapshot = state.value else { return nil }
        return CellarSummary(wines: snapshot.wines, settings: snapshot.settings, today: today)
    }

    /// The cellar list, narrowed by the selected Ready-to-drink segment.
    func listedWines(today: Date = .now) -> [Wine] {
        guard let wines = state.value?.wines else { return [] }
        guard let readinessFilter else { return wines }
        return wines.filter { DrinkReadiness.of($0.drinkingWindow, today: today).segment == readinessFilter }
    }

    /// Three most recent by `date_added` (ISO timestamps sort as strings).
    var recentlyAdded: [Wine] {
        Array((state.value?.wines ?? []).sorted { $0.dateAdded > $1.dateAdded }.prefix(3))
    }

    func saveCapacity(_ capacity: Int?, using api: APIClient) async -> Bool {
        capacityError = nil
        do {
            let saved = try await api.updateSettings(AppSettings(cellarCapacity: capacity))
            if var snapshot = state.value {
                snapshot.settings = saved
                state = .loaded(snapshot)
            }
            return true
        } catch {
            capacityError = (error as? APIError)?.message(networkMessage: "Could not save — is the backend running?")
                ?? "Could not save — is the backend running?"
            return false
        }
    }
}
