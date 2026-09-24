import Foundation

/// The six states every data-bearing view is in (implementation spec §3).
/// One enum instead of loading/error/data booleans, which is what produces the
/// web app's ambiguous combinations.
enum LoadState<Value> {
    /// Never requested — render nothing, no spinner.
    case idle
    /// First request in flight — skeleton, never a full-screen spinner.
    case loading
    case loaded(Value)
    /// 200 OK, zero rows.
    case empty
    /// Failed with nothing to fall back on — full-state error.
    case failed(APIError)
    /// A refresh failed but earlier data exists — keep rendering it, with a
    /// non-blocking banner. A populated screen is never blanked by a failure.
    case stale(Value, APIError)

    /// The data a view should render, if any.
    var value: Value? {
        switch self {
        case .loaded(let value), .stale(let value, _): return value
        case .idle, .loading, .empty, .failed: return nil
        }
    }

    var error: APIError? {
        switch self {
        case .failed(let error), .stale(_, let error): return error
        case .idle, .loading, .loaded, .empty: return nil
        }
    }

    /// The state after a request fails: stale if there was something to show.
    func failing(with error: APIError) -> LoadState {
        if let value { return .stale(value, error) }
        return .failed(error)
    }
}

extension LoadState where Value: Collection {
    /// The state for a successful response: `empty` for zero rows.
    static func from(_ rows: Value) -> LoadState {
        rows.isEmpty ? .empty : .loaded(rows)
    }
}
