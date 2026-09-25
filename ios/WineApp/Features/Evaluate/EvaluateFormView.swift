import SwiftUI

/// The WSET tasting note (Appearance → Nose → Palate → Conclusions), then a
/// review of the wine's lists once the note is saved — `EvaluateForm.tsx`'s
/// flow, as a sheet.
struct EvaluateFormView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: EvaluateModel
    let onSaved: () -> Void

    init(wine: Wine, api: APIClient, onSaved: @escaping () -> Void) {
        _model = State(initialValue: EvaluateModel(wine: wine, api: api))
        self.onSaved = onSaved
    }

    var body: some View {
        NavigationStack {
            Group {
                switch model.step {
                case .form: form
                case .tagReview: tagReview
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle(model.step == .form ? "Tasting Note" : "Note Saved")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if model.step == .form {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                }
            }
        }
        // A half-filled note shouldn't vanish on a stray swipe.
        .interactiveDismissDisabled(model.step == .form && model.draft != EvaluateDraft())
    }

    // MARK: Form

    private var form: some View {
        @Bindable var model = model
        return Form {
            Section {
                Text(WineFormatting.title(model.wine) + " · " + WineFormatting.vintage(model.wine))
                    .font(AppFont.meta())
                    .foregroundStyle(Theme.textMuted)
            }

            Section("Appearance") {
                chips("Clarity", .clarity, $model.draft.clarity, .clarity)
                chips("Color intensity", .colourIntensity, $model.draft.colourIntensity, .colourIntensity)
                textField("Color", "e.g. ruby, garnet, lemon, gold", $model.draft.colour, .colour)
            }

            Section("Nose") {
                chips("Condition", .noseCondition, $model.draft.noseCondition, .noseCondition)
                chips("Intensity", .intensity, $model.draft.noseIntensity, .noseIntensity)
                aromas("Primary aromas", $model.draft.nosePrimary, AromaDescriptors.primary, .nosePrimary)
                aromas("Secondary aromas", $model.draft.noseSecondary, AromaDescriptors.secondary, .noseSecondary)
                aromas("Tertiary aromas", $model.draft.noseTertiary, AromaDescriptors.tertiary, .noseTertiary)
            }

            Section("Palate") {
                chips("Sweetness", .sweetness, $model.draft.sweetness, .sweetness)
                chips("Acidity", .structure, $model.draft.acidity, .acidity)
                chips("Tannin · optional", .structure, $model.draft.tannin, nil)
                chips("Body", .body, $model.draft.body, .body)
                chips("Flavour intensity", .intensity, $model.draft.flavourIntensity, .flavourIntensity)
                chips("Finish", .finish, $model.draft.finish, .finish)
            }

            Section("Conclusions") {
                chips("Quality", .quality, $model.draft.quality, .quality)
                VStack(alignment: .leading, spacing: 4) {
                    FieldLabel(text: "Notes · optional", missing: false)
                    TextField("Anything else worth remembering", text: $model.draft.notes, axis: .vertical)
                        .lineLimit(3...8)
                }
            }

            Section {
                if model.attempted, !model.draft.missing.isEmpty {
                    Text("Still needed: " + model.draft.missing.map(\.rawValue).joined(separator: ", "))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.redPill)
                }
                if let error = model.error {
                    Text(error).font(.system(size: 12)).foregroundStyle(Theme.redPill)
                }
                Button {
                    Task { await model.save() }
                } label: {
                    Text(model.isSaving ? "Saving…" : "Save note")
                        .frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
                }
                .disabled(model.isSaving)
            }
        }
    }

    private func chips(_ title: String, _ scale: WSETScale, _ selection: Binding<String?>,
                       _ field: EvaluateDraft.Field?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            FieldLabel(text: title, missing: field.map(model.isMissing) ?? false)
            FlowLayout(spacing: 6) {
                ForEach(scale.values, id: \.self) { value in
                    let isOn = selection.wrappedValue == value
                    Button {
                        // Tapping the selected chip again clears an optional field.
                        selection.wrappedValue = (isOn && field == nil) ? nil : value
                    } label: {
                        Text(scale.label(value))
                            .font(AppFont.badge())
                            .padding(.horizontal, 10)
                            .frame(minHeight: 32)
                            .foregroundStyle(isOn ? Color.white : Theme.text)
                            .background(isOn ? Theme.accent : Theme.surface2, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isOn ? .isSelected : [])
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func textField(_ title: String, _ prompt: String, _ text: Binding<String>,
                           _ field: EvaluateDraft.Field) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: title, missing: model.isMissing(field))
            TextField(prompt, text: text)
                .textInputAutocapitalization(.never)
        }
    }

    private func aromas(_ title: String, _ text: Binding<String>,
                        _ descriptors: KeyValuePairs<String, [String]>, _ field: EvaluateDraft.Field) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: title, missing: model.isMissing(field))
            TextField("e.g. raspberry, rose, black pepper", text: text, axis: .vertical)
                .textInputAutocapitalization(.never)
            DisclosureGroup("Descriptors") {
                ForEach(Array(descriptors.enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.key).font(AppFont.sectionLabel()).foregroundStyle(Theme.textMuted)
                        FlowLayout(spacing: 6) {
                            ForEach(entry.value, id: \.self) { term in
                                Button(term) { text.wrappedValue = AromaDescriptors.adding(term, to: text.wrappedValue) }
                                    .font(AppFont.meta())
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                }
            }
            .font(AppFont.meta())
        }
    }

    // MARK: Tag review

    private var tagReview: some View {
        @Bindable var model = model
        return Form {
            Section {
                Text("Review your list tags for this wine. Add or remove any that apply.")
                    .font(AppFont.body())
                    .foregroundStyle(Theme.textMuted)
            }
            Section {
                Toggle("Discovered", isOn: $model.tags.discovered)
                Toggle("Wishlist", isOn: $model.tags.wishlist)
                Toggle("Cellar", isOn: $model.tags.cellar)
                Toggle("Consumed", isOn: $model.tags.consumed)
            }
            .tint(Theme.accent)
            Section {
                Button {
                    Task {
                        await model.finishTagReview()
                        onSaved()
                        dismiss()
                    }
                } label: {
                    Text(model.isSaving ? "Saving…" : "Done")
                        .frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
                }
                .disabled(model.isSaving)
            }
        }
    }
}

private struct FieldLabel: View {
    let text: String
    let missing: Bool

    var body: some View {
        Text(text)
            .font(AppFont.sectionLabel())
            .foregroundStyle(missing ? Theme.redPill : Theme.textMuted)
            .accessibilityLabel(missing ? "\(text), required" : text)
    }
}

/// Wraps its children onto as many lines as they need — for the WSET chip
/// rows, where Sweetness alone has seven options.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(rows.count - 1, 0))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = rows[rows.count - 1].indices.isEmpty ? size.width : rows[rows.count - 1].width + spacing + size.width
            if needed > width, !rows[rows.count - 1].indices.isEmpty {
                rows.append(Row())
            }
            var row = rows[rows.count - 1]
            row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
            rows[rows.count - 1] = row
        }
        return rows.filter { !$0.indices.isEmpty }
    }
}
