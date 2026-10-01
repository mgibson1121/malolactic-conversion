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
        case .duplicate(let existing, let scanned, let bottling):
            DuplicateView(
                existing: existing,
                scanned: scanned,
                bottling: bottling,
                same: { model.openExisting(existing) },
                different: { Task { await model.addAnyway() } }
            )
            .navigationTitle("Same wine?")
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

/// "Is this a wine you already have?" — always a question, never a silent
/// reuse. Shows both identities side by side, including the bottling that
/// most often separates two wines of one producer, appellation and vintage
/// (Sesta di Sopra's Brunello vs its Magistra, 2026-09-30). "Different wine"
/// creates a new entry with its own id.
private struct DuplicateView: View {
    let existing: Wine
    let scanned: LabelScanResult
    let bottling: BottlingDifference?
    let same: () -> Void
    let different: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("This label looks like a wine you already have. Is it the same wine?")
                    .font(AppFont.body())
                    .foregroundStyle(Theme.text)

                IdentityCard(
                    heading: "You have",
                    title: WineFormatting.title(existing),
                    bottling: Self.bottling(cuvee: existing.cuvee, vineyard: existing.vineyard, classification: existing.qualityClassification),
                    vintage: WineFormatting.vintage(existing),
                    extra: existing.tagCellar ? "\(existing.cellarQuantity) btl in your cellar" : nil
                )
                IdentityCard(
                    heading: "This label",
                    title: [scanned.producer, scanned.denomination].compactMap { $0 }.joined(separator: " · "),
                    bottling: Self.bottling(cuvee: scanned.cuvee, vineyard: scanned.vineyard, classification: scanned.qualityClassification),
                    vintage: scanned.vintage.map(String.init) ?? "NV",
                    extra: nil
                )

                if let bottling {
                    Text(Self.differenceNote(bottling))
                        .font(AppFont.meta())
                        .foregroundStyle(Theme.accent2)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.accent2Soft, in: RoundedRectangle(cornerRadius: Theme.fieldRadius))
                }

                Button(action: same) {
                    Text("Same wine — open it").frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
                }
                .buttonStyle(.bordered)
                Button(action: different) {
                    Text("Different wine — add it").frame(maxWidth: .infinity, minHeight: Theme.minHitTarget)
                }
                .buttonStyle(.borderedProminent)
                Text("No search has been run yet. Adding it creates a separate wine.")
                    .font(AppFont.meta())
                    .foregroundStyle(Theme.textMuted)
            }
            .padding(Theme.sideMargin)
        }
    }

    static func bottling(cuvee: String?, vineyard: String?, classification: String?) -> String? {
        var seen = Set<String>()
        let parts = [cuvee, vineyard, classification]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static func differenceNote(_ b: BottlingDifference) -> String {
        if let existing = b.existing, b.scanned == nil {
            return "Yours is the \(existing). This label doesn't mention \(existing) — if it's a different bottling, add it."
        }
        if let scanned = b.scanned, b.existing == nil {
            return "This label says \(scanned); the wine you have doesn't. If they're different bottlings, add it."
        }
        return "The bottlings may differ."
    }
}

private struct IdentityCard: View {
    let heading: String
    let title: String
    let bottling: String?
    let vintage: String
    let extra: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(heading.uppercased()).font(AppFont.sectionLabel()).foregroundStyle(Theme.textMuted)
            Text(title.isEmpty ? "—" : title).font(AppFont.cardTitle()).foregroundStyle(Theme.text)
            HStack(spacing: 6) {
                Text(vintage).font(AppFont.meta().monospacedDigit())
                if let bottling {
                    Text("·")
                    Text(bottling).fontWeight(.semibold)
                }
            }
            .font(AppFont.meta())
            .foregroundStyle(Theme.textMuted)
            if let extra {
                Text(extra).font(AppFont.meta()).foregroundStyle(Theme.textMuted)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
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
