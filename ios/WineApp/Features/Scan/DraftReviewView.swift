import SwiftUI

/// Draft review (implementation spec §6.4) — the iOS `DiscoveryReview` in
/// draft mode: editable fields with missing-Tier-1 prompts, the auto-fired
/// primary-tier critic scores as they land, a Discovered / Wishlist / Cellar
/// picker, Save to collection and Discard. Reached with an already-promoted
/// wine via the duplicate path, list toggles apply immediately instead.
struct DraftReviewView: View {
    @Bindable var model: ScanFlowModel
    let onSaved: () -> Void
    @State private var confirmingDiscard = false

    var body: some View {
        Form {
            if let notice = model.vintageNotice {
                Section {
                    Text(notice).font(AppFont.meta()).foregroundStyle(Theme.accent2)
                }
            }

            if model.isDraft {
                WineFieldsSection(fields: $model.fields, missingTier1: model.missingTier1)
            } else if let wine = model.wine {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(WineFormatting.title(wine)).font(AppFont.detailTitle())
                        Text(WineFormatting.subtitle(wine)).font(AppFont.meta()).foregroundStyle(Theme.textMuted)
                    }
                }
            }

            CriticScoresBlock(wine: model.wine, autoFire: model.reviewsAutoFire)

            Section {
                ForEach(ListTag.allCases, id: \.self) { tag in
                    Button {
                        Task { await model.toggle(tag) }
                    } label: {
                        HStack {
                            Text(tag.title).foregroundStyle(Theme.text)
                            Spacer()
                            if model.isOn(tag) {
                                Image(systemName: "checkmark").foregroundStyle(Theme.accent)
                            }
                        }
                        .frame(minHeight: Theme.minHitTarget)
                    }
                    .accessibilityAddTraits(model.isOn(tag) ? .isSelected : [])
                }
            } header: {
                Text(model.isDraft ? "Save to" : "Lists")
            }

            if let error = model.actionError {
                Section {
                    Text(error).font(.system(size: 12)).foregroundStyle(Theme.redPill)
                }
            }

            if model.isDraft {
                Section {
                    Button {
                        Task { if await model.saveToCollection() { onSaved() } }
                    } label: {
                        Text(model.isSaving ? "Saving…" : "Save to collection")
                            .frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
                    }
                    .disabled(model.isSaving || !model.fields.canSave)
                    // Disabled-looking but still focusable, with the hint (§6.4).
                    .opacity(model.tags.hasAny ? 1 : 0.4)
                    if !model.tags.hasAny {
                        Text("Pick a list first.")
                            .font(AppFont.meta())
                            .foregroundStyle(Theme.textMuted)
                    }
                    Button("Discard", role: .destructive) { confirmingDiscard = true }
                        .frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .confirmationDialog("Discard this wine?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("Discard", role: .destructive) {
                Task { if await model.discard() { onSaved() } }
            }
        }
    }
}

/// The identity (Tier 1) and Tier 2 text fields. A Tier 1 field the scan
/// couldn't read is tinted `accent-2` with "· needs input"; a missing Tier 2
/// field is just empty — no highlight, no prompt (§6.4).
struct WineFieldsSection: View {
    @Binding var fields: WineFields
    let missingTier1: Set<String>

    var body: some View {
        Section("Wine") {
            field("Producer", text: $fields.producer, key: "producer", prompt: "e.g. Domaine Leroy")
            field("Denomination", text: $fields.denomination, key: "denomination", prompt: "e.g. Gevrey-Chambertin")
            field("Vintage", text: $fields.vintage, key: "vintage", prompt: "e.g. 2019 — blank for NV", numeric: true)
            if fields.vintageIsInvalid {
                Text("Enter a year, or leave blank for NV.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.redPill)
            }
            field("Region", text: $fields.region, key: "region", prompt: "e.g. Burgundy")
        }
        Section("Details") {
            field("Classification", text: $fields.qualityClassification, key: nil, prompt: "e.g. Premier Cru")
            field("Vineyard", text: $fields.vineyard, key: nil, prompt: "")
            field("Cuvée", text: $fields.cuvee, key: nil, prompt: "")
            Picker("Colour", selection: $fields.wineColor) {
                Text("Unknown").tag(WineColor?.none)
                Text("Red").tag(WineColor?.some(.red))
                Text("White").tag(WineColor?.some(.white))
                Text("Rosé").tag(WineColor?.some(.rose))
            }
        }
    }

    private func field(_ label: String, text: Binding<String>, key: String?, prompt: String,
                       numeric: Bool = false) -> some View {
        let needsInput = key.map { missingTier1.contains($0) && text.wrappedValue.trimmed.isEmpty } ?? false
        return VStack(alignment: .leading, spacing: 2) {
            Text(needsInput ? "\(label) · needs input" : label)
                .font(AppFont.sectionLabel())
                .foregroundStyle(needsInput ? Theme.accent2 : Theme.textMuted)
            TextField(prompt, text: text)
                .keyboardType(numeric ? .numberPad : .default)
                .textInputAutocapitalization(numeric ? .never : .words)
                .autocorrectionDisabled()
        }
        .listRowBackground(needsInput ? Theme.accent2Soft : Theme.surface)
    }
}

/// Critic scores on the review screen. While the auto-fired primary tier is
/// running: a 2-line skeleton, never a spinner. If it finds nothing, the
/// block disappears rather than showing an empty state mid-task (§6.4).
private struct CriticScoresBlock: View {
    let wine: Wine?
    let autoFire: ScanFlowModel.AutoFire

    var body: some View {
        let scores = CriticScores.deduped(wine?.reviewData)
        if autoFire == .running && scores.isEmpty {
            Section("Critic scores") {
                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 4).fill(Theme.surface2).frame(width: 180, height: 12)
                    RoundedRectangle(cornerRadius: 4).fill(Theme.surface2).frame(width: 120, height: 12)
                }
                .padding(.vertical, 6)
                .accessibilityLabel("Looking for critic scores")
            }
        } else if !scores.isEmpty {
            Section("Critic scores") {
                ForEach(Array(scores.enumerated()), id: \.offset) { _, score in
                    HStack {
                        Text(CriticScores.format(score.score))
                            .font(AppFont.cardTitle().monospacedDigit())
                        Text(score.publication)
                            .font(AppFont.body())
                            .foregroundStyle(score.knownPublication ? Theme.text : Theme.textMuted)
                        Spacer()
                        if let window = score.drinkingWindow, let start = window.start {
                            Text(window.end.map { "\(String(start))–\(String($0))" } ?? "from \(String(start))")
                                .font(AppFont.meta().monospacedDigit())
                                .foregroundStyle(Theme.textMuted)
                        }
                    }
                }
            }
        } else if autoFire == .failed {
            Section("Critic scores") {
                Text("Review lookup failed").font(.system(size: 12)).foregroundStyle(Theme.redPill)
            }
        }
    }
}
