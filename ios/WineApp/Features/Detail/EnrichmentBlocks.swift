import SwiftUI

// The critic and price blocks shared by the draft review screen and the
// detail screen (Phase 12.1 WI-4, WI-7, WI-9). One implementation, so the
// preview and the saved wine cannot show different things for the same data.

// MARK: - Critic reviews

/// The four explicit states of the critic block (WI-4) plus `idle`, a wine
/// whose scores were simply never looked up. The block never vanishes: the
/// old "disappears if nothing is found" rule made "still loading" and "found
/// nothing" indistinguishable (the developer's 2026-10-04 complaint).
enum CriticReviewsState: Equatable {
    case looking
    case found
    case none
    case failed
    case idle

    static func of(wine: Wine?, control: EnrichmentControl) -> CriticReviewsState {
        if !(wine?.criticSummary?.ordered.isEmpty ?? true) { return .found }
        // An older backend sends no summary; fall back to the stored scores.
        if wine?.criticSummary == nil, !CriticScores.deduped(wine?.reviewData).isEmpty { return .found }
        if control.isBusy { return .looking }
        if control.error != nil { return .failed }
        if wine?.reviewData != nil { return .none }
        return .idle
    }
}

struct CriticReviewsBlock: View {
    let wine: Wine?
    let control: EnrichmentControl
    /// "Try again" in the failed state.
    var retry: (() -> Void)?
    /// "Search more retailers" in the nothing-found state (the extended tier,
    /// still a click — preview only).
    var searchMore: (() -> Void)?
    /// "Which bottling is yours?" (Phase 12.2). Absent where the answer cannot be saved.
    var chooseBottling: ((BottlingChoice) async -> BottlingOutcome)?
    @State private var showAll = false

    private let visibleScores = 6

    var body: some View {
        let state = CriticReviewsState.of(wine: wine, control: control)
        VStack(alignment: .leading, spacing: 8) {
            if wine?.enrichmentStale?.reviews == true { StaleNotice() }
            switch state {
            case .looking:
                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 4).fill(Theme.surface2).frame(width: 180, height: 12)
                    RoundedRectangle(cornerRadius: 4).fill(Theme.surface2).frame(width: 120, height: 12)
                    Text("Looking for critic scores…").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
            case .failed:
                HStack(spacing: 4) {
                    Text("Review lookup failed —").font(.system(size: 12)).foregroundStyle(Theme.redPill)
                    if let retry { Button("Try again", action: retry).buttonStyle(.link).font(.system(size: 12)) }
                }
            case .none:
                Text("No critic scores found yet for this wine.").font(AppFont.body()).foregroundStyle(Theme.text)
                if let searchMore {
                    Button("Search more retailers", action: searchMore).buttonStyle(.link).font(AppFont.meta())
                }
            case .idle:
                Text("Critic scores haven't been looked up yet.").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
            case .found:
                if let ladder = wine?.reviewLadder, ladder.tier != "none" {
                    TierMarker(ladder: ladder)
                }
                found
            }
            if let scoreless = wine?.reviewLadder?.pages?.filter({ $0.scores == 0 }), !scoreless.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text(scoreless.count == 1 ? "A page was found but no score could be read from it. It may carry a review without a score." : "\(scoreless.count) pages were found but no score could be read from them. They may carry reviews without a score.")
                        .font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                    ForEach(scoreless, id: \.productUrl) { page in
                        if let url = URL(string: page.productUrl) {
                            Link(page.name + (page.pageVintage.map { " (\($0))" } ?? ""), destination: url).underline().font(AppFont.meta())
                        }
                    }
                }
            }
            if let wine, let chooseBottling {
                BottlingBanner(wine: wine, choose: chooseBottling)
            }
        }
    }

    @ViewBuilder
    private var found: some View {
        let ordered = wine?.criticSummary?.ordered ?? []
        if ordered.isEmpty {
            // Older backend: render the stored scores as they are.
            ForEach(Array(CriticScores.deduped(wine?.reviewData).enumerated()), id: \.offset) { _, score in
                CriticScoreRow(score: score)
            }
        } else {
            let shown = showAll ? ordered : Array(ordered.prefix(visibleScores))
            let same = shown.filter(\.sameVintage)
            let other = shown.filter { !$0.sameVintage }
            if !same.isEmpty {
                group(wine?.vintage.map { "Your vintage (\($0))" } ?? "This wine", same)
            }
            if !other.isEmpty { group("Other vintages", other) }
            if ordered.count > visibleScores {
                Button(showAll ? "Show fewer" : "Show all \(ordered.count) scores") { showAll.toggle() }
                    .buttonStyle(.link)
                    .font(AppFont.meta())
            }
        }
    }

    private func group(_ title: String, _ items: [CriticSummaryItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(AppFont.sectionLabel()).foregroundStyle(Theme.textMuted)
            ForEach(items, id: \.publication) { CriticSummaryRow(item: $0) }
        }
    }
}

