import SwiftUI

/// Full-state error (implementation spec §4.3): replaces the content area
/// only — nav bar and tab bar stay live.
struct FullStateErrorView: View {
    let message: String
    /// Second consecutive failure of the same request (§4.4).
    var stillFailing = false
    var secondaryTitle: String?
    var secondaryAction: (() -> Void)?
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 28))
                .foregroundStyle(Theme.textMuted)
            Text(message)
                .font(.system(size: 15))
                .foregroundStyle(Theme.text)
                .multilineTextAlignment(.center)
            Button("Try again", action: retry)
                .buttonStyle(.bordered)
                .frame(minHeight: Theme.minHitTarget)
            if stillFailing {
                Text("Still can't reach it.")
                    .font(AppFont.meta())
                    .foregroundStyle(Theme.textMuted)
            }
            if let secondaryTitle, let secondaryAction {
                Button(secondaryTitle, action: secondaryAction)
                    .frame(minHeight: Theme.minHitTarget)
            }
        }
        .padding(.horizontal, Theme.sideMargin)
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
    }
}

/// One line of muted text, optional single button — never a spinner or an
/// illustration (§5).
struct EmptyStateView: View {
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .frame(minHeight: Theme.minHitTarget)
            }
        }
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
    }
}

/// The 36 pt stale/offline strip pinned under the nav bar (§4.3).
struct StaleBanner: View {
    var text = "Offline — showing your last loaded collection."

    var body: some View {
        Text(text)
            .font(AppFont.meta())
            .foregroundStyle(Theme.text)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background(Theme.surface2)
    }
}

/// Skeleton row at the real card height (§3.1): three blocks at 60/40/80%.
struct SkeletonRow: View {
    var body: some View {
        GeometryReader { proxy in
            VStack(alignment: .leading, spacing: 10) {
                block(width: proxy.size.width * 0.6)
                block(width: proxy.size.width * 0.4)
                block(width: proxy.size.width * 0.8)
            }
            .padding(14)
        }
        .frame(height: 104)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
        .redacted(reason: .placeholder)
        .accessibilityHidden(true)
    }

    private func block(width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(Theme.surface2)
            .frame(width: max(width - 28, 0), height: 12)
    }
}
