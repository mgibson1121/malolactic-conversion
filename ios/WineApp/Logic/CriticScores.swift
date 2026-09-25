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

    /// The single score the compressed card shows (implementation spec §7.2).
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
        if score.knownPublication, let short = abbreviations[score.publication] {
            return short
        }
        // Unnormalized (or a known publication with no abbreviation yet):
        // raw text, truncated, so it never reads as a vetted short code.
        let raw = score.publication
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
}
