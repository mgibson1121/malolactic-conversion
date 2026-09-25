import SwiftUI

/// The compressed card (implementation spec §7.1): exactly three lines plus a
/// right rail, 96–112 pt, no buttons. Actions arrive as swipe and long-press
/// in a later slice.
struct WineRowView: View {
    let wine: Wine
    let kind: ListKind
    /// Opens the detail screen; `true` when the tap landed on the score badge
    /// (Research opens, scrolled to scores — implementation spec §8).
    var onOpen: ((_ focusScores: Bool) -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            ColourDot(colour: wine.wineColor)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(WineFormatting.title(wine))
                        .font(AppFont.cardTitle())
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 0)
                    if kind == .cellar {
                        // Reserves its intrinsic width; the title truncates first.
                        Text("\(wine.cellarQuantity) btl")
                            .font(AppFont.meta().monospacedDigit())
                            .foregroundStyle(Theme.textMuted)
                            .layoutPriority(1)
                    }
                }
                Text(WineFormatting.subtitle(wine))
                    .font(AppFont.meta())
                    .foregroundStyle(Theme.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                BadgeRun(items: badges, onScoreTap: onOpen.map { open in { open(true) } })
            }
        }
        .padding(14)
        .frame(minHeight: 96, alignment: .top)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
        .contentShape(RoundedRectangle(cornerRadius: Theme.cardRadius))
        .onTapGesture { onOpen?(false) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
        .accessibilityAddTraits(onOpen == nil ? [] : .isButton)
        .accessibilityAction { onOpen?(false) }
    }

    /// Line 3 in priority order, highest first: rating > critic score >
    /// price > drinking window — except Wishlist, where price outranks the
    /// window already, and Notes, where the note date replaces price/window.
    private var badges: [BadgeItem] {
        var items: [BadgeItem] = []
        if let rating = wine.myRating {
            items.append(.rating(rating))
        }
        if let score = CriticScores.cardBadge(wine.reviewData) {
            items.append(.score(score))
        }
        if kind == .notes {
            if let date = NoteDate.short(wine.latestTastingNoteDate) { items.append(.text(date)) }
            return items
        }
        if let price = WineFormatting.price(wine.priceData?.priceAvg) {
            items.append(.text(price))
        }
        if let window = WineFormatting.drinkWindow(wine.drinkingWindow) {
            items.append(.text(window))
        }
        return items
    }

    private var accessibilitySummary: String {
        var parts = [WineFormatting.title(wine), WineFormatting.vintage(wine)]
        if let region = wine.region { parts.append(region) }
        if kind == .cellar { parts.append("\(wine.cellarQuantity) bottles") }
        if let rating = wine.myRating { parts.append("rated \(WineFormatting.rating(rating))") }
        if let score = CriticScores.cardBadge(wine.reviewData) {
            parts.append("\(CriticScores.format(score.score)) from \(score.publication)")
            if score.additionalCount > 0 { parts.append("plus \(score.additionalCount) more scores") }
        }
        return parts.joined(separator: ", ")
    }
}

enum BadgeItem: Hashable {
    case rating(MyRating)
    case score(CardScoreBadge)
    case text(String)
}

/// A single-line run that drops whole badges right-to-left until it fits —
/// never wraps, never scales, never ellipsizes a badge (§7.1). `ViewThatFits`
/// tries the full run, then each shorter prefix.
struct BadgeRun: View {
    let items: [BadgeItem]
    var onScoreTap: (() -> Void)?

    var body: some View {
        ViewThatFits(in: .horizontal) {
            ForEach(Array(stride(from: items.count, through: 1, by: -1)), id: \.self) { count in
                HStack(spacing: 6) {
                    ForEach(items.prefix(count), id: \.self) { item in
                        if case .score = item, let onScoreTap {
                            // A 44 pt tall hit area (§7.2) that doesn't grow the
                            // card: pad, claim the padded shape, pad back out.
                            BadgeView(item: item)
                                .padding(.vertical, 13)
                                .contentShape(Rectangle())
                                .onTapGesture(perform: onScoreTap)
                                .padding(.vertical, -13)
                        } else {
                            BadgeView(item: item)
                        }
                    }
                }
                .fixedSize()
            }
        }
    }
}

private struct BadgeView: View {
    let item: BadgeItem

    var body: some View {
        switch item {
        case .rating(let rating):
            Text(WineFormatting.rating(rating))
                .font(AppFont.badge())
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(Theme.accentSoft, in: Capsule())
                .foregroundStyle(Theme.accent)
        case .score(let badge):
            HStack(spacing: 3) {
                Text(badge.text).monospacedDigit()
                if let suffix = badge.suffix {
                    Text(suffix).foregroundStyle(Theme.textMuted)
                }
            }
            .font(AppFont.badge())
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .overlay(
                Capsule().strokeBorder(Theme.line, style: StrokeStyle(lineWidth: 1, dash: badge.isKnownPublication ? [] : [3, 2]))
            )
            .foregroundStyle(Theme.text)
        case .text(let text):
            Text(text)
                .font(AppFont.meta().monospacedDigit())
                .foregroundStyle(Theme.textMuted)
        }
    }
}

/// 8 pt filled dot; unknown colour is a hollow ring, never a grey fill, so
/// colour is never the only carrier (§11).
struct ColourDot: View {
    let colour: WineColor?

    var body: some View {
        Group {
            if let colour {
                Circle().fill(Theme.colour(for: colour))
            } else {
                Circle().strokeBorder(Theme.textMuted, lineWidth: 1.5)
            }
        }
        .frame(width: 8, height: 8)
        .accessibilityLabel(label)
    }

    private var label: String {
        switch colour {
        case .red: return "Red wine"
        case .white: return "White wine"
        case .rose: return "Rosé wine"
        case nil: return "Colour unknown"
        }
    }
}

enum NoteDate {
    /// `Mar 2, 2026` from an ISO timestamp.
    static func short(_ iso: String?) -> String? {
        guard let iso, let date = parse(iso) else { return nil }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    static func parse(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }
}
