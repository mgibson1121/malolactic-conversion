import SwiftUI

/// Full-width widget card: 14 pt radius, `surface` on `bg` (§4).
struct WidgetCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
    }
}

struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(AppFont.sectionLabel())
            .tracking(0.66)
            .foregroundStyle(Theme.textMuted)
            .padding(.top, 8)
    }
}

/// Widget 2 — duplicates the tab-bar action on purpose: it's the
/// highest-frequency task. Never depends on the network.
struct ScanCTA: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "camera.viewfinder")
                    .font(.system(size: 22, weight: .semibold))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Scan a label").font(AppFont.cardTitle())
                    Text("Photograph a bottle to add it").font(AppFont.meta()).opacity(0.85)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(.white)
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
            .background(Theme.accent, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
        }
        .buttonStyle(.plain)
    }
}

/// Widget 1 — `{total} bottles / {capacity} slots`, clamped fill bar,
/// `{n}% full`; red pill and "Over capacity" past 100%. Tap to edit inline.
struct CapacityWidget: View {
    let summary: CellarSummary
    let error: String?
    let save: (Int?) async -> Bool
    @State private var isEditing = false
    @State private var draft = ""
    @State private var isSaving = false

    var body: some View {
        WidgetCard {
            HStack(alignment: .firstTextBaseline) {
                Text("\(summary.totalBottles)")
                    .font(AppFont.largeTitle().monospacedDigit())
                    .foregroundStyle(Theme.text)
                Text(summary.capacity.map { "bottles / \($0) slots" } ?? "bottles")
                    .font(AppFont.meta())
                    .foregroundStyle(Theme.textMuted)
                Spacer()
                if let percent = summary.percentFull {
                    Text("\(percent)% full")
                        .font(AppFont.badge().monospacedDigit())
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .foregroundStyle(summary.isOverCapacity ? Theme.redPill : Theme.textMuted)
                        .background(summary.isOverCapacity ? Theme.redSoft : .clear, in: Capsule())
                }
            }
            if let fraction = summary.fillFraction {
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.surface2)
                        Capsule()
                            .fill(summary.isOverCapacity ? Theme.redPill : Theme.accent)
                            .frame(width: proxy.size.width * fraction)
                    }
                }
                .frame(height: 8)
                if summary.isOverCapacity {
                    Text("Over capacity")
                        .font(AppFont.badge())
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .foregroundStyle(Theme.redPill)
                        .background(Theme.redSoft, in: Capsule())
                }
            }
            if isEditing {
                HStack {
                    TextField("Total slots", text: $draft)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                    Button("Save") { Task { await commit() } }
                        .disabled(isSaving)
                    Button("Cancel") { isEditing = false }
                }
            } else {
                Button(summary.capacity == nil ? "Set cellar capacity" : "Edit capacity") {
                    draft = summary.capacity.map(String.init) ?? ""
                    isEditing = true
                }
                .font(AppFont.meta())
                .frame(minHeight: Theme.minHitTarget)
            }
            if let error {
                Text(error).font(.system(size: 12)).foregroundStyle(Theme.redPill)
            }
        }
    }

    private func commit() async {
        let trimmed = draft.trimmingCharacters(in: .whitespaces)
        let value: Int?
        if trimmed.isEmpty {
            value = nil
        } else if let parsed = Int(trimmed), parsed >= 0 {
            value = parsed
        } else {
            return
        }
        isSaving = true
        if await save(value) { isEditing = false }
        isSaving = false
    }
}

/// Widget 3 — Ready now / Needs more time / No window. Tapping a segment
/// filters the cellar list below; tapping it again clears the filter.
struct ReadinessWidget: View {
    let counts: [ReadinessSegment: Int]
    @Binding var selection: ReadinessSegment?