/// One score in the backend's order: number, source, a Trusted marker, the
/// vintage it applies to (D10) and the Phase 8 attributes when stated.
struct CriticSummaryRow: View {
    let item: CriticSummaryItem

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(CriticScores.format(item.score))
                    .font(AppFont.cardTitle().monospacedDigit())
                    .foregroundStyle(Theme.text)
                Text(item.publication)
                    .font(AppFont.body())
                    .foregroundStyle(item.knownPublication ? Theme.text : Theme.textMuted)
                if item.trusted {
                    Pill(text: "Trusted", fg: Theme.green, bg: Theme.greenSoft)
                }
                if !item.sameVintage, let vintage = item.vintage {
                    // The year only, never the distance from the wine's (Phase 12.3 WI-3).
                    Pill(text: String(vintage), fg: Theme.textMuted, bg: Theme.surface2)
                        .accessibilityLabel("Score is for the \(vintage) vintage")
                }
                if item.bottlingBadge != nil {
                    Pill(text: "different bottling", fg: Theme.textMuted, bg: Theme.surface2)
                        .accessibilityLabel(item.bottlingBadge ?? "")
                }
            }
            let attributes = [
                DetailFormatting.criticWindow(item.drinkingWindow),
                item.vintageCharacter.map(DetailFormatting.vintageCharacter),
                item.deal ? "Value pick" : nil,
            ].compactMap { $0 }
            if !attributes.isEmpty {
                Text(attributes.joined(separator: " · "))
                    .font(AppFont.meta())
                    .foregroundStyle(Theme.textMuted)
            }
        }
        .opacity(item.sameVintage ? 1 : 0.85)
        .accessibilityElement(children: .combine)
    }
}

struct StaleNotice: View {
    var body: some View {
        Text("Fetched for a different version of this wine — may not match. Refresh.")
            .font(.system(size: 12))
            .foregroundStyle(Theme.text)
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.accent2Soft, in: RoundedRectangle(cornerRadius: Theme.buttonRadius))
    }
}

// MARK: - Price & retailers

/// "Price & retailers" (WI-4, WI-7, D7, D12). The developer's own price is the
/// headline when set, marked "yours"; the automated avg/high/low stay below as
/// "Retailer prices (automated)", informational. Listings found but none
/// counted say why, in plain language, instead of a row of dashes.
struct PriceRetailersBlock: View {
    let wine: Wine
    let control: EnrichmentControl
    let resolving: Set<String>
    let openRetailer: (RetailerPrice) -> Void
    var retry: (() -> Void)?
    @State private var showMore = false
    @State private var showSplitSheet = false

