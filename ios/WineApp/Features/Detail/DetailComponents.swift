import SwiftUI

struct Pill: View {
    let text: String
    let fg: Color
    let bg: Color
    var sourced = false

    var body: some View {
        HStack(spacing: 4) {
            Text(text)
            if sourced { SourcedMarker() }
        }
        .font(AppFont.badge())
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .foregroundStyle(fg)
        .background(bg, in: Capsule())
    }
}

/// `*_source == 'derived'` — the value came from automated review
/// extraction, not from the developer.
struct SourcedMarker: View {
    var body: some View {
        Text("Sourced")
            .font(.system(size: 9, weight: .bold))
            .textCase(.uppercase)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .foregroundStyle(Theme.accent2)
            .overlay(Capsule().strokeBorder(Theme.accent2, lineWidth: 1))
            .accessibilityLabel("Sourced from review extraction")
    }
}

/// One of the detail screen's three disclosure groups (implementation spec
/// §8): a 56 pt row with the headline fact on the right, so collapsing costs
/// nothing when the summary is all that's needed. Expanding never fires a
/// request — the buttons inside are the only fetch triggers.
struct DisclosureCard<Content: View>: View {
    let title: String
    let summary: String
    @Binding var isExpanded: Bool
    @ViewBuilder let content: Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.25)) { isExpanded.toggle() }
            } label: {
                HStack {
                    Text(title).font(AppFont.cardTitle()).foregroundStyle(Theme.text)
                    Spacer()
                    Text(summary).font(AppFont.meta().monospacedDigit()).foregroundStyle(Theme.textMuted)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textMuted)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .frame(minHeight: 56)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(title), \(summary)")
            .accessibilityValue(isExpanded ? "expanded" : "collapsed")
            .accessibilityAddTraits(.isButton)

            if isExpanded {
                content.padding(.bottom, 14)
            }
        }
        .padding(.horizontal, 14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
    }
}

/// A metered Fetch/Refresh button (implementation spec §9), with a separate
/// bordered Hard refresh beside it (Phase 12.1 D6, WI-7). The normal button is
/// TTL-guarded: when the server answered from its cache, the freshness line
/// says so. Hard refresh sends `force`, spends credits, and says how many —
/// on the button and again in the confirmation, since it costs money. It
/// replaces the old "Refresh anyway" text link.
struct EnrichmentButton: View {
    let title: String
    /// "Reviews" / "Price" — for "Reviews updated 3 days ago."
    let label: String
    let kind: EnrichmentCosts.Kind
    let control: EnrichmentControl
    /// Hard refresh needs data to refresh; shown once any exists.
    let hasData: Bool
    let run: (_ force: Bool) -> Void
    @State private var confirmingHardRefresh = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                run(false)
            } label: {
                Text(control.isBusy ? "Fetching…" : title)
                    .frame(minHeight: Theme.minHitTarget)
            }
            .buttonStyle(.bordered)
            .disabled(control.isBusy)

            if hasData {
                Button {
                    confirmingHardRefresh = true
                } label: {
                    VStack(spacing: 0) {
                        Text("Hard refresh")
                        Text(EnrichmentCosts.label(kind))
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textMuted)
                    }
                    .frame(minHeight: Theme.minHitTarget)
                }
                .buttonStyle(.bordered)
                .tint(Theme.accent)
                .disabled(control.isBusy)
                .accessibilityLabel("Hard refresh, \(EnrichmentCosts.label(kind))")
                .confirmationDialog("Hard refresh \(label)?", isPresented: $confirmingHardRefresh,
                                    titleVisibility: .visible) {
                    Button("Hard refresh · \(EnrichmentCosts.label(kind))") { run(true) }
                } message: {
                    Text("This ignores what's stored and runs the search again — \(EnrichmentCosts.label(kind)).")
                }
            }

            if let cachedAt = control.cachedAt {
                Text("\(label) updated \(DetailFormatting.age(cachedAt)).")
                    .font(AppFont.meta())
                    .foregroundStyle(Theme.textMuted)
            }
            if let error = control.error {
                Text(error).font(.system(size: 12)).foregroundStyle(Theme.redPill)
            }
        }
    }
}

