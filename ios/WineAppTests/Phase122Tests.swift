import XCTest
@testable import WineApp

// Phase 12.2 — enrichment accuracy and transparency. The price fields the
// backend computes (certain packs counted per bottle, the 2.5x split) decoded
// from real aggregatePriceData output, and the badges the rows build from them.

final class PriceTransparencyDecodingTests: XCTestCase {
    func testACertainSixPackDecodesWithItsPerBottleFigureAndAnEstimatedHeadline() throws {
        let wine = try Fixture.decode(Wine.self, "wine-price-normalized")
        let price = try XCTUnwrap(wine.priceData)
        XCTAssertEqual(price.priceAvg, 157.72)
        XCTAssertEqual(price.headlineBasis, .singleListing)
        XCTAssertEqual(price.headlineEstimated, true)
        XCTAssertEqual(price.normalizedCount, 1)
        let row = try XCTUnwrap(price.retailers.first)
        XCTAssertEqual(row.price, 946.32)
        XCTAssertEqual(row.pricePer750, 157.72)
        XCTAssertEqual(row.normalized?.divisor, 6)
        XCTAssertEqual(row.normalized?.kind, .pack)
        XCTAssertEqual(RetailerTable.badges(row).contains(.format("÷6 pack")), true)
    }

    func testPricesTooFarApartDecodeAsAnAmbiguousSplitWithNoAverage() throws {
        let wine = try Fixture.decode(Wine.self, "wine-price-ambiguous")
        let price = try XCTUnwrap(wine.priceData)
        XCTAssertEqual(price.headlineBasis, .ambiguous)
        XCTAssertNil(price.priceAvg)
        XCTAssertNil(price.priceMin)
        let groups = try XCTUnwrap(price.priceGroups)
        XCTAssertEqual(groups.map(\.min), [74.99, 149])
        XCTAssertEqual(groups.map(\.max), [74.99, 245])
        XCTAssertEqual(DetailFormatting.priceRange(groups[0].min, groups[0].max), "$75")
        XCTAssertEqual(DetailFormatting.priceRange(groups[1].min, groups[1].max), "$149–$245")
        XCTAssertEqual(price.excluded?.outlier, 0)
        // Nothing to average, so the effective price is nothing too.
        XCTAssertNil(EffectivePrice(wine).value)
    }

    func testABlobFromBeforeThisPhaseDecodesWithNoneOfTheNewFields() throws {
        let price = try XCTUnwrap(Fixture.fullWine.priceData)
        XCTAssertNil(price.headlineBasis)
        XCTAssertNil(price.priceGroups)
        XCTAssertNil(price.excluded)
    }
}

final class RetailerHostStorefrontTests: XCTestCase {
    func testTwoStorefrontsOfOneShopMatchButDifferentShopsDoNot() {
        XCTAssertTrue(RetailerHost.matches("sf.flatiron-wines.com", "nyc.flatiron-wines.com"))
        XCTAssertFalse(RetailerHost.matches("sf.flatiron-wines.com", "nyc.zachys.com"))
        XCTAssertEqual(RetailerHost.registrable("shop.example.co.uk"), "example.co.uk")
    }
}
