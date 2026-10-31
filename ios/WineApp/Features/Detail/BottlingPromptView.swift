import SwiftUI

// Phase 12.2 — the review tier marker with its explainer sheet, and "Which
// bottling is yours?" (a banner opening a sheet). The tier and the prompt are
// computed in the backend (`review_ladder`, `bottling_prompt`); this renders
// them. An answer is saved on the server, which re-scores every stored listing
// and page with no network call and returns the wine.

/// What the developer answered in the bottling sheet.
enum BottlingChoice: Hashable {
    case plain
    case vineyard(String)
    case cuvee(String)
    case notSure

    var body: BottlingChoiceBody {
        switch self {
        case .plain: return BottlingChoiceBody(choice: "plain", name: nil)
        case .vineyard(let n): return BottlingChoiceBody(choice: "vineyard", name: n)
        case .cuvee(let n): return BottlingChoiceBody(choice: "cuvee", name: n)
        case .notSure: return BottlingChoiceBody(choice: "not_sure", name: nil)
        }
    }
}

struct BottlingChoiceBody: Encodable, Hashable {
    var choice: String
    var name: String?
}

struct BottlingChoiceResponse: Decodable {
    struct Outcome: Decodable {
        var tier: String
        var scores: Int
        var trustedScores: Int
        var duplicate: DuplicateKind?
        enum CodingKeys: String, CodingKey {
            case tier, scores, duplicate
            case trustedScores = "trusted_scores"
        }
    }
    struct DuplicateKind: Decodable { var kind: String }
    var wine: Wine
    var result: Outcome
}

/// The answer's outcome as the sheet reports it.
enum BottlingOutcome: Equatable {
    case done(String)
    case failed(String)
}

/// What each tier means (seed copy from the spec, mirrored by the web's `tierCopy.ts`).
enum TierCopy {
    static func phrase(_ tier: String) -> String? {
        switch tier {
        case "1": return "exact wine and vintage"
        case "2": return "same wine, other vintages"
        case "3a": return "different bottling, same vintage"
        case "3b": return "different bottling, nearby vintage"
        default: return nil
        }
    }

    static func headline(_ tier: String) -> String? {
        phrase(tier).map { "Matched at Tier \(tier) · \($0)" }
    }

    static func meaning(_ tier: String) -> String {
        switch tier {
        case "1": return "We found a score for this exact wine and vintage from a critic we trust."
        case "2": return "No trusted score for this vintage, so we looked at other vintages of the same wine, nearest first. Scores and drinking windows from vintages within 3 years are used; further ones are shown for reference."
        case "3a": return "We found nothing for this exact bottling, so we widened to a different bottling of the same producer and vintage (for example a named vineyard or special cuvée). Treat these scores as a guide."
        default: return "We found nothing for this exact bottling, so we widened to a different bottling of the same producer and then to a nearby vintage (within 3 years). This is the loosest match we make."
        }
    }

    static func effect(_ tier: String) -> String {
        switch tier {
        case "1": return "The card badge and the drinking window come from these scores."
        case "2": return "Scores within 3 vintages can set the card badge and the drinking window, labelled approximate. A critic's window from further away is shown for reference and never merged into yours."
        default: return "The card badge is marked “from a different bottling?” and the drinking window is approximate."
        }
    }

    /// "Now matched at Tier 1 — 3 trusted scores".
    static func resultLine(tier: String, scores: Int, trusted: Int) -> String {
        guard phrase(tier) != nil else { return "Saved. Nothing found for this bottling yet; the wine has no matched scores." }
        let n = trusted > 0 ? trusted : scores
        let kind = trusted > 0 ? "trusted " : ""
        return "Now matched at Tier \(tier) — \(n) \(kind)\(n == 1 ? "score" : "scores")"
    }
}

/// "Matched at Tier 2 · same wine, other vintages ⓘ" above the scores. The ⓘ is
/// underlined and tappable (the 12.1 link rule) and opens a sheet.
struct TierMarker: View {
    let ladder: ReviewLadder
    var onChoose: (() -> Void)?
    @State private var showSheet = false

