import Foundation

/// Where a wine's drinking window puts it today — the Cellar dashboard's
/// Ready-to-drink widget (Phase 12 spec §4, R3), which is also what finally
/// answers the long-open `cellar_category` question.
///
/// Only a *primary* window — the developer's own, or one derived from agreeing
/// critics — can place a wine in Ready now or Needs more time. A wine whose
/// critics disagree and which has no window of its own is `.checkWindow`, and
/// is never guessed at from the per-critic windows (Phase 12.1 WI-2); a wine
/// with no window at all is `.noWindow`.
enum DrinkReadiness: Hashable {
    case needsTime
    case readyNow
    /// Past the end of its window. Counted in the widget's "Ready now"
    /// segment — it's still the answer to "what should I open tonight" —
    /// but kept distinct so a later screen can flag it.
    case pastWindow
    /// No window of its own, and the critics disagree.
    case checkWindow
    case noWindow

    /// Readiness of a wine, using the backend's `window_status` (computed
    /// once, never re-derived here). A backend that sends no status falls back
    /// to "has a window or not", which is what it meant before 12.1.
    static func of(_ wine: Wine, today: Date, calendar: Calendar = .current) -> DrinkReadiness {
        switch wine.windowStatus {
        case .check?:
            return wine.drinkingWindow == nil ? .checkWindow : of(wine.drinkingWindow, today: today, calendar: calendar)
        case .noWindow?:
            return .noWindow
        case .primary?, nil:
            return of(wine.drinkingWindow, today: today, calendar: calendar)
        }
    }

    static func of(_ window: DrinkingWindow?, today: Date, calendar: Calendar = .current) -> DrinkReadiness {
        guard let window else { return .noWindow }
        let todayISO = isoDay(today, calendar: calendar)
        // `YYYY-MM-DD` strings compare correctly as strings; the prefix guards
        // against a full timestamp ever arriving here.
        let start = String(window.start.prefix(10))
        let end = String(window.end.prefix(10))
        if todayISO < start { return .needsTime }
        if todayISO > end { return .pastWindow }
        return .readyNow
    }

    var segment: ReadinessSegment {
        switch self {
        case .readyNow, .pastWindow: return .readyNow
        case .needsTime: return .needsTime
        case .checkWindow: return .checkWindow
        case .noWindow: return .noWindow
        }
    }

    static func isoDay(_ date: Date, calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

/// The four tappable segments on the Ready-to-drink widget, in display order
/// (Phase 12.1 WI-2: "Check window" is the new fourth).
enum ReadinessSegment: String, CaseIterable, Hashable, Identifiable {
    case readyNow
    case needsTime
    case checkWindow
    case noWindow

    var id: String { rawValue }

    var title: String {
        switch self {
        case .readyNow: return "Ready now"
        case .needsTime: return "Needs more time"
        case .checkWindow: return "Check window"
        case .noWindow: return "No window"
        }
    }
}
