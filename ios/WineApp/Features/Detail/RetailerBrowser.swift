import SwiftUI
import WebKit

/// The in-app browser for the guided retailer flow: opens the retailer's own
/// search, lets the user find the product page, then "Use this page" saves
/// that exact URL and runs extraction against it. "Use this page" is only
/// enabled on the retailer's own domain, so a stray tap on an ad or a
/// cross-site link can't be saved against the wrong shop.
struct RetailerBrowser: View {
    let link: RetailerLink
    let model: FindReviewsModel
    @Environment(\.dismiss) private var dismiss
    @State private var page = BrowserPage()
    @State private var confirmingURL: URL?

    private var retailerHost: String? { URL(string: link.url)?.host() }

    private var canUse: Bool {
        guard let current = page.url else { return false }
        return RetailerHost.matches(current.host(), retailerHost) && current.absoluteString != link.url
    }

    var body: some View {
        NavigationStack {
            WebView(page: page, initialURL: URL(string: link.url))
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle(link.name)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") { dismiss() }
                    }
                    ToolbarItemGroup(placement: .bottomBar) {
                        Button { page.webView?.goBack() } label: { Image(systemName: "chevron.backward") }
                            .disabled(!page.canGoBack)
                            .accessibilityLabel("Back")
                        Spacer()
                        Button {
                            confirmingURL = page.url
                        } label: {
                            Text(model.isConfirming ? "Saving & extracting…" : "Use this page")
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!canUse || model.isConfirming)
                    }
                }
                .safeAreaInset(edge: .top) {
                    Text(canUse
                         ? "On a \(link.name) page — use it if it's this wine's product page."
                         : "Find this wine's product page at \(link.name).")
                        .font(AppFont.meta())
                        .foregroundStyle(Theme.textMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .background(Theme.surface2)
                }
                .confirmationDialog("Save this page for \(link.name)?",
                                    isPresented: Binding(get: { confirmingURL != nil }, set: { if !$0 { confirmingURL = nil } }),
                                    titleVisibility: .visible) {
                    Button("Save & Extract") {
                        guard let url = confirmingURL else { return }
                        Task { if await model.confirm(url, for: link) { dismiss() } }
                    }
                } message: {
                    Text("Saves the link and reads its price and critic scores (one extraction).")
                }
                .alert("Couldn't save", isPresented: Binding(get: { model.confirmError != nil },
                                                             set: { if !$0 { model.clearConfirmError() } })) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text(model.confirmError ?? "")
                }
        }
    }
}

/// What the web view is showing, observed by the toolbar.
@MainActor
@Observable
final class BrowserPage {
    var url: URL?
    var canGoBack = false
    weak var webView: WKWebView?
}

private struct WebView: UIViewRepresentable {
    let page: BrowserPage
    let initialURL: URL?

    func makeCoordinator() -> Coordinator { Coordinator(page: page) }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.allowsBackForwardNavigationGestures = true
        webView.navigationDelegate = context.coordinator
        context.coordinator.observe(webView)
        page.webView = webView
        if let initialURL { webView.load(URLRequest(url: initialURL)) }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let page: BrowserPage
        private var observations: [NSKeyValueObservation] = []

        init(page: BrowserPage) { self.page = page }

        /// KVO rather than navigation callbacks: single-page shops change the
        /// URL without a navigation event.
        func observe(_ webView: WKWebView) {
            observations = [
                webView.observe(\.url, options: [.initial, .new]) { [weak self] view, _ in
                    let url = view.url
                    Task { @MainActor in self?.page.url = url }
                },
                webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] view, _ in
                    let canGoBack = view.canGoBack
                    Task { @MainActor in self?.page.canGoBack = canGoBack }
                },
            ]
        }
    }
}