    var body: some View {
        if let headline = TierCopy.headline(ladder.tier) {
            HStack(spacing: 4) {
                Text(headline).font(AppFont.meta()).foregroundStyle(ladder.tier == "1" ? Theme.textMuted.opacity(0.8) : Theme.textMuted)
                Button {
                    showSheet = true
                } label: {
                    Text("ⓘ").underline().font(AppFont.meta()).foregroundStyle(Theme.accent)
                        .frame(minWidth: 28, minHeight: Theme.minHitTarget)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("What does Tier \(ladder.tier) mean?")
            }
            .sheet(isPresented: $showSheet) {
                TierSheet(ladder: ladder) {
                    showSheet = false
                    onChoose?()
                }
                .presentationDetents([.medium, .large])
            }
        }
    }
}

private struct TierSheet: View {
    let ladder: ReviewLadder
    let choose: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(TierCopy.meaning(ladder.tier)).font(AppFont.body())
                    Text(TierCopy.effect(ladder.tier)).font(AppFont.body())
                    Text("What was found").font(AppFont.sectionLabel()).foregroundStyle(Theme.textMuted)
                    ForEach(ladder.rungs, id: \.tier) { rung in
                        let critics = rung.critics.isEmpty ? "" : " (\(rung.critics.joined(separator: ", ")))"
                        let years = rung.vintages.isEmpty ? "" : " · vintages \(rung.vintages.sorted().map(String.init).joined(separator: ", "))"
                        Text("Tier \(rung.tier): \(rung.pages) \(rung.pages == 1 ? "page" : "pages"), \(rung.scores) \(rung.scores == 1 ? "score" : "scores")\(critics)\(years)")
                            .font(AppFont.meta())
                    }
                    if ladder.tier == "3a" || ladder.tier == "3b" {
                        Button("Which bottling is yours?", action: choose)
                            .buttonStyle(.borderedProminent).tint(Theme.accent2)
                    }
                }
                .padding()
            }
            .navigationTitle("Tier \(ladder.tier)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

/// "Listings name different bottlings — which is yours?" Non-blocking; opens a
/// sheet. Shows the draft-review hint ("check the bottle") while the wine
/// names no vineyard or cuvée (WI-2.7).
struct BottlingBanner: View {
    let wine: Wine
    let choose: (BottlingChoice) async -> BottlingOutcome
    @State private var showSheet = false
    @State private var resultLine: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if wine.bottlingPrompt != nil {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Listings name different bottlings — which is yours?" + (wine.vineyard == nil && wine.cuvee == nil ? " The label may name a vineyard or special bottling — check the bottle." : ""))
                        .font(AppFont.meta())
                    Button("Choose") { showSheet = true }
                        .buttonStyle(.link).font(AppFont.meta())
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.buttonRadius))
                .accessibilityIdentifier("bottling-banner")
            }
            // Answered: a quiet row instead of the banner (Phase 12.4 WI-4).
            if wine.bottlingPrompt == nil, let answer = wine.bottlingAnswer {
                HStack(spacing: 4) {
                    Text("Bottling: \(answer.label) ·").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                    Button("Change") { showSheet = true }
                        .buttonStyle(.link).font(AppFont.meta())
                }
                .accessibilityIdentifier("bottling-answer")
            }
            if let resultLine {
                Text(resultLine).font(AppFont.meta()).foregroundStyle(Theme.textMuted)
            }
        }
        .sheet(isPresented: $showSheet) {
            if let options = wine.bottlingPrompt?.options ?? wine.bottlingAnswer?.options {
                BottlingSheet(wine: wine, options: options) { choice in
                    let outcome = await choose(choice)
                    if case .done(let line) = outcome {
                        resultLine = line
                        showSheet = false
                    }
                    return outcome
                }
                .presentationDetents([.medium, .large])
            }
        }
    }
}

private struct BottlingSheet: View {
    let wine: Wine
    let options: [BottlingOption]
    let choose: (BottlingChoice) async -> BottlingOutcome
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?
    @State private var typed = ""
    @State private var typedIsCuvee = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("The results name more than one bottling. Your answer re-scores what we already found. Nothing is searched again.")
                        .font(AppFont.meta())
                }
                ForEach(options, id: \.name) { option in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(option.name).font(AppFont.body().bold())
                            Spacer()
                            Button("This one") { Task { await answer(kind(of: option)) } }
                                .buttonStyle(.bordered).disabled(busy)
                        }
                        let evidence = [
                            option.retailers.isEmpty ? nil : option.retailers.joined(separator: ", "),
                            option.priceRange.map { DetailFormatting.priceRange($0.min, $0.max) },
                            option.critics.isEmpty ? nil : option.critics.joined(separator: ", "),
                        ].compactMap { $0 }
                        if !evidence.isEmpty {
                            Text(evidence.joined(separator: " · ")).font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                        }
                        ForEach(option.links, id: \.url) { link in
                            if let url = URL(string: link.url) {
                                Link(link.name, destination: url).underline().font(AppFont.meta())
                            }
                        }
                    }
                }
                Section {
                    HStack {
                        Text("Plain / no special bottling").font(AppFont.body().bold())
                        Spacer()
                        Button("This one") { Task { await answer(.plain) } }.buttonStyle(.bordered).disabled(busy)
                    }
                }
                Section("Something else") {
                    Picker("Kind", selection: $typedIsCuvee) {
                        Text("Vineyard").tag(false)
                        Text("Cuvée").tag(true)
                    }
                    .pickerStyle(.segmented)
                    TextField("Name on the label", text: $typed)
                    Button("Use this") {
                        let name = typed.trimmingCharacters(in: .whitespaces)
                        Task { await answer(typedIsCuvee ? .cuvee(name) : .vineyard(name)) }
                    }
                    .disabled(busy || typed.trimmingCharacters(in: .whitespaces).count < 2)
                }
                Section {
                    Button("Not sure") { Task { await answer(.notSure) } }.disabled(busy)
                    if let error { Text(error).font(AppFont.meta()).foregroundStyle(Theme.redPill) }
                }
            }
            .navigationTitle("Which bottling is yours?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }

    /// A name made only of "Vieilles Vignes"-type words is a cuvée; anything else is read as a vineyard.
    private func kind(of option: BottlingOption) -> BottlingChoice {
        let cuveeWords: Set<String> = ["vieilles", "vieille", "vignes", "prestige", "barrique"]
        return option.words.allSatisfy { cuveeWords.contains($0) } ? .cuvee(option.name) : .vineyard(option.name)
    }

    private func answer(_ choice: BottlingChoice) async {
        busy = true
        error = nil
        let outcome = await choose(choice)
        if case .failed(let message) = outcome { error = message }
        busy = false
    }
}
