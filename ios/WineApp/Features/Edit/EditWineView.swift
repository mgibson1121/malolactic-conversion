import SwiftUI

/// The Edit screen (Phase 12.1 WI-1): reuses the draft form's field section
/// and adds "Your price", a manual drinking window, list tags, quantity and a
/// destructive Delete at the bottom (also reachable from a card's long-press).
struct EditWineView: View {
    @State private var model: EditWineModel
    @Environment(\.dismiss) private var dismiss
    let onSaved: (Wine) -> Void
    let onDeleted: () -> Void

    init(wine: Wine, api: APIClient, onSaved: @escaping (Wine) -> Void, onDeleted: @escaping () -> Void) {
        _model = State(initialValue: EditWineModel(wine: wine, api: api))
        self.onSaved = onSaved
        self.onDeleted = onDeleted
    }

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                // "Refresh searches now?" (D4). Inline rather than a dialog:
                // it can't be dismissed by a stray tap and leave the screen
                // half-saved with Save disabled.
                if model.pendingRefresh != nil {
                    Section {
                        Text("Refresh searches now?").font(AppFont.cardTitle())
                        Text("You changed what this wine is. Its stored prices and critic scores were found for the old version. Refreshing runs both searches again: \(EditWineModel.refreshCostLabel). “Not now” keeps them and marks them as possibly out of date.")
                            .font(AppFont.meta())
                            .foregroundStyle(Theme.textMuted)
                        Button("Refresh now") {
                            Task { if let wine = await model.refreshNow() { finish(wine) } }
                        }
                        .disabled(model.isBusy)
                        Button("Not now") {
                            if let wine = model.declineRefresh() { finish(wine) }
                        }
                        .disabled(model.isBusy)
                    }
                }

                WineFieldsSection(fields: $model.fields, missingTier1: [])

                Section {
                    TextField("Optional — overrides the automated price", text: $model.yourPrice)
                        .keyboardType(.decimalPad)
                } header: {
                    Text("Your price (per 750 ml bottle)")
                } footer: {
                    Text("When set, this is the price shown everywhere; the automated prices stay as reference. No search ever changes it.")
                }

                Section {
                    HStack {
                        TextField("From (year)", text: $model.windowStart).keyboardType(.numberPad)
                        Text("–")
                        TextField("To (year)", text: $model.windowEnd).keyboardType(.numberPad)
                    }
                } header: {
                    Text("Drinking window")
                } footer: {
                    if model.derivedWindowUntouched {
                        Text("From critics. Change it to make it yours.")
                    } else if model.original.windowStatus == .check, model.original.drinkingWindow == nil {
                        Text("The critics disagree on this wine's window — enter your own.")
                    }
                }

                Section("Lists") {
                    ForEach(CardTag.allCases, id: \.self) { tag in
                        Toggle(tag.title, isOn: Binding(
                            get: { model.tags[tag] ?? false },
                            set: { model.tags[tag] = $0 }
                        ))
                    }
                    Stepper("Bottles in the cellar: \(model.quantity)", value: $model.quantity, in: 0...999)
                }

                if let error = model.error {
                    Section { Text(error).font(.system(size: 12)).foregroundStyle(Theme.redPill) }
                }
                if let message = model.busyMessage {
                    Section { HStack { ProgressView(); Text(message).font(AppFont.meta()) } }
                }

                Section {
                    Button("Delete wine", role: .destructive) { Task { await model.requestDelete() } }
                        .disabled(model.isBusy)
                        .frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Edit wine")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(model.isBusy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { if let saved = await model.save() { finish(saved) } } }
                        .disabled(model.isBusy || model.pendingRefresh != nil)
                }
            }
            .confirmationDialog(
                "Delete this wine?",
                isPresented: Binding(get: { model.deletePreview != nil }, set: { if !$0 { model.cancelDelete() } }),
                titleVisibility: .visible
            ) {
                Button("Delete wine", role: .destructive) {
                    Task {
                        if await model.confirmDelete() {
                            dismiss()
                            onDeleted()
                        }
                    }
                }
                Button("Keep it", role: .cancel) { model.cancelDelete() }
            } message: {
                Text(EditWineModel.deleteMessage(notesKept: model.deletePreview ?? 0))
            }
        }
        .interactiveDismissDisabled(model.isBusy)
    }

    private func finish(_ wine: Wine) {
        onSaved(wine)
        dismiss()
    }
}