/// One critic citation in full: number, source, and the Phase 8 attributes
/// when the source stated them — each independently optional, never inferred.
struct CriticScoreRow: View {
    let score: CriticScore

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(CriticScores.format(score.score))
                    .font(AppFont.cardTitle().monospacedDigit())
                    .foregroundStyle(Theme.text)
                Text(score.publication)
                    .font(AppFont.body())
                    .foregroundStyle(score.knownPublication ? Theme.text : Theme.textMuted)
            }
            let attributes = [
                DetailFormatting.criticWindow(score.drinkingWindow),
                score.vintageCharacter.map(DetailFormatting.vintageCharacter),
                score.deal ? "Value pick" : nil,
            ].compactMap { $0 }
            if !attributes.isEmpty {
                Text(attributes.joined(separator: " · "))
                    .font(AppFont.meta())
                    .foregroundStyle(Theme.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A retailer as two lines, not a table row (§7.3): name and price, then the
/// badge line, which drops right-to-left — distance first, verification never.
/// The name is the tappable link (underlined, D9). Verified / Unverified /
/// Search only each explain themselves on tap (WI-8).
struct RetailerRow: View {
    let retailer: RetailerPrice
    let isNearest: Bool
    let isResolving: Bool
    let open: () -> Void
    @State private var explained: RetailerBadge?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button(action: open) {
                HStack {
                    Text(String(retailer.name.prefix(22)) + (retailer.name.count > 22 ? "…" : ""))
                        .font(AppFont.body())
                        .underline()
                        .foregroundStyle(Theme.accent)
                        .lineLimit(1)
                    if isNearest {
                        Text("Nearest").font(AppFont.badge()).foregroundStyle(Theme.textMuted)
                    }
                    Spacer()
                    if !retailer.linkOnly, let price = WineFormatting.price(retailer.price) {
                        // A counted pack, case or magnum shows the shelf price and the per-bottle figure.
                        if retailer.normalized != nil, let each = WineFormatting.price(retailer.pricePer750) {
                            Text("\(price) · \(each) a bottle").font(AppFont.body().monospacedDigit()).foregroundStyle(Theme.text)
                        } else {
                            Text(price).font(AppFont.body().monospacedDigit()).foregroundStyle(Theme.text)
                        }
                    }
                    if isResolving {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: retailer.isSearchResultsPage ? "magnifyingglass" : "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.textMuted)
                    }
                }
                .frame(minHeight: Theme.minHitTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(retailer.isSearchResultsPage
                               ? "Opens a search at \(retailer.name), not a direct product page"
                               : "Opens the product page")

            ViewThatFits(in: .horizontal) {
                let badges = RetailerTable.badges(retailer)
                ForEach(Array(stride(from: badges.count, through: 1, by: -1)), id: \.self) { count in
                    HStack(spacing: 6) {
                        ForEach(badges.prefix(count), id: \.self) { badge in
                            RetailerBadgeView(badge: badge, explained: $explained)
                        }
                    }
                    .fixedSize()
                }
            }

            if let badge = explained, let text = BadgeExplanation.text(for: badge) {
                Text(text)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textMuted)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.buttonRadius))
            }
        }
        .padding(.vertical, 4)
    }
}

private struct RetailerBadgeView: View {
    let badge: RetailerBadge
    @Binding var explained: RetailerBadge?

    var body: some View {
        switch badge {
        case .verified:
            explainable(Pill(text: badge.text, fg: Theme.green, bg: Theme.greenSoft))
        case .unverified:
            explainable(Pill(text: badge.text, fg: Theme.redPill, bg: Theme.redSoft))
        case .searchOnly:
            explainable(Text(badge.text).font(AppFont.meta()).foregroundStyle(Theme.textMuted))
        case .vintageMismatch:
            Pill(text: badge.text, fg: Theme.redPill, bg: Theme.redSoft)
        case .format:
            Pill(text: badge.text, fg: Theme.text, bg: Theme.accent2Soft)
        case .vintage, .distance:
            Text(badge.text).font(AppFont.meta().monospacedDigit()).foregroundStyle(Theme.textMuted)
        }
    }

    /// A badge that explains itself on tap: underlined (D9), a 44 pt target
    /// that doesn't grow the row, and exposed as a button.
    private func explainable<Content: View>(_ content: Content) -> some View {
        Button {
            explained = (explained == badge) ? nil : badge
        } label: {
            content.underline()
                .padding(.vertical, 13)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, -13)
        .accessibilityLabel("\(BadgeExplanation.title(for: badge) ?? badge.text). Double tap to explain.")
    }
}
