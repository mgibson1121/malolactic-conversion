import XCTest
@testable import WineApp

final class WineFieldsTests: XCTestCase {
    func testPatchCarriesOnlyChangedFields() throws {
        let draft = try Fixture.fullWine
        var fields = WineFields(draft)
        XCTAssertTrue(fields.patch(against: draft).isEmpty, "untouched fields patch nothing")

        fields.region = "  Côte de Nuits "
        let patch = fields.patch(against: draft)
        XCTAssertEqual(patch, WinePatch(region: "Côte de Nuits"))
        XCTAssertFalse(patch.changesIdentity, "region never re-fires a search")
    }

    func testIdentityEditsTriggerARefire() throws {
        let draft = try Fixture.fullWine
        var fields = WineFields(draft)
        fields.vintage = "2020"
        XCTAssertTrue(fields.patch(against: draft).changesIdentity)
    }

    func testVintageMustBeAPlausibleYearOrBlank() {
        var fields = WineFields()
        fields.producer = "Bollinger"
        fields.vintage = ""
        XCTAssertTrue(fields.canSave, "blank is NV")
        XCTAssertNil(fields.newWine.vintage)

        fields.vintage = "19"
        XCTAssertTrue(fields.vintageIsInvalid)
        XCTAssertFalse(fields.canSave)

        fields.vintage = "2019"
        XCTAssertEqual(fields.newWine.vintage, 2019)
    }

    func testSomethingToCallTheWineByIsRequired() {
        var fields = WineFields()
        XCTAssertFalse(fields.canSave)
        fields.denomination = "Barolo"
        XCTAssertTrue(fields.canSave)
    }

    func testTier1NeedsAllThreeIdentityFields() throws {
        var wine = try Fixture.fullWine
        XCTAssertTrue(wine.hasTier1)
        wine.vintage = nil
        XCTAssertFalse(wine.hasTier1, "an NV wine never auto-fires, matching the web")
    }
}

final class ScanFailureTests: XCTestCase {
    func testMissingOpenAIKeyIsUnavailableNotAnError() {
        let step = ScanFlowModel.scanFailureStep(.server(status: 503, message: "Label scanning is unavailable — OPENAI_API_KEY is not configured."))
        guard case .unavailable = step else { return XCTFail("expected .unavailable, got \(step)") }
    }

    func testUnsupportedFormatUsesTheWebsCopy() {
        let step = ScanFlowModel.scanFailureStep(.server(status: 400, message: "IMAGE_FORMAT_UNSUPPORTED"))
        XCTAssertEqual(step, .error("This image format couldn't be processed. Please save the photo as a JPEG and try again."))
    }

    func testOtherFailuresArePrefixedScanFailed() {
        let step = ScanFlowModel.scanFailureStep(.server(status: 500, message: "GPT-4o timed out"))
        XCTAssertEqual(step, .error("Scan failed: GPT-4o timed out"))
    }
}
