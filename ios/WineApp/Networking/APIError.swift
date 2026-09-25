import Foundation

/// Every failure the API client can surface, split the way the implementation
/// spec's §4.1 taxonomy needs: "the request never reached the server" is a
/// different message and a different next action from "the server said no".
enum APIError: Error, Hashable {
    /// No HTTP response at all — backend down, wrong host, off the LAN.
    case network(String)
    /// A non-2xx response. `message` is already normalised for display.
    case server(status: Int, message: String)
    /// A 2xx whose body didn't match the Swift mirror of `shared/types.ts` —
    /// a contract drift, not a user-facing condition.
    case decoding(String)

    var isNetwork: Bool {
        if case .network = self { return true }
        return false
    }

    /// Display copy. `networkMessage` is the context-specific line for the
    /// no-response case (e.g. the list screen's "Could not load wines — …");
    /// the server case always shows the server's own message verbatim.
    func message(networkMessage: String) -> String {
        switch self {
        case .network: return networkMessage
        case .server(_, let message): return message
        case .decoding: return "The backend sent a response this app doesn't understand. Is it up to date?"
        }
    }

    /// Mirrors `web/src/api.ts`: `body.error ?? "HTTP {status}"`. A structured
    /// `error` (a zod validation tree) falls back to the body's `message`,
    /// then to the status line — the spec forbids showing a JSON blob.
    static func serverMessage(from data: Data, status: Int) -> String {
        guard
            let object = try? JSONSerialization.jsonObject(with: data),
            let body = object as? [String: Any]
        else { return "HTTP \(status)" }
        if let error = body["error"] as? String, !error.isEmpty { return error }
        if let message = body["message"] as? String, !message.isEmpty { return message }
        return "HTTP \(status)"
    }
}
