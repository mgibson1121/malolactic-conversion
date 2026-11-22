import Foundation

/// A wine's running or last metered lookups (Phase 14, `wines.enrichment_job`,
/// migration 012). Hand-mirrors `EnrichmentJobs` in `shared/types.ts`. The
/// server writes it; the app only reads it, to show a search that is still
/// going wherever the wine appears, including after the scan screen is gone.
struct EnrichmentJobs: Codable, Hashable {
    var reviews: ReviewsJob?
    var price: PriceJob?

    /// Either lookup is running right now.
    var anyRunning: Bool { reviews?.state == .running || price?.state == .running }
}

/// `running` is a search in progress. `interrupted` is one whose machine
/// stopped under it: it can be carried on. `unknown` is any state a newer
/// backend might add; it must never fail the decoding of the whole wine.
enum JobState: Hashable {
    case running, done, failed, interrupted, unknown
}

extension JobState: Codable {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        switch raw {
        case "running": self = .running
        case "done": self = .done
        case "failed": self = .failed
        case "interrupted": self = .interrupted
        default: self = .unknown
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .running: try container.encode("running")
        case .done: try container.encode("done")
        case .failed: try container.encode("failed")
        case .interrupted: try container.encode("interrupted")
        case .unknown: try container.encode("unknown")
        }
    }
}

struct ReviewsJob: Codable, Hashable {
    var state: JobState
    /// `shops`, `merchants` or `finishing`. A string, so a new stage cannot break decoding.
    var stage: String
    var startedAt: String
    var updatedAt: String
    var shopsTotal: Int
    var shopsDone: Int
    var scoresFound: Int
    var identity: String

    enum CodingKeys: String, CodingKey {
        case state, stage, identity
        case startedAt = "started_at"
        case updatedAt = "updated_at"
        case shopsTotal = "shops_total"
        case shopsDone = "shops_done"
        case scoresFound = "scores_found"
    }
}

/// Price carries the same envelope without counts.
struct PriceJob: Codable, Hashable {
    var state: JobState
    var startedAt: String
    var updatedAt: String
    var identity: String

    enum CodingKeys: String, CodingKey {
        case state, identity
        case startedAt = "started_at"
        case updatedAt = "updated_at"
    }
}

/// What the critic block says about a review search, derived once from the
/// wine and the in-flight request so the scan review and the detail screen
/// cannot word it differently (Phase 14 WI-4, spec §5.4).
struct ReviewSearch: Equatable {
    /// A search is under way: the server says so, or this app's own request is out.
    var isSearching: Bool
    /// The server stopped it part-way (its machine did); it can be resumed.
    var isInterrupted: Bool
    var shopsDone: Int
    var shopsTotal: Int
    var scoresFound: Int

    init(wine: Wine?, control: EnrichmentControl) {
        let job = wine?.enrichmentJob?.reviews
        isSearching = control.isBusy || job?.state == .running
        isInterrupted = !isSearching && job?.state == .interrupted
        shopsDone = job?.shopsDone ?? 0
        shopsTotal = job?.shopsTotal ?? 0
        scoresFound = job?.scoresFound ?? 0
    }

    /// "Checked 7 of 11 shops · 2 scores so far" while it runs; "Checked 11
    /// shops" once it has. Nil when there is nothing true to say yet.
    var metaLine: String? {
        if isSearching {
            guard shopsTotal > 0 else { return "Searching shops…" }
            let base = "Checked \(min(shopsDone, shopsTotal)) of \(shopsTotal) shops"
            return scoresFound > 0 ? base + " · \(scoresFound) \(scoresFound == 1 ? "score" : "scores") so far" : base
        }
        return shopsTotal > 0 ? "Checked \(shopsTotal) \(shopsTotal == 1 ? "shop" : "shops")" : nil
    }

    /// The empty result, with how hard it looked and no button: "No critic
    /// scores found at 11 shops."
    var noneLine: String {
        shopsTotal > 0 ? "No critic scores found at \(shopsTotal) \(shopsTotal == 1 ? "shop" : "shops")." : "No critic scores found."
    }
}