    var body: some View {
        let manual = EffectivePrice(wine).isManual
        VStack(alignment: .leading, spacing: 8) {
            if manual, let price = WineFormatting.price(wine.manualPrice) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Your price (per 750 ml bottle)").font(AppFont.sectionLabel()).foregroundStyle(Theme.textMuted)
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(price).font(AppFont.detailTitle().monospacedDigit()).foregroundStyle(Theme.text)
                        Pill(text: "yours", fg: Theme.accent, bg: Theme.accentSoft)
                    }
                }
            }
            automated(titled: manual)
        }
        .sheet(isPresented: $showSplitSheet) {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("The highest price is 2.5 times the lowest or more, which usually means more than one bottling. Nothing was dropped.")
                    }
                    .font(AppFont.body())
                    .padding()
                }
                .navigationTitle("Why no single average")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showSplitSheet = false } } }
            }
            .presentationDetents([.medium])
        }
    }

    @ViewBuilder
    private func automated(titled: Bool) -> some View {
        if titled {
            Text("Retailer prices (automated)").font(AppFont.sectionLabel()).foregroundStyle(Theme.textMuted)
        }
        if let price = wine.priceData {
            if wine.enrichmentStale?.price == true { StaleNotice() }
            stateLine(price)
            if wine.priceState?.kind == .wideRange, let groups = price.priceGroups {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Text("Split by the 2.5× rule").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                        Button { showSplitSheet = true } label: {
                            Text("ⓘ").underline().font(AppFont.meta()).foregroundStyle(Theme.accent)
                                .frame(minWidth: 28, minHeight: Theme.minHitTarget)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("What is the 2.5× rule?")
                    }
                    ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
                        Text("\(DetailFormatting.priceRange(group.min, group.max)) · \(group.retailers.count) \(group.retailers.count == 1 ? "shop" : "shops")")
                            .font(AppFont.body().monospacedDigit())
                    }
                }
            }
            retailerRows(price)
            if let date = NoteDate.short(price.fetchedAt) {
                Text("Updated \(date)").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
            }
        } else if control.isBusy {
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4).fill(Theme.surface2).frame(width: 200, height: 12)
                Text("Checking prices…").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
        } else if control.error != nil {
            // An error or timeout only (12.4 WI-7) — neutral, not alarming (12.5 WI-1).
            HStack(spacing: 4) {
                Text("Couldn't check prices.").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                if let retry { Button("Retry", action: retry).buttonStyle(.link).font(AppFont.meta()) }
            }
        } else {
            Text("No price data yet.").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
        }
    }

    /// The one line the backend chose (Phase 12.5 WI-1): "$85 avg · $70–$110",
    /// "Prices vary widely", "No prices found" …
    @ViewBuilder
    private func stateLine(_ price: PriceData) -> some View {
        if let state = wine.priceState {
            let headline = state.kind == .priced || state.kind == .estimated
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(state.line)
                    .font(headline ? AppFont.cardTitle().monospacedDigit() : AppFont.body())
                    .foregroundStyle(headline ? Theme.text : Theme.textMuted)
                if headline, let range = state.range, range.min != range.max {
                    Text("· \(DetailFormatting.priceRange(range.min, range.max))")
                        .font(AppFont.body().monospacedDigit()).foregroundStyle(Theme.textMuted)
                }
                if headline, !state.exact.isEmpty { ExactMatchBadge() }
            }
            .accessibilityIdentifier("price-state-line")
        } else if let avg = WineFormatting.price(price.priceAvg) {
            // An older backend sends no state.
            Text("\(avg) avg").font(AppFont.cardTitle().monospacedDigit())
        }
    }

    /// The rows the price list shows (Phase 12.5 WI-2): priced, within ±3
    /// vintages, in the one display order — the backend's `price_state.priced`.
    /// Search-only links live under Trusted Retailers. An older backend's data
    /// falls back to its window order, priced rows only.
    private func visibleRows(_ price: PriceData) -> [RetailerPrice] {
        if let priced = wine.priceState?.priced {
            return priced.compactMap { slug in price.retailers.first { $0.slug == slug } }
        }
        let hidden = Set(wine.priceWindow?.hidden ?? [])
        return RetailerTable.ordered(price).filter { !hidden.contains($0.slug) && !$0.linkOnly && $0.price != nil }
    }

    /// The nearest retailer as a tappable, underlined line, then the rest
    /// collapsed under "N more retailers" (D7).
    @ViewBuilder
    private func retailerRows(_ price: PriceData) -> some View {
        let rows = visibleRows(price)
        let nearest = price.nearestRetailer.flatMap { n in rows.first { $0.slug == n.slug } }
        let rest = rows.filter { $0.slug != nearest?.slug }
        if let nearest {
            RetailerRow(retailer: nearest, isNearest: true, isResolving: resolving.contains(nearest.slug),
                        isExact: wine.priceState?.exact.contains(nearest.slug) == true) {
                openRetailer(nearest)
            }
        }
        if !rest.isEmpty {
            Button(showMore ? "Hide" : "\(rest.count) more \(rest.count == 1 ? "retailer" : "retailers")") {
                withAnimation { showMore.toggle() }
            }
            .buttonStyle(.link)
            .font(AppFont.meta())
            if showMore {
                ForEach(Array(rest.enumerated()), id: \.offset) { index, row in
                    RetailerRow(retailer: row, isNearest: false, isResolving: resolving.contains(row.slug),
                                isExact: wine.priceState?.exact.contains(row.slug) == true) {
                        openRetailer(row)
                    }
                    if index < rest.count - 1 { Divider() }
                }
            }
        }
    }
}

// MARK: - Resolving a retailer link

/// Turns a search-results link into the retailer's real product page on tap
/// (Phase 9.2 WI-6): one Serper credit spent at the moment of intent, falling
/// back to the search after 3 s so a tap is never stranded. Shared by the
/// detail screen and the review screen so a retailer link behaves the same
/// in both (WI-4: "resolving on tap exactly as the detail view does").
enum RetailerLinkResolver {
    /// The URL to open, and the wine the server returned if it resolved one.
    static func resolve(_ retailer: RetailerPrice, wineID: String, api: APIClient) async -> (url: URL?, wine: Wine?) {
        let fallback = URL(string: retailer.url)
        guard retailer.isSearchResultsPage else { return (fallback, nil) }
        let slug = retailer.slug
        let resolved: Wine? = await withTaskGroup(of: Wine?.self) { group in
            group.addTask { try? await api.resolveRetailerURL(wineID: wineID, slug: slug) }
            group.addTask {
                try? await Task.sleep(for: .seconds(3))
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
        guard let resolved else { return (fallback, nil) }
        let url = resolved.priceData?.retailers.first { $0.slug == slug }?.url
        return (url.flatMap(URL.init(string:)) ?? fallback, resolved)
    }
}
