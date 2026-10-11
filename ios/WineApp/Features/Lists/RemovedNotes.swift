import SwiftUI

/// Notes whose wine was deleted (Phase 12.1 WI-3, D5). A note is a record of
/// something the developer tasted, so deleting the wine neither deletes nor
/// blocks on it. Each carries its own identity snapshot, a "Wine removed"
/// tag, and opens read-only — no Evaluate, no price or review actions,
/// because there is no wine left to act on.
struct RemovedNotesSection: View {
    let notes: [TastingNote]
    let open: (TastingNote) -> Void

    var body: some View {
        if !notes.isEmpty {
            SectionLabel("From removed wines").cardRow(top: Theme.widgetGap, bottom: 0)
            ForEach(notes) { note in
                Button { open(note) } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(note.wineSummary)
                                .font(AppFont.cardTitle())
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                            Pill(text: "Wine removed", fg: Theme.textMuted, bg: Theme.surface2)
                        }
                        HStack(spacing: 8) {
                            if let rating = note.myRating {
                                Pill(text: WineFormatting.rating(rating), fg: Theme.accent, bg: Theme.accentSoft)
                            }
                            if let date = NoteDate.short(note.tastedAt) {
                                Text(date).font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                            }
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
                    .contentShape(RoundedRectangle(cornerRadius: Theme.cardRadius))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(note.wineSummary), wine removed")
                .cardRow()
            }
        }
    }
}

/// A removed wine's note, read-only.
struct RemovedNoteDetail: View {
    let note: TastingNote
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.widgetGap) {
                    WidgetCard {
                        Text(note.wineSummary).font(AppFont.detailTitle()).foregroundStyle(Theme.text)
                        if let detail = [note.wineVineyard, note.wineCuvee].compactMap({ $0 }).filter({ !$0.isEmpty }).first {
                            Text(detail).font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                        }
                        Pill(text: "Wine removed", fg: Theme.textMuted, bg: Theme.surface2)
                    }
                    WidgetCard {
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
                            Text(text).font(AppFont.body()).foregroundStyle(Theme.text)
                        }
                        let aromas = note.nosePrimaryAromas + note.noseSecondaryAromas + note.noseTertiaryAromas
                        if !aromas.isEmpty {
                            Text("Nose: " + aromas.joined(separator: ", ")).font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                        }
                        if !note.tags.isEmpty {
                            Text(note.tags.joined(separator: " · ")).font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                        }
                    }
                }
                .padding(.horizontal, Theme.sideMargin)
                .padding(.bottom, 32)
            }
            .background(Theme.bg)
            .navigationTitle("Tasting note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }
}