    var body: some View {
        WidgetCard {
            SectionLabel("Ready to drink")
            HStack(spacing: 8) {
                ForEach(ReadinessSegment.allCases) { segment in
                    let isSelected = selection == segment
                    Button {
                        selection = isSelected ? nil : segment
                    } label: {
                        VStack(spacing: 2) {
                            Text("\(counts[segment] ?? 0)")
                                .font(AppFont.detailTitle().monospacedDigit())
                            Text(segment.title)
                                .font(AppFont.meta())
                                .lineLimit(1)
                                .minimumScaleFactor(1)
                        }
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .foregroundStyle(isSelected ? Color.white : Theme.text)
                        .background(isSelected ? Theme.accent : Theme.surface2,
                                    in: RoundedRectangle(cornerRadius: Theme.buttonRadius))
                    }
                    .buttonStyle(.plain)
                    .accessibilityValue(isSelected ? "Filtering the list" : "")
                }
            }
        }
    }
}

/// Widget 4 — the web's `CellarStats` allocation bars, mobile-shaped: 96 pt
/// label column, stacked colour bar, tabular count. Top 5, then "Show all".
struct RegionWidget: View {
    let regions: [RegionAllocation]
    @State private var showAll = false

    var body: some View {
        WidgetCard {
            SectionLabel("By region")
            ForEach(showAll ? regions : Array(regions.prefix(5))) { row in
                HStack(spacing: 10) {
                    Text(row.region)
                        .font(AppFont.meta())
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(width: 96, alignment: .leading)
                    ColourBar(counts: row.counts)
                    Text("\(row.total)")
                        .font(AppFont.meta().monospacedDigit())
                        .foregroundStyle(Theme.textMuted)
                        .frame(minWidth: 24, alignment: .trailing)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(row.region), \(row.total) bottles")
            }
            if regions.count > 5 {
                Button(showAll ? "Show fewer" : "Show all \(regions.count) regions") { showAll.toggle() }
                    .font(AppFont.meta())
                    .frame(minHeight: Theme.minHitTarget)
            }
        }
    }
}

/// Widget 5 — one segmented bar with a count legend; unknown always last.
struct ColourSplitWidget: View {
    let counts: ColourCounts

    var body: some View {
        WidgetCard {
            SectionLabel("Colour split")
            ColourBar(counts: counts).frame(height: 10)
            HStack(spacing: 14) {
                legend("Red", counts.red, Theme.redWine)
                legend("White", counts.white, Theme.whiteWine)
                legend("Rosé", counts.rose, Theme.roseWine)
                legend("Unknown", counts.unknown, Theme.textMuted)
            }
        }
    }

    @ViewBuilder
    private func legend(_ title: String, _ count: Int, _ colour: Color) -> some View {
        if count > 0 {
            HStack(spacing: 4) {
                Circle().fill(colour).frame(width: 8, height: 8)
                Text("\(title) \(count)").font(AppFont.meta().monospacedDigit()).foregroundStyle(Theme.textMuted)
            }
        }
    }
}

/// A stacked red/white/rosé/unknown bar. Non-zero segments are floored at 4%
/// of the width so a 1-of-40 bottle stays visible (§7.4).
struct ColourBar: View {
    let counts: ColourCounts

    var body: some View {
        GeometryReader { proxy in
            HStack(spacing: 1) {
                ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                    Rectangle()
                        .fill(segment.colour)
                        .frame(width: proxy.size.width * segment.fraction)
                }
            }
            .clipShape(Capsule())
        }
        .frame(height: 8)
    }

    private var segments: [(colour: Color, fraction: CGFloat)] {
        let raw: [(Color, Int)] = [
            (Theme.redWine, counts.red), (Theme.whiteWine, counts.white),
            (Theme.roseWine, counts.rose), (Theme.textMuted, counts.unknown),
        ]
        let present = raw.filter { $0.1 > 0 }
        guard counts.total > 0 else { return [] }
        let floored = present.map { (colour: $0.0, fraction: max(CGFloat($0.1) / CGFloat(counts.total), 0.04)) }
        let sum = floored.reduce(0) { $0 + $1.fraction }
        return floored.map { (colour: $0.colour, fraction: $0.fraction / sum) }
    }
}
