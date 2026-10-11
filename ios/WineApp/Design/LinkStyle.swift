import SwiftUI

/// Everything tappable that reads as text is underlined, no exceptions
/// (Phase 12.1 D9). One style so it cannot drift: `.buttonStyle(.link)` for a
/// text button, `LinkText` for a label inside a larger tappable, and
/// `.underline()` on a row's name. A source-scan test
/// (`LinkAffordanceTests`) fails if the bare `.borderless` text-button
/// pattern this replaces comes back.
struct LinkButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .underline()
            .foregroundStyle(configuration.role == .destructive ? Theme.redPill : Theme.accent)
            .opacity(isEnabled ? (configuration.isPressed ? 0.6 : 1) : 0.4)
            .frame(minHeight: Theme.minHitTarget)
            .contentShape(Rectangle())
    }
}

extension ButtonStyle where Self == LinkButtonStyle {
    static var link: LinkButtonStyle { LinkButtonStyle() }
}

/// Underlined accent text, for a link-looking label inside a tappable that
/// isn't itself a text button (a retailer name in a row, a Link destination).
struct LinkText: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text).underline().foregroundStyle(Theme.accent)
    }
}
