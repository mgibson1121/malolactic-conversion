import SwiftUI
import UIKit

/// What a list screen needs to apply a row action: somewhere to put the
/// optimistic value, somewhere to put it back, and the API.
@MainActor
protocol WineRowActionTarget: AnyObject {
    var rowActionError: String? { get set }
    func replace(_ wine: Wine)
    func remove(id: String)
}

/// The card's gesture actions (implementation spec §10) — every action the
/// web card exposes as a button, one gesture or one long-press away. Tag and
/// quantity changes are optimistic and **rolled back** on failure (§4.4);
/// the web leaves a failed optimistic value in place and that isn't ported.
@MainActor
struct RowActions {
    let api: APIClient
    let target: WineRowActionTarget
    /// Lists elsewhere need to re-GET (a wine moved between lists).
    let collectionChanged: () -> Void

    func setQuantity(_ wine: Wine, to quantity: Int) async {
        let next = max(0, quantity)
        guard next != wine.cellarQuantity else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        var optimistic = wine
        optimistic.cellarQuantity = next
        await commit(optimistic, original: wine, patch: WinePatch(cellarQuantity: next))
    }

    func toggle(_ wine: Wine, _ tag: CardTag) async {
        var optimistic = wine
        optimistic[keyPath: tag.keyPath].toggle()
        await commit(optimistic, original: wine, patch: tag.patch(optimistic[keyPath: tag.keyPath]))
    }

    /// Clears one list's tag — "Remove" never deletes the wine.
    func remove(_ wine: Wine, from tag: CardTag) async {
        guard wine[keyPath: tag.keyPath] else { return }
        await toggle(wine, tag)
    }

    /// The only destructive action. Returns an error to show, or nil.
    func delete(_ wine: Wine) async -> String? {
        do {
            try await api.deleteWine(id: wine.id)
            target.remove(id: wine.id)
            collectionChanged()
            return nil
        } catch APIError.server(409, _) {
            return "This wine has a tasting note and can't be discarded. Remove it from your lists instead."
        } catch let error as APIError {
            return error.message(networkMessage: "Could not delete — is the backend running?")
        } catch {
            return nil
        }
    }

    private func commit(_ optimistic: Wine, original: Wine, patch: WinePatch) async {
        target.rowActionError = nil
        target.replace(optimistic)
        do {
            let saved = try await api.updateWine(id: original.id, patch)
            target.replace(saved)
            collectionChanged()
        } catch {
            target.replace(original)
            target.rowActionError = (error as? APIError)?.message(networkMessage: "Could not update — is the backend running?")
                ?? "Could not update — is the backend running?"
        }
    }
}

/// The four list tags a card can toggle (drafts never appear in a list, so
/// there's no promote step here).
enum CardTag: CaseIterable, Hashable {
    case discovered, wishlist, cellar, consumed

    var title: String {
        switch self {
        case .discovered: return "Discovered"
        case .wishlist: return "Wishlist"
        case .cellar: return "Cellar"
        case .consumed: return "Consumed"
        }
    }

    var keyPath: WritableKeyPath<Wine, Bool> {
        switch self {
        case .discovered: return \.tagDiscovered
        case .wishlist: return \.tagWishlist
        case .cellar: return \.tagCellar
        case .consumed: return \.tagConsumed
        }
    }

    func patch(_ value: Bool) -> WinePatch {
        switch self {
        case .discovered: return WinePatch(tagDiscovered: value)
        case .wishlist: return WinePatch(tagWishlist: value)
        case .cellar: return WinePatch(tagCellar: value)
        case .consumed: return WinePatch(tagConsumed: value)
        }
    }
}

/// Swipe and long-press for one card, per list (§10):
/// - swipe left → Evaluate (full swipe commits)
/// - swipe right → −1/+1 bottle on Cellar; Wishlist/Cellar/Remove on
///   Discovered; Cellar/Remove on Wishlist
/// - long press → the four-way tag toggle, Evaluate, Delete (confirmed)
struct WineRowActionsModifier: ViewModifier {
    let wine: Wine
    let kind: ListKind
    let actions: RowActions?
    let evaluate: (Wine) -> Void
    let requestDelete: (Wine) -> Void

    func body(content: Content) -> some View {
        if let actions {
            content
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button { evaluate(wine) } label: { Label("Evaluate", systemImage: "square.and.pencil") }
                        .tint(Theme.accent2)
                }
                .swipeActions(edge: .leading, allowsFullSwipe: false) {
                    leading(actions)
                }
                .contextMenu {
                    ForEach(CardTag.allCases, id: \.self) { tag in
                        Button {
                            Task { await actions.toggle(wine, tag) }
                        } label: {
                            if wine[keyPath: tag.keyPath] {
                                Label(tag.title, systemImage: "checkmark")
                            } else {
                                Text(tag.title)
                            }
                        }
                    }
                    Divider()
                    Button { evaluate(wine) } label: { Label("Evaluate", systemImage: "square.and.pencil") }
                    Button(role: .destructive) { requestDelete(wine) } label: { Label("Delete", systemImage: "trash") }
                }
        } else {
            content
        }
    }

    @ViewBuilder
    private func leading(_ actions: RowActions) -> some View {
        switch kind {
        case .cellar:
            Button { Task { await actions.setQuantity(wine, to: wine.cellarQuantity + 1) } } label: {
                Label("+1", systemImage: "plus")
            }
            .tint(Theme.green)
            // At zero, −1 is disabled, not hidden (§10).
            Button { Task { await actions.setQuantity(wine, to: wine.cellarQuantity - 1) } } label: {
                Label("−1", systemImage: "minus")
            }
            .tint(Theme.textMuted)
            .disabled(wine.cellarQuantity <= 0)
        case .discovered:
            if !wine.tagWishlist {
                Button { Task { await actions.toggle(wine, .wishlist) } } label: { Label("Wishlist", systemImage: "bookmark") }
                    .tint(Theme.accent2)
            }
            if !wine.tagCellar {
                Button { Task { await actions.toggle(wine, .cellar) } } label: { Label("Cellar", systemImage: "square.grid.2x2") }
                    .tint(Theme.accent)
            }
            Button { Task { await actions.remove(wine, from: .discovered) } } label: { Label("Remove", systemImage: "minus.circle") }
                .tint(Theme.textMuted)
        case .wishlist:
            if !wine.tagCellar {
                Button { Task { await actions.toggle(wine, .cellar) } } label: { Label("Cellar", systemImage: "square.grid.2x2") }
                    .tint(Theme.accent)
            }
            Button { Task { await actions.remove(wine, from: .wishlist) } } label: { Label("Remove", systemImage: "minus.circle") }
                .tint(Theme.textMuted)
        case .notes:
            EmptyView()
        }
    }
}

extension View {
    func wineRowActions(_ wine: Wine, kind: ListKind, actions: RowActions?,
                        evaluate: @escaping (Wine) -> Void, requestDelete: @escaping (Wine) -> Void) -> some View {
        modifier(WineRowActionsModifier(wine: wine, kind: kind, actions: actions,
                                        evaluate: evaluate, requestDelete: requestDelete))
    }

    /// Makes a `List` row look like the ScrollView cards it replaced: clear
    /// background, no separator, the 16 pt side margin and 10 pt row gap.
    func cardRow(top: CGFloat = Theme.rowGap / 2, bottom: CGFloat = Theme.rowGap / 2) -> some View {
        listRowInsets(EdgeInsets(top: top, leading: Theme.sideMargin, bottom: bottom, trailing: Theme.sideMargin))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}
