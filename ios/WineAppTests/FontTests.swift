import UIKit
import XCTest
@testable import WineApp

/// `Font.custom` silently falls back to the system face when a family isn't
/// registered, so a missing or misnamed font file would never show as an error.
final class FontTests: XCTestCase {
    func testBothBrandFamiliesAreRegistered() {
        XCTAssertTrue(UIFont.familyNames.contains("Domine"), "Domine-Variable.ttf missing from UIAppFonts or the bundle")
        XCTAssertTrue(UIFont.familyNames.contains("Work Sans"), "WorkSans-Variable.ttf missing from UIAppFonts or the bundle")
    }
}
