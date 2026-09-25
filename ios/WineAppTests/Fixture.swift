import Foundation
import XCTest
@testable import WineApp

/// Loads a JSON fixture written by `backend/scripts/export-ios-fixtures.ts` —
/// real SQLite-adapter output, never hand-edited.
enum Fixture {
    private final class Token {}

    static func data(_ name: String, file: StaticString = #filePath, line: UInt = #line) throws -> Data {
        let bundle = Bundle(for: Token.self)
        let url = try XCTUnwrap(bundle.url(forResource: name, withExtension: "json"),
                                "Missing fixture \(name).json — run export-ios-fixtures.ts", file: file, line: line)
        return try Data(contentsOf: url)
    }

    static func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try JSONDecoder().decode(type, from: data(name))
    }

    static var fullWine: Wine {
        get throws { try decode(Wine.self, "wine-full") }
    }
}

/// A fixed Gregorian/UTC calendar so date-derived tests don't depend on the
/// machine running them.
let utcCalendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}()

func day(_ iso: String) -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withFullDate]
    return formatter.date(from: iso)!
}
