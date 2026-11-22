import Foundation
import Observation

/// Follows one wine's running lookups by reading it, which is free, until the
/// server says they have ended (Phase 14 WI-4, spec §5.4).
///
/// Both the scan flow and the detail screen use this one watcher. The POST that
/// starts a search stays open for the whole run, but a search must also be
/// visible when that request is not what the screen is waiting on: a wine saved
/// mid-search, a phone that was locked, a dropped connection. The server saves
/// each shop as it finishes, so a plain GET shows the scores and the count so
/// far.
///
/// It stops when:
/// - a lookup it saw running is no longer running (done, failed or interrupted),
/// - none was running within `startGrace` of starting (the answer came from
///   what was stored, or the search ended before the first poll), or
/// - `maxDuration` has passed (the spec's five minutes).
/// It never starts a search and never retries one.
@MainActor
@Observable
final class EnrichmentWatcher {
    private(set) var isWatching = false

    /// Receives each wine read. Set once by the owner after it is initialised.
    var onWine: (Wine) -> Void = { _ in }

    private let fetch: (String) async -> Wine?
    private let interval: Duration
    private let startGrace: Duration
    private let maxDuration: Duration
    private var task: Task<Void, Never>?
    /// Which start this is, so a run that was stopped cannot clear the one that replaced it.
    private var generation = 0

    init(
        interval: Duration = .seconds(2),
        startGrace: Duration = .seconds(8),
        maxDuration: Duration = .seconds(300),
        fetch: @escaping (String) async -> Wine?
    ) {
        self.interval = interval
        self.startGrace = startGrace
        self.maxDuration = maxDuration
        self.fetch = fetch
    }

    /// Starts watching `wineID`; a no-op when already watching it.
    func start(wineID: String) {
        guard task == nil else { return }
        isWatching = true
        generation += 1
        let mine = generation
        task = Task { [weak self] in
            await self?.run(wineID: wineID, generation: mine)
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        isWatching = false
    }

    private func run(wineID: String, generation mine: Int) async {
        let clock = ContinuousClock()
        let began = clock.now
        var seenRunning = false
        defer {
            if generation == mine {
                task = nil
                isWatching = false
            }
        }
        while !Task.isCancelled {
            try? await Task.sleep(for: interval)
            if Task.isCancelled { return }
            if clock.now - began > maxDuration { return }
            // A failed read is not "ended": keep going until the cap.
            guard let fresh = await fetch(wineID), !Task.isCancelled else { continue }
            onWine(fresh)
            if fresh.enrichmentJob?.anyRunning == true {
                seenRunning = true
            } else if seenRunning || clock.now - began > startGrace {
                return
            }
        }
    }
}
