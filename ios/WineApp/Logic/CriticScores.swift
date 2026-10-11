import Foundation

enum CriticScores {
    /// Deduped by publication, first occurrence wins — the exact semantics of
    /// `getDedupedCriticScores` in `web/src/utils/criticScores.ts`, so one
    /// critic syndicated across several retailers counts once.
    static func deduped(_ reviews: [RetailerReview]?) -> [CriticScore] {
        var seen = Set<String>()
        var scores: [CriticScore] = []
        for review in reviews ?? [] {
            for score in review.criticScores where !seen.contains(score.publication) {
                seen.insert(score.publication)
                scores.append(score)
            }
        }
        return scores
    }

    /// The single score the compressed card shows: the first item in the
    /// backend's order (Phase 12.1 D13 — a trusted critic, the wine's own
    /// vintage first), with a muted year tag when its page's vintage is not
    /// the wine's, and `+N` for the rest. The app renders the order it is
    /// given; it never re-sorts. A wine from a backend that sends no summary
    /// falls back to the older highest-score rule.
    static func cardBadge(_ wine: Wine) -> CardScoreBadge? {
        guard let summary = wine.criticSummary else { return cardBadge(wine.reviewData) }
        guard let first = summary.ordered.first else { return nil }
        return CardScoreBadge(
            score: first.score,
            label: label(publication: first.publication, known: first.knownPublication),
            publication: first.publication,
            isKnownPublication: first.knownPublication,
            additionalCount: summary.ordered.count - 1,
            yearTag: yearTag(first)
        )
    }

    /// `'18` — present only when the score's stated vintage is not the wine's.
    static func yearTag(_ item: CriticSummaryItem) -> String? {
        guard !item.sameVintage, let vintage = item.vintage else { return nil }
        return "'" + String(String(vintage).suffix(2))
    }

    /// The legacy card rule (Phase 12 implementation spec §7.2).
    ///
    /// This is display truncation with a `+N` affordance — every score is still
    /// stored, attributed and shown in full on detail. It is **not** the
    /// preferred-source prioritization Phase 11 declined to build, and nothing
    /// here averages or blends.
    static func cardBadge(_ reviews: [RetailerReview]?) -> CardScoreBadge? {
        let scores = deduped(reviews)
        var best: CriticScore?
        for score in scores {
            guard let current = best else { best = score; continue }
            // Strictly better only, so a full tie keeps the earlier score.
            if score.score > current.score
                || (score.score == current.score && score.knownPublication && !current.knownPublication) {
                best = score
            }
        }
        guard let best else { return nil }
        return CardScoreBadge(
            score: best.score,
            label: label(for: best),
            publication: best.publication,
            isKnownPublication: best.knownPublication,
            additionalCount: scores.count - 1
        )
    }

    /// Short labels for the canonical publications in
    /// `backend/modules/reviews/critic-keywords.ts`. The spec names the first
    /// seven; the last four cover the rest of that table.
    static let abbreviations: [String: String] = [
        "Wine Advocate": "WA",
        "Vinous": "VN",
        "Burghound": "BH",
        "Wine Spectator": "WS",
        "Wine Enthusiast": "WE",
        "Decanter": "DC",
        "James Suckling": "JS",
        "Jeb Dunnuck": "JD",
        "Tim Atkin": "TA",
        "Gambero Rosso": "GR",
        "Guía Peñín": "GP",
    ]

    static let unknownPublicationMaxLength = 12

    static func label(for score: CriticScore) -> String {
        label(publication: score.publication, known: score.knownPublication)
    }

    static func label(publication raw: String, known: Bool) -> String {
        if known, let short = abbreviations[raw] {
            return short
        }
        // Unnormalized (or a known publication with no abbreviation yet):
        // raw text, truncated, so it never reads as a vetted short code.
        guard raw.count > unknownPublicationMaxLength else { return raw }
        return String(raw.prefix(unknownPublicationMaxLength)) + "…"
    }

    /// `96`, or `17.5` on a 20-point scale. Numbers are never abbreviated.
    static func format(_ score: Double) -> String {
        score.rounded() == score ? String(Int(score)) : String(score)
    }
}

struct CardScoreBadge: Hashable {
    let score: Double
    let label: String
    let publication: String
    /// False renders the badge with a dashed border.
    let isKnownPublication: Bool
    /// The `+N` suffix; zero means no suffix.
    let additionalCount: Int

    /// `96 WA`
    var text: String { "\(CriticScores.format(score)) \(label)" }
    /// `+2`, or nil.
    var suffix: String? { additionalCount > 0 ? "+\(additionalCount)" : nil }
    /// `'18` when the score is for another vintage; nil otherwise.
    var yearTag: String? = nil
}
