import SwiftUI

/// The detail screen's "Find reviews" card — search a retailer, save a link,
/// or (guided) pick the product page in the in-app browser and extract from
/// it. A fallback for wines where automated review sourcing found nothing at
/// a shop the developer trusts; automated results stay first.
struct FindReviewsSection: View {
    @Bindable var model: FindReviewsModel
    let wine: Wine
    @Environment(\.openURL) private var openURL

    var body: some View {
        WidgetCard {
            SectionLabel("Find reviews")
            switch model.links {
            case .idle:
                Button("Search retailers") { Task { await model.load() } }
                    .buttonStyle(.bordered)
                    .frame(minHeight: Theme.minHitTarget)
            case .loading:
                Text("Generating search links…").font(AppFont.meta()).foregroundStyle(Theme.textMuted)
            case .empty:
                Text("Need a producer or denomination to search for reviews.")
                    .font(AppFont.meta()).foregroundStyle(Theme.textMuted)
            case .failed:
                Text("Could not generate retailer links").font(.system(size: 12)).foregroundStyle(Theme.redPill)
                Button("Try again") { Task { await model.load() } }.buttonStyle(.borderless)
            case .loaded(let links), .stale(let links, _):
                ForEach(links, id: \.slug) { link in
                    row(link)
                    if link.slug != links.last?.slug { Divider() }
                }
                if let error = model.saveError {
                    Text(error).font(.system(size: 12)).foregroundStyle(Theme.redPill)
                }
            }
        }
        .sheet(item: $model.browsing) { link in
            RetailerBrowser(link: link, model: model)
        }
    }

    @ViewBuilder
    private func row(_ link: RetailerLink) -> some View {
        let saved = wine.retailerLinks?[link.slug]
        let scores = wine.reviewData?.first { $0.slug == link.slug }?.criticScores.count ?? 0
        let isEditing = model.editingSlug == link.slug

        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(link.name).font(AppFont.body()).foregroundStyle(Theme.text).lineLimit(1)
                if scores > 0 {
                    Text("✓ \(scores) score\(scores == 1 ? "" : "s") found")
                        .font(AppFont.badge()).foregroundStyle(Theme.green)
                        .accessibilityLabel("Automated review sourcing already found \(scores) scores here")
                }
                Spacer()
                Button("Search") { model.browsing = link }
                    .buttonStyle(.bordered)
                    .tint(scores > 0 ? Theme.textMuted : Theme.accent)
            }
            if !isEditing {
                HStack(spacing: 14) {
                    if let saved, let url = URL(string: saved) {
                        Button("✓ Saved") { openURL(url) }
                    }
                    Button(saved == nil ? "Save link" : "Edit") { model.startEditing(link) }
                    if saved != nil {
                        Button("Remove", role: .destructive) { Task { await model.clear(link.slug) } }
                            .disabled(model.savingSlug == link.slug)
                    }
                }
                .font(AppFont.meta())
                .buttonStyle(.borderless)
            } else {
                TextField("Paste the review or product page URL", text: $model.editValue)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                HStack(spacing: 14) {
                    Button(model.savingSlug == link.slug ? "Saving…" : "Save") { Task { await model.save(link.slug) } }
                        .disabled(model.savingSlug == link.slug || model.editValue.trimmed.isEmpty)
                    Button("Cancel") { model.editingSlug = nil }
                        .disabled(model.savingSlug == link.slug)
                }
                .font(AppFont.meta())
                .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 4)
    }
}

extension RetailerLink: Identifiable {
    var id: String { slug }
}
