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
    @Environment(\.dismiss) private var dismiss
    @State private var model: WineDetailModel
    @State private var findReviews: FindReviewsModel
    @State private var isEvaluating = false
    @State private var isEditing = false
    private let focusScores: Bool

    init(route: DetailRoute, api: APIClient, onChanged: @escaping () -> Void) {
        let detail = WineDetailModel(wine: route.wine, api: api, onChanged: onChanged)
        _model = State(initialValue: detail)
        _findReviews = State(initialValue: FindReviewsModel(api: api, wine: { detail.wine }, apply: { detail.apply($0) }))
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
                    criticReviews
                    priceRetailers
                    myReview
                    savedLinks
                    FindReviewsSection(model: findReviews, wine: wine)
                }
                .padding(.horizontal, Theme.sideMargin)
                .padding(.bottom, 32)
            }
            .background(Theme.bg)
            .navigationTitle(wine.producer ?? "Wine")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                await model.reload()
                async let priced: Void = model.fetchPriceOnceIfNeeded()
                await model.loadNotes()
                if focusScores {
                    setExpanded(.criticReviews, true)
                    try? await Task.sleep(for: .milliseconds(300))
                    withAnimation { proxy.scrollTo("scores", anchor: .top) }
                }
                await priced
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Edit") { isEditing = true }
            }
        }
        .sheet(isPresented: $isEvaluating) {
            if let api = session.api {
                EvaluateFormView(wine: wine, api: api) {
                    Task { await model.reloadAfterEvaluate() }
                }
            }
        }
        .sheet(isPresented: $isEditing) {
            if let api = session.api {
                EditWineView(wine: wine, api: api) { saved in
                    model.apply(saved)
                } onDeleted: {
                    session.collectionChanged()
                    dismiss()
                }
            }
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
                    HStack(spacing: 6) {
                        Text(identityMeta)
                            .font(AppFont.meta())
                            .foregroundStyle(Theme.textMuted)
                        // Phase 12.4 WI-6: an imported wine's colour inferred from its identity.
                        if wine.wineColorSource == .derived {
                            SourcedMarker(accessibility: "Colour inferred from the appellation and grapes")
                        }
                    }
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

    /// Two visually distinct groups (Phase 12.1 WI-2, D2):
    /// 1. The *primary* window — "Your window" when the developer set it, else
    ///    "Window (from critics)" with the Sourced marker when derived from
    ///    agreeing critics.
    /// 2. "Critic windows (for reference)" — one row per window with its
    ///    critics' names, muted and labelled reference only. Shown whenever
    ///    any exist, so a manual window never hides what the critics said.
    /// Omitted when neither exists. Nothing is blended (CLAUDE.md §15).
    @ViewBuilder
    private var drinkingWindow: some View {
        let attributed = wine.criticSummary != nil ? DrinkingWindows.attributed(summary: wine.criticSummary) : DrinkingWindows.attributed(wine.reviewData)
        if wine.drinkingWindow != nil || !attributed.isEmpty {
            WidgetCard {
                if let window = wine.drinkingWindow {
                    SectionLabel(wine.drinkingWindowSource == .manual ? "Your window" : "Window (from critics)")
                    HStack(spacing: 6) {
                        Text(DetailFormatting.wineWindow(window))
                            .font(AppFont.cardTitle().monospacedDigit())
                        if wine.drinkingWindowSource == .derived { SourcedMarker() }
                    }
                } else if wine.windowStatus == .check {
                    SectionLabel("Drinking window")
                    Text("The critics disagree. Set your own window in Edit.")
                        .font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                }
                if !attributed.isEmpty {
                    HStack(spacing: 6) {
                        SectionLabel("Critic windows (for reference)")
                        Text("reference only")
                            .font(.system(size: 9, weight: .bold))
                            .textCase(.uppercase)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .foregroundStyle(Theme.textMuted)
                            .overlay(Capsule().strokeBorder(Theme.line, lineWidth: 1))
                    }
                    if let note = DrinkingWindows.disagreementNote(attributed) {
                        Text(note).font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                    }
                    ForEach(attributed, id: \.self) { w in
                        HStack(alignment: .firstTextBaseline) {
                            Text(verbatim: "\(w.start)–\(w.end)").font(AppFont.body().monospacedDigit())
                            Text(w.publications.joined(separator: ", "))
                                .font(AppFont.meta())
                        }
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

    // MARK: Critic reviews and Price & retailers — peer sections (WI-7)

    private var criticReviews: some View {
        let count = wine.criticSummary?.ordered.count ?? CriticScores.deduped(wine.reviewData).count
        let summary = count > 0 ? "\(count) score\(count == 1 ? "" : "s")" : (wine.reviewData == nil ? "Not fetched" : "None found")
        return DisclosureCard(title: "Critic reviews", summary: summary, isExpanded: binding(.criticReviews)) {
            VStack(alignment: .leading, spacing: 10) {
                CriticReviewsBlock(wine: wine, control: model.reviews, retry: { Task { await model.fetchReviews() } },
                                   chooseBottling: { await model.chooseBottling($0) })
                    .id("scores")
                EnrichmentButton(
                    title: wine.reviewData == nil ? "Fetch Reviews" : "Refresh Reviews",
                    label: "Reviews",
                    control: model.reviews,
                    hasData: wine.reviewData != nil,
                    run: { force in Task { await model.fetchReviews(force: force); setExpanded(.criticReviews, true) } }
                )
            }
        }
    }

    private var priceRetailers: some View {
        let summary: String = {
            if let price = WineFormatting.cardPrice(wine) { return EffectivePrice(wine).isManual ? price : "\(price) avg" }
            if let price = wine.priceData { return price.retailers.isEmpty ? "No listings" : "\(price.retailers.count) listings" }
            return "Not fetched"
        }()
        return DisclosureCard(title: "Price & retailers", summary: summary, isExpanded: binding(.priceRetailers)) {
            VStack(alignment: .leading, spacing: 10) {
                PriceRetailersBlock(
                    wine: wine,
                    control: model.price,
                    resolving: model.resolving,
                    openRetailer: { row in Task { if let url = await model.url(for: row) { openURL(url) } } },
                    retry: { Task { await model.fetchPrice() } }
                )
                EnrichmentButton(
                    title: wine.priceData == nil ? "Fetch Price & retailers" : "Refresh Price & retailers",
                    label: "Price & retailers",
                    control: model.price,
                    hasData: wine.priceData != nil,
                    run: { force in Task { await model.fetchPrice(force: force); setExpanded(.priceRetailers, true) } }
                )
            }
        }
    }

    // MARK: My Review — the developer's own tasting notes

    private var myReview: some View {
        let notes = model.notes.value ?? []
        return DisclosureCard(title: "My Review", summary: notes.isEmpty ? "No notes" : "\(notes.count) note\(notes.count == 1 ? "" : "s")",
                              isExpanded: binding(.myReview)) {
            VStack(alignment: .leading, spacing: 12) {
                if case .failed = model.notes {
                    Text("Could not load tasting notes.").font(AppFont.meta()).foregroundStyle(Theme.redPill)
                } else if notes.isEmpty {
                    Text("No tasting notes yet.").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                    Button("Evaluate this wine") { isEvaluating = true }.buttonStyle(.link).font(AppFont.meta())
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
                            HStack(spacing: 6) {
                                Image(systemName: "arrow.up.right.square")
                                LinkText("\(RetailerNames.name(for: slug, in: wine)) review")
                            }
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
