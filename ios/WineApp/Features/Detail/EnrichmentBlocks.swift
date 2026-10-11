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
                found
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
                    Pill(text: String(vintage), fg: Theme.textMuted, bg: Theme.surface2)
                        .accessibilityLabel("Score is for the \(vintage) vintage")
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
    }

    @ViewBuilder
    private func automated(titled: Bool) -> some View {
        if titled {
            Text("Retailer prices (automated)").font(AppFont.sectionLabel()).foregroundStyle(Theme.textMuted)
        }
        if let price = wine.priceData {
            if wine.enrichmentStale?.price == true { StaleNotice() }
            if price.retailers.isEmpty {
                Text("No matching listings found at the configured retailers.")
                    .font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                Text("Checked \(NoteDate.short(price.fetchedAt) ?? "recently")")
                    .font(AppFont.meta()).foregroundStyle(Theme.textMuted)
            } else {
                if price.headlineBasis == .ambiguous, let groups = price.priceGroups {
                    // Counted prices span 2.5x or more (Phase 12.2 D10): no single average.
                    VStack(alignment: .leading, spacing: 4) {
                        Text("These prices are too far apart for one average — this may be more than one bottling.")
                            .font(AppFont.body()).foregroundStyle(Theme.text)
                        ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
                            Text("\(DetailFormatting.priceRange(group.min, group.max)) · \(group.retailers.count) \(group.retailers.count == 1 ? "listing" : "listings")")
                                .font(AppFont.body().monospacedDigit())
                        }
                    }
                } else if price.priceAvg != nil {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("Avg \(DetailFormatting.priceBound(price.priceAvg)) · High \(DetailFormatting.priceBound(price.priceMax)) · Low \(DetailFormatting.priceBound(price.priceMin))")
                            .font(AppFont.body().monospacedDigit())
                        if price.headlineEstimated == true {
                            Text("estimated").font(AppFont.meta().italic()).foregroundStyle(Theme.textMuted)
                        }
                    }
                    if price.headlineBasis == .singleListing {
                        Text(price.headlineEstimated == true
                             ? "Based on a single listing, counted at a per-bottle price."
                             : "Based on a single listing — size not confirmed.")
                            .font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                    }
                } else if let why = wine.priceExclusions?.sentence {
                    Text(why).font(AppFont.body()).foregroundStyle(Theme.text)
                }
                if let other = price.otherVintagePriceRange {
                    Text("Other vintages: \(DetailFormatting.priceBound(other.min))–\(DetailFormatting.priceBound(other.max))")
                        .font(AppFont.meta().monospacedDigit())
                        .foregroundStyle(Theme.textMuted)
                }
                retailerRows(price)
                if let date = NoteDate.short(price.fetchedAt) {
                    Text("Updated \(date)").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                }
            }
        } else if control.isBusy {
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4).fill(Theme.surface2).frame(width: 200, height: 12)
                Text("Looking up prices…").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
        } else if control.error != nil {
            HStack(spacing: 4) {
                Text("Price lookup failed —").font(.system(size: 12)).foregroundStyle(Theme.redPill)
                if let retry { Button("Try again", action: retry).buttonStyle(.link).font(.system(size: 12)) }
            }
        } else {
            Text("No price data yet.").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
        }
    }

    /// The nearest retailer as a tappable, underlined line, then the rest
    /// collapsed under "N more retailers" (D7).
    @ViewBuilder
    private func retailerRows(_ price: PriceData) -> some View {
        let rows = RetailerTable.ordered(price)
        let nearest = price.nearestRetailer.flatMap { n in rows.first { $0.slug == n.slug } }
        let rest = rows.filter { $0.slug != nearest?.slug }
        if let nearest {
            RetailerRow(retailer: nearest, isNearest: true, isResolving: resolving.contains(nearest.slug)) {
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
                    RetailerRow(retailer: row, isNearest: false, isResolving: resolving.contains(row.slug)) {
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
