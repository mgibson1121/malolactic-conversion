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

/// A metered Fetch/Refresh button (implementation spec §9). When the server
/// answered from its TTL cache, the freshness line offers "Refresh anyway" —
/// plain text, not a second primary button, because it's the path that
/// spends credits.
struct EnrichmentButton: View {
    let title: String
    /// "Price" / "Reviews" — for "Price updated 3 days ago."
    let label: String
    let control: EnrichmentControl
    let run: (_ force: Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                run(false)
            } label: {
                Text(control.isBusy ? "Fetching…" : title)
                    .frame(minHeight: Theme.minHitTarget)
            }
            .buttonStyle(.bordered)
            .disabled(control.isBusy)

            if let cachedAt = control.cachedAt {
                HStack(spacing: 4) {
                    Text("\(label) updated \(DetailFormatting.age(cachedAt)).")
                    Button("Refresh anyway") { run(true) }
                        .disabled(control.isBusy)
                }
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
struct RetailerRow: View {
    let retailer: RetailerPrice
    let isNearest: Bool
    let isResolving: Bool
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(String(retailer.name.prefix(22)) + (retailer.name.count > 22 ? "…" : ""))
                        .font(AppFont.body())
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    if isNearest {
                        Text("Nearest").font(AppFont.badge()).foregroundStyle(Theme.accent)
                    }
                    Spacer()
                    if !retailer.linkOnly, let price = WineFormatting.price(retailer.price) {
                        Text(price).font(AppFont.body().monospacedDigit()).foregroundStyle(Theme.text)
                    }
                    if isResolving {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: retailer.isSearchResultsPage ? "magnifyingglass" : "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.textMuted)
                    }
                }
                ViewThatFits(in: .horizontal) {
                    let badges = RetailerTable.badges(retailer)
                    ForEach(Array(stride(from: badges.count, through: 1, by: -1)), id: \.self) { count in
                        HStack(spacing: 6) {
                            ForEach(badges.prefix(count), id: \.self) { RetailerBadgeView(badge: $0) }
                        }
                        .fixedSize()
                    }
                }
            }
            .padding(.vertical, 8)
            .frame(minHeight: Theme.minHitTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(retailer.isSearchResultsPage
                           ? "Opens a search at \(retailer.name), not a direct product page"
                           : "Opens the product page")
    }
}

private struct RetailerBadgeView: View {
    let badge: RetailerBadge

    var body: some View {
        switch badge {
        case .verified:
            Pill(text: badge.text, fg: Theme.green, bg: Theme.greenSoft)
        case .unverified:
            Pill(text: badge.text, fg: Theme.redPill, bg: Theme.redSoft)
        case .vintageMismatch:
            Pill(text: badge.text, fg: Theme.redPill, bg: Theme.redSoft)
        case .format:
            Pill(text: badge.text, fg: Theme.text, bg: Theme.accent2Soft)
        case .vintage, .searchOnly, .distance:
            Text(badge.text).font(AppFont.meta().monospacedDigit()).foregroundStyle(Theme.textMuted)
        }
    }
}
