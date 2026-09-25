import PhotosUI
import SwiftUI

/// The full-screen scan modal (Phase 12 spec §6). Opens straight into the
/// system camera where one exists; the capture screen underneath carries the
/// library and manual-entry fallbacks.
struct ScanFlowView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var model: ScanFlowModel
    @State private var showingCamera = false
    @State private var showingPermissionAlert = false
    @State private var photoItem: PhotosPickerItem?
    @State private var showingLibrary = false
    @State private var didAutoOpenCamera = false

    init(api: APIClient, startManual: Bool = false) {
        _model = State(initialValue: ScanFlowModel(api: api, startManual: startManual))
    }

    var body: some View {
        NavigationStack {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.bg)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(model.step == .review && !model.isDraft ? "Done" : "Cancel") {
                            Task { await close() }
                        }
                    }
                }
                .navigationBarTitleDisplayMode(.inline)
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker(
                onImage: { image in
                    showingCamera = false
                    model.scan(image)
                },
                onCancel: { showingCamera = false }
            )
            .ignoresSafeArea()
        }
        .photosPicker(isPresented: $showingLibrary, selection: $photoItem, matching: .images)
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            Task { await loadLibraryImage(item) }
        }
        .alert("Camera access is off", isPresented: $showingPermissionAlert) {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            Button("Choose photo") { showingLibrary = true }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Turn it on in Settings to scan labels, or choose a photo from your library.")
        }
        .task {
            guard !didAutoOpenCamera, model.step == .capture, CameraPicker.isAvailable else { return }
            didAutoOpenCamera = true
            await openCamera()
        }
        .interactiveDismissDisabled(model.step == .review || model.step == .scanning)
    }

    @ViewBuilder
    private var content: some View {
        switch model.step {
        case .capture:
            CaptureChoicesView(
                cameraAvailable: CameraPicker.isAvailable,
                takePhoto: { Task { await openCamera() } },
                chooseFromLibrary: { showingLibrary = true },
                enterManually: { model.startManual() }
            )
            .navigationTitle("Scan a label")
        case .manual:
            ManualEntryView(model: model)
                .navigationTitle("Add wine")
        case .scanning:
            ScanningView(thumbnail: model.thumbnail, isSlow: model.isSlow)
                .navigationTitle("Scanning")
        case .duplicate(let existing):
            DuplicateView(
                existing: existing,
                open: { model.openExisting(existing) },
                addAnyway: { Task { await model.addAnyway() } }
            )
            .navigationTitle("Already in your collection")
        case .review:
            DraftReviewView(model: model, onSaved: { finish() })
                .navigationTitle(model.isDraft ? "Review" : "In your collection")
        case .unavailable(let reason):
            MessageView(title: "Scan Unavailable", message: reason) {
                Button("Enter manually") { model.startManual() }
                    .buttonStyle(.borderedProminent)
            }
        case .error(let message):
            MessageView(title: "Scan Failed", message: message) {
                Button("Retake") { Task { await model.retake() } }
                    .buttonStyle(.borderedProminent)
                Button("Enter manually") { model.startManual() }
            }
        }
    }

    private func openCamera() async {
        switch CameraPermission.current {
        case .allowed:
            showingCamera = true
        case .undetermined:
            if await CameraPermission.request() { showingCamera = true } else { showingPermissionAlert = true }
        case .denied:
            showingPermissionAlert = true
        }
    }

    private func loadLibraryImage(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else {
            model.rejectImage()
            return
        }
        model.scan(image)
    }

    /// Cancel discards any draft made along the way (spec §6.3); a promoted
    /// wine (the duplicate path) just closes.
    private func close() async {
        if await model.discard() { dismiss() }
    }

    private func finish() {
        session.collectionChanged()
        dismiss()
    }
}

private struct CaptureChoicesView: View {
    let cameraAvailable: Bool
    let takePhoto: () -> Void
    let chooseFromLibrary: () -> Void
    let enterManually: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "camera.viewfinder")
                .font(.system(size: 44))
                .foregroundStyle(Theme.accent)
            Text("Photograph the front label.")
                .font(AppFont.body())
                .foregroundStyle(Theme.textMuted)
            Spacer()
            if cameraAvailable {
                Button(action: takePhoto) {
                    Label("Take photo", systemImage: "camera")
                        .frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
                }
                .buttonStyle(.borderedProminent)
            }
            Button(action: chooseFromLibrary) {
                Label("Choose from library", systemImage: "photo.on.rectangle")
                    .frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
            }
            .buttonStyle(.bordered)
            Button("Enter manually", action: enterManually)
                .frame(minHeight: Theme.minHitTarget)
        }
        .padding(.horizontal, Theme.sideMargin)
        .padding(.bottom, 24)
    }
}

/// The captured thumbnail at 40% opacity, pulsing — the one place a modal
/// task of unknown 10–30 s length gets motion instead of a skeleton (§3.1).
private struct ScanningView: View {
    let thumbnail: UIImage?
    let isSlow: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        VStack(spacing: 16) {
            if let thumbnail {
                Image(uiImage: thumbnail)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 280)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius))
                    .opacity(reduceMotion ? 0.4 : (pulse ? 0.25 : 0.55))
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.6).repeatForever(autoreverses: true),
                               value: pulse)
            }
            Text("Reading the label…")
                .font(AppFont.body())
                .foregroundStyle(Theme.text)
            if isSlow {
                Text("Still going — labels with a lot of text take longer.")
                    .font(AppFont.meta())
                    .foregroundStyle(Theme.textMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(Theme.sideMargin)
        .onAppear { pulse = true }
    }
}

private struct DuplicateView: View {
    let existing: Wine
    let open: () -> Void
    let addAnyway: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("\(WineFormatting.title(existing)) \(WineFormatting.vintage(existing)) looks like a wine you already have — no search has been run.")
                .font(AppFont.body())
                .foregroundStyle(Theme.text)
            Button(action: open) {
                Text("Open it").frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
            }
            .buttonStyle(.borderedProminent)
            Button(action: addAnyway) {
                Text("Add anyway").frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
            }
            .buttonStyle(.bordered)
            Spacer()
        }
        .padding(Theme.sideMargin)
    }
}

private struct MessageView<Actions: View>: View {
    let title: String
    let message: String
    @ViewBuilder let actions: Actions

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 28))
                .foregroundStyle(Theme.textMuted)
            Text(title).font(AppFont.detailTitle()).foregroundStyle(Theme.text)
            Text(message)
                .font(AppFont.body())
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)
            actions
        }
        .padding(Theme.sideMargin)
    }
}

/// Manual + Add Wine (spec D4) — the same fields as draft review, then a
/// draft, then the same review screen. Never auto-fires enrichment.
private struct ManualEntryView: View {
    @Bindable var model: ScanFlowModel

    var body: some View {
        Form {
            WineFieldsSection(fields: $model.fields, missingTier1: [])
            if let error = model.actionError {
                Text(error).font(.system(size: 12)).foregroundStyle(Theme.redPill)
            }
            Section {
                Button {
                    Task { await model.createManualDraft() }
                } label: {
                    Text(model.isSaving ? "Continuing…" : "Continue")
                        .frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
                }
                .disabled(!model.fields.canSave || model.isSaving)
            }
        }
        .scrollContentBackground(.hidden)
    }
}
