import Foundation

/// Where a wine's drinking window puts it today — the Cellar dashboard's
/// Ready-to-drink widget (Phase 12 spec §4, R3), which is also what finally
/// answers the long-open `cellar_category` question.
///
/// Derived client-side from `drinking_window` only. A nil window — including
/// the critic-disagreement case — is `.noWindow` and is never guessed at from
/// the per-critic windows.
enum DrinkReadiness: Hashable {
    case needsTime
    case readyNow
    /// Past the end of its window. Counted in the widget's "Ready now"
    /// segment — it's still the answer to "what should I open tonight" —
    /// but kept distinct so a later screen can flag it.
    case pastWindow
    case noWindow

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
        case .noWindow: return .noWindow
        }
    }

    static func isoDay(_ date: Date, calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

/// The three tappable segments on the Ready-to-drink widget, in display order.
enum ReadinessSegment: String, CaseIterable, Hashable, Identifiable {
    case readyNow
    case needsTime
    case noWindow

    var id: String { rawValue }

    var title: String {
        switch self {
        case .readyNow: return "Ready now"
        case .needsTime: return "Needs more time"
        case .noWindow: return "No window"
        }
    }
}
