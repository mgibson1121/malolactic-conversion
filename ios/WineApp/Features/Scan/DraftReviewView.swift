import SwiftUI

/// Draft review (implementation spec §6.4) — the iOS `DiscoveryReview` in
/// draft mode: editable fields with missing-Tier-1 prompts, the critic and
/// price blocks (each with four explicit states, Phase 12.1 WI-4), an
/// "Add to which list?" picker whose rows look selectable (WI-6), and a
/// Save/Discard bar pinned to the bottom so neither scrolls away. Reached with
/// an already-promoted wine via the duplicate path, list toggles apply
/// immediately instead.
struct DraftReviewView: View {
    @Bindable var model: ScanFlowModel
    let onSaved: () -> Void
    @Environment(\.openURL) private var openURL
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

            // Section order: identity → Critic reviews → Price & retailers →
            // list picker → Save/Discard.
            Section("Critic reviews") {
                CriticReviewsBlock(wine: model.wine, control: model.reviews,
                                   retry: { model.retryReviews() },
                                   searchMore: { model.searchMoreRetailers() },
                                   chooseBottling: { await model.chooseBottling($0) },
                                   draft: true)
            }

            if let wine = model.wine {
                Section("Price & retailers") {
                    PriceRetailersBlock(
                        wine: wine,
                        control: model.price,
                        resolving: model.resolving,
                        openRetailer: { row in Task { if let url = await model.url(for: row) { openURL(url) } } },
                        retry: { model.retryPrice() }
                    )
                }
            }

            Section {
                if model.isDraft && !model.tags.hasAny {
                    Text("Pick at least one list to save.")
                        .font(AppFont.meta())
                        .foregroundStyle(Theme.accent)
                }
                ForEach(ListTag.allCases, id: \.self) { tag in
                    ListRow(title: tag.title, isOn: model.isOn(tag)) {
                        Task { await model.toggle(tag) }
                    }
                }
            } header: {
                Text(model.isDraft ? "Add to which list?" : "Lists")
            }

            if let error = model.actionError {
                Section {
                    Text(error).font(.system(size: 12)).foregroundStyle(Theme.redPill)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .bottom) {
            if model.isDraft {
                SaveBar(
                    isReady: model.tags.hasAny && model.fields.canSave,
                    isSaving: model.isSaving,
                    save: { Task { if await model.saveToCollection() { onSaved() } } },
                    discard: { confirmingDiscard = true }
                )
            }
        }
        .confirmationDialog("Discard this wine?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("Discard", role: .destructive) {
                Task { if await model.discard() { onSaved() } }
            }
        }
    }
}

/// A list row that looks selectable (Phase 12.1 WI-6): an empty circle when
/// off, a filled checked one when on — multi-select, since tags are additive.
/// Before, only an "on" row showed a checkmark, so an unselected row was
/// indistinguishable from plain text.
struct ListRow: View {
    let title: String
    let isOn: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 12) {
                Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(isOn ? Theme.accent : Theme.textMuted)
                Text(title).foregroundStyle(Theme.text)
                Spacer()
            }
            .frame(minHeight: Theme.minHitTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
        .accessibilityValue(isOn ? "On" : "Off")
    }
}

/// Save and Discard, pinned above the home indicator. Ready = a solid accent
/// fill; not ready = a muted outline at normal text contrast — never a 40 %
/// opacity burgundy on near-black (WI-6). It stays tappable: tapping while not
/// ready does nothing, and the reason is shown next to the picker.
struct SaveBar: View {
    let isReady: Bool
    let isSaving: Bool
    let save: () -> Void
    let discard: () -> Void

    var body: some View {
        VStack(spacing: 4) {
            Button(action: { if isReady && !isSaving { save() } }) {
                Text(isSaving ? "Saving…" : "Save to collection")
                    .font(AppFont.cardTitle())
                    .frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
                    .foregroundStyle(isReady ? Color.white : Theme.textMuted)
                    .background(isReady ? Theme.accent : Color.clear,
                                in: RoundedRectangle(cornerRadius: Theme.buttonRadius))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.buttonRadius)
                            .strokeBorder(isReady ? Color.clear : Theme.textMuted, lineWidth: 1.5)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Save to collection")
            .accessibilityHint(isReady ? "" : "Pick at least one list first")
            .accessibilityAddTraits(isReady ? [] : .isStaticText)

            Button("Discard", role: .destructive, action: discard)
                .buttonStyle(.link)
                .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, Theme.sideMargin)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .background(.bar)
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
