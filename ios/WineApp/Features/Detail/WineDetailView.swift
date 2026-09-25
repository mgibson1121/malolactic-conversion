import SwiftUI

/// How a detail screen was reached. Arriving from a card's score badge opens
/// Research scrolled to the scores (spec §8's first auto-expand case).
struct DetailRoute: Hashable {
    let wine: Wine
    var focusScores = false
}

/// The pushed detail screen (Phase 12 spec §7, implementation spec §8). The
/// "standing in a cellar with the bottle in your hand" facts are always
/// visible; everything GPT-inferred or enrichment-derived sits behind the
/// Research / Retailers / Reviews disclosure groups.
struct WineDetailView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var model: WineDetailModel
    @State private var showAllScores = false
    @State private var showAllRetailers = false
    @State private var isEvaluating = false
    private let focusScores: Bool

    init(route: DetailRoute, api: APIClient, onChanged: @escaping () -> Void) {
        _model = State(initialValue: WineDetailModel(wine: route.wine, api: api, onChanged: onChanged))
        focusScores = route.focusScores
    }

    private var wine: Wine { model.wine }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.widgetGap) {
                    identity
                    lists
                    drinkingWindow
                    latestNote
                    evaluateButton
                    research
                    retailers
                    reviewsGroup
                    savedLinks
                }
                .padding(.horizontal, Theme.sideMargin)
                .padding(.bottom, 32)
            }
            .background(Theme.bg)
            .navigationTitle(wine.producer ?? "Wine")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                await model.loadNotes()
                if focusScores {
                    setExpanded(.research, true)
                    try? await Task.sleep(for: .milliseconds(300))
                    withAnimation { proxy.scrollTo("scores", anchor: .top) }
                }
            }
        }
        .sheet(isPresented: $isEvaluating) {
            EvaluatePlaceholder()
        }
    }

    // MARK: Always visible

    private var identity: some View {
        WidgetCard {
            HStack(alignment: .top, spacing: 10) {
                ColourDot(colour: wine.wineColor).padding(.top, 8)
                VStack(alignment: .leading, spacing: 4) {
                    Text(WineFormatting.title(wine))
                        .font(AppFont.detailTitle())
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(identityMeta)
                        .font(AppFont.meta())
                        .foregroundStyle(Theme.textMuted)
                    ForEach(tier2, id: \.self) { value in
                        Text(value).font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                    }
                }
            }
            HStack(spacing: 6) {
                if let rating = wine.myRating {
                    Pill(text: WineFormatting.rating(rating), fg: Theme.accent, bg: Theme.accentSoft)
                }
                if let year = wine.vintageRating {
                    Pill(text: "Year: \(DetailFormatting.vintageRating(year))", fg: Theme.text, bg: Theme.surface2,
                         sourced: wine.vintageRatingSource == .derived)
                }
            }
        }
    }

    /// `2019 · Burgundy · Red · Premier Cru` — Tier 2 nulls collapse.
    private var identityMeta: String {
        [WineFormatting.vintage(wine), wine.region,
         wine.wineColor.map { $0.rawValue.prefix(1).uppercased() + $0.rawValue.dropFirst() },
         wine.qualityClassification]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    private var tier2: [String] {
        [wine.vineyard, wine.cuvee, wine.grapeVarieties?.joined(separator: ", ")]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
    }

    private var lists: some View {
        WidgetCard {
            SectionLabel("Lists")
            HStack(spacing: 6) {
                tagToggle("Discovered", \.tagDiscovered) { WinePatch(tagDiscovered: $0) }
                tagToggle("Wishlist", \.tagWishlist) { WinePatch(tagWishlist: $0) }
                tagToggle("Cellar", \.tagCellar) { WinePatch(tagCellar: $0) }
                tagToggle("Consumed", \.tagConsumed) { WinePatch(tagConsumed: $0) }
            }
            if wine.tagCellar {
                HStack {
                    Text("Cellar quantity").font(AppFont.body()).foregroundStyle(Theme.text)
                    Spacer()
                    Button {
                        Task { await model.changeQuantity(by: -1) }
                    } label: {
                        Image(systemName: "minus").frame(width: Theme.minHitTarget, height: Theme.minHitTarget)
                    }
                    .disabled(wine.cellarQuantity <= 0)
                    .accessibilityLabel("Remove one bottle")
                    Text("\(wine.cellarQuantity) btl")
                        .font(AppFont.body().monospacedDigit())
                        .frame(minWidth: 48)
                    Button {
                        Task { await model.changeQuantity(by: 1) }
                    } label: {
                        Image(systemName: "plus").frame(width: Theme.minHitTarget, height: Theme.minHitTarget)
                    }
                    .accessibilityLabel("Add one bottle")
                }
            }
            if let error = model.actionError {
                Text(error).font(.system(size: 12)).foregroundStyle(Theme.redPill)
            }
        }
    }

    private func tagToggle(_ title: String, _ keyPath: WritableKeyPath<Wine, Bool>,
                           patch: @escaping (Bool) -> WinePatch) -> some View {
        let isOn = wine[keyPath: keyPath]
        return Button {
            Task { await model.toggle(keyPath, patch: patch) }
        } label: {
            Text(title)
                .font(AppFont.badge())
                .lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
                .foregroundStyle(isOn ? Color.white : Theme.text)
                .background(isOn ? Theme.accent : Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.buttonRadius))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    /// The wine-level window when critics agree; otherwise every critic's
    /// window, attributed, never reconciled. Omitted when neither exists (§5).
    @ViewBuilder
    private var drinkingWindow: some View {
        let attributed = DrinkingWindows.attributed(wine.reviewData)
        if let window = wine.drinkingWindow {
            WidgetCard {
                SectionLabel("Drinking window")
                HStack(spacing: 6) {
                    Text(DetailFormatting.wineWindow(window))
                        .font(AppFont.cardTitle().monospacedDigit())
                    if wine.drinkingWindowSource == .derived { SourcedMarker() }
                }
            }
        } else if !attributed.isEmpty {
            WidgetCard {
                SectionLabel("Drinking window")
                if let note = DrinkingWindows.disagreementNote(attributed) {
                    Text(note).font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                }
                ForEach(attributed, id: \.self) { w in
                    HStack(alignment: .firstTextBaseline) {
                        Text(verbatim: "\(w.start)–\(w.end)").font(AppFont.body().monospacedDigit())
                        Text(w.publications.joined(separator: ", "))
                            .font(AppFont.meta())
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var latestNote: some View {
        if let note = model.notes.value?.first {
            WidgetCard {
                SectionLabel("Latest note")
                HStack(spacing: 6) {
                    if let rating = note.myRating {
                        Pill(text: WineFormatting.rating(rating), fg: Theme.accent, bg: Theme.accentSoft)
                    }
                    if let quality = note.qualityAssessment {
                        Text(DetailFormatting.quality(quality)).font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                    }
                    Spacer()
                    if let date = NoteDate.short(note.tastedAt) {
                        Text(date).font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                    }
                }
                if let text = note.freeText, !text.isEmpty {
                    Text(DetailFormatting.excerpt(text)).font(AppFont.body()).foregroundStyle(Theme.text)
                }
                if !note.tags.isEmpty {
                    Text(note.tags.prefix(6).joined(separator: " · ") + (note.tags.count > 6 ? " +\(note.tags.count - 6)" : ""))
                        .font(AppFont.meta())
                        .foregroundStyle(Theme.textMuted)
                }
            }
        }
    }

    private var evaluateButton: some View {
        Button {
            isEvaluating = true
        } label: {
            Label("Evaluate this wine", systemImage: "square.and.pencil")
                .frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
        }
        .buttonStyle(.borderedProminent)
        .tint(Theme.accent2)
    }

    // MARK: Research — critic scores and price (metered controls live here)

    private var research: some View {
        let scores = CriticScores.deduped(wine.reviewData)
        let summary: String = {
            var parts: [String] = []
            if !scores.isEmpty { parts.append("\(scores.count) score\(scores.count == 1 ? "" : "s")") }
            if let avg = WineFormatting.price(wine.priceData?.priceAvg) { parts.append("\(avg) avg") }
            return parts.isEmpty ? "Not fetched" : parts.joined(separator: " · ")
        }()
        return DisclosureCard(title: "Research", summary: summary, isExpanded: binding(.research)) {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel("Critic scores").id("scores")
                if scores.isEmpty {
                    Text("No attributed critic scores found yet.")
                        .font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                } else {
                    ForEach(Array((showAllScores ? scores : Array(scores.prefix(6))).enumerated()), id: \.offset) { _, score in
                        CriticScoreRow(score: score)
                    }
                    if scores.count > 6 {
                        Button(showAllScores ? "Show fewer" : "Show all \(scores.count) scores") { showAllScores.toggle() }
                            .font(AppFont.meta())
                    }
                }
                EnrichmentButton(
                    title: wine.reviewData == nil ? "Fetch Reviews" : "Refresh Reviews",
                    label: "Reviews",
                    control: model.reviews,
                    run: { force in Task { await model.fetchReviews(force: force); setExpanded(.research, true) } }
                )

                Divider().padding(.vertical, 4)

                SectionLabel("Pricing")
                if let price = wine.priceData {
                    if price.retailers.isEmpty {
                        Text("No matching listings found for this wine at the configured retailers.")
                            .font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                        Text("Checked \(NoteDate.short(price.fetchedAt) ?? "recently")")
                            .font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                    } else {
                        Text("Min \(DetailFormatting.priceBound(price.priceMin)) · Avg \(DetailFormatting.priceBound(price.priceAvg)) · Max \(DetailFormatting.priceBound(price.priceMax))")
                            .font(AppFont.body().monospacedDigit())
                        if let other = price.otherVintagePriceRange {
                            Text("Other vintages \(DetailFormatting.priceBound(other.min))–\(DetailFormatting.priceBound(other.max))")
                                .font(AppFont.meta().monospacedDigit())
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                } else {
                    Text("No price data yet.").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                }
                EnrichmentButton(
                    title: wine.priceData == nil ? "Fetch Price" : "Refresh Price",
                    label: "Price",
                    control: model.price,
                    run: { force in Task { await model.fetchPrice(force: force); setExpanded(.retailers, true) } }
                )
            }
        }
    }

    // MARK: Retailers — nearest + 2, collapsed by default (§7.3)

    private var retailers: some View {
        let rows = wine.priceData.map(RetailerTable.ordered) ?? []
        let summary = rows.isEmpty
            ? "No listings"
            : "Nearest + \(min(2, rows.count - 1)) · \(rows.count) total"
        return DisclosureCard(title: "Retailers", summary: summary, isExpanded: binding(.retailers)) {
            VStack(alignment: .leading, spacing: 0) {
                if rows.isEmpty {
                    Text(wine.priceData == nil ? "No price data yet." : "No matching listings found for this wine at the configured retailers.")
                        .font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                        .padding(.bottom, 8)
                    EnrichmentButton(title: wine.priceData == nil ? "Fetch Price" : "Refresh Price", label: "Price",
                                     control: model.price,
                                     run: { force in Task { await model.fetchPrice(force: force) } })
                } else {
                    let shown = showAllRetailers ? rows : Array(rows.prefix(RetailerTable.collapsedCount))
                    ForEach(Array(shown.enumerated()), id: \.offset) { index, row in
                        RetailerRow(retailer: row, isNearest: index == 0 && wine.priceData?.nearestRetailer?.slug == row.slug,
                                    isResolving: model.resolving.contains(row.slug)) {
                            Task { if let url = await model.url(for: row) { openURL(url) } }
                        }
                        if index < shown.count - 1 { Divider() }
                    }
                    if rows.count > RetailerTable.collapsedCount {
                        Button(showAllRetailers ? "Show fewer" : "Show all \(rows.count) retailers") { showAllRetailers.toggle() }
                            .font(AppFont.meta())
                            .frame(minHeight: Theme.minHitTarget)
                    }
                    if let fetched = wine.priceData?.fetchedAt, let date = NoteDate.short(fetched) {
                        Text("Updated \(date)").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                    }
                }
            }
        }
    }

    // MARK: Reviews — the tasting-note history

    private var reviewsGroup: some View {
        let notes = model.notes.value ?? []
        return DisclosureCard(title: "Reviews", summary: notes.isEmpty ? "No notes" : "\(notes.count) note\(notes.count == 1 ? "" : "s")",
                              isExpanded: binding(.reviews)) {
            VStack(alignment: .leading, spacing: 12) {
                if case .failed = model.notes {
                    Text("Could not load tasting notes.").font(AppFont.meta()).foregroundStyle(Theme.redPill)
                } else if notes.isEmpty {
                    Text("No tasting notes yet.").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                    Button("Evaluate this wine") { isEvaluating = true }.font(AppFont.meta())
                } else {
                    ForEach(notes) { note in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                if let rating = note.myRating {
                                    Pill(text: WineFormatting.rating(rating), fg: Theme.accent, bg: Theme.accentSoft)
                                }
                                Spacer()
                                Text(NoteDate.short(note.tastedAt) ?? "").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                            }
                            if let text = note.freeText, !text.isEmpty {
                                Text(text).font(AppFont.body()).foregroundStyle(Theme.text)
                            }
                        }
                    }
                }
            }
        }
    }

    /// User-saved retailer URLs. Omitted when none (existing web behaviour).
    @ViewBuilder
    private var savedLinks: some View {
        if let links = wine.retailerLinks, !links.isEmpty {
            WidgetCard {
                SectionLabel("Review links")
                ForEach(links.sorted(by: { $0.key < $1.key }), id: \.key) { slug, url in
                    if let link = URL(string: url) {
                        Link(destination: link) {
                            Label("\(RetailerNames.name(for: slug, in: wine)) review", systemImage: "arrow.up.right.square")
                                .font(AppFont.body())
                                .frame(minHeight: Theme.minHitTarget)
                        }
                    }
                }
            }
        }
    }

    // MARK: Disclosure state

    private func binding(_ group: DetailGroup) -> Binding<Bool> {
        Binding(
            get: { session.expandedGroups[wine.id, default: []].contains(group) },
            set: { setExpanded(group, $0) }
        )
    }

    private func setExpanded(_ group: DetailGroup, _ open: Bool) {
        if open {
            session.expandedGroups[wine.id, default: []].insert(group)
        } else {
            session.expandedGroups[wine.id, default: []].remove(group)
        }
    }
}

/// Stand-in until the Evaluate form lands (next slice).
private struct EvaluatePlaceholder: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Text("The Evaluate form is the next Phase 12 slice.")
                .font(AppFont.body())
                .foregroundStyle(Theme.textMuted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.bg)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }
}
