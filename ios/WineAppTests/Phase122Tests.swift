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

final class BottlingPromptDecodingTests: XCTestCase {
    func testTheLadderAndThePromptDecodeFromRealAdapterOutput() throws {
        let wine = try Fixture.decode(Wine.self, "wine-bottling-prompt")
        let ladder = try XCTUnwrap(wine.reviewLadder)
        XCTAssertEqual(ladder.tier, "1")
        XCTAssertEqual(ladder.rungs.first { $0.tier == "1" }?.critics, ["Vinous"])
        XCTAssertEqual(ladder.rungs.first { $0.tier == "3" }?.pages, 2)
        let prompt = try XCTUnwrap(wine.bottlingPrompt)
        XCTAssertEqual(prompt.options.map(\.name), ["Castiglione", "Monvigliero", "Rocche"])
        XCTAssertEqual(Set(prompt.reasons), ["modifiers", "price_split"])
        let rocche = try XCTUnwrap(prompt.options.first { $0.name == "Rocche" })
        XCTAssertEqual(rocche.priceRange, PriceRange(min: 229, max: 229))
        XCTAssertEqual(rocche.retailers, ["sokolin"])
        XCTAssertNil(wine.bottlingPlain)
    }

    func testAListingCarriesItsTitleAndWhatItSaysAboutTheBottling() throws {
        let wine = try Fixture.decode(Wine.self, "wine-bottling-prompt")
        let castiglione = try XCTUnwrap(wine.priceData?.retailers.first { $0.slug == "thatchers" })
        XCTAssertEqual(castiglione.listingTitle, "Vietti Barolo Castiglione 2021")
        XCTAssertEqual(castiglione.bottlingDifference?.extra, ["castiglione"])
        XCTAssertTrue(RetailerTable.badges(castiglione).contains(.format("Names Castiglione — yours doesn't")))
        let plain = try XCTUnwrap(wine.priceData?.retailers.first { $0.slug == "zachys" })
        XCTAssertFalse(RetailerTable.badges(plain).contains { if case .format = $0 { return true } else { return false } })
    }

    func testAListingOutsideTheChosenBottlingSaysSo() {
        var r = RetailerPrice(slug: "x", name: "X", price: 100, url: "https://x", distanceMiles: 1, isPreferredRetailer: true,
                              isSearchResultsPage: false, matchedVintage: 2021, vintageMismatch: false, vintageVerdict: .match,
                              packQuantity: 1, bottleSizeMl: nil, nonStandardFormat: false, formatLabel: "", linkOnly: false,
                              verification: .verified)
        r.outsideBottling = true
        XCTAssertTrue(RetailerTable.badges(r).contains(.format("outside your bottling")))
    }

    func testTheBadgeReadsInBothDirectionsAndIsNilForTheSameBottling() {
        XCTAssertEqual(DetailFormatting.bottlingBadge(extra: ["monvigliero"], missing: []), "Names Monvigliero — yours doesn't")
        XCTAssertEqual(DetailFormatting.bottlingBadge(extra: [], missing: ["castiglione"]), "Doesn't name Castiglione — yours does")
        XCTAssertNil(DetailFormatting.bottlingBadge(extra: [], missing: []))
    }

    func testAnExcludedCountsBlobFromBeforeTheBottlingAnswerStillDecodes() throws {
        let json = #"{"other_vintage":1,"pack":0,"non_standard_format":0,"suspected_large_format":0,"link_only":0,"outlier":2}"#
        let counts = try JSONDecoder().decode(PriceExcludedCounts.self, from: Data(json.utf8))
        XCTAssertEqual(counts.outsideBottling, 0)
        XCTAssertEqual(counts.outlier, 2)
    }
}

final class TierCopyTests: XCTestCase {
    func testTheHeadlineNamesTheTierInWords() {
        XCTAssertEqual(TierCopy.headline("1"), "Matched at Tier 1 · exact wine and vintage")
        XCTAssertEqual(TierCopy.headline("2"), "Matched at Tier 2 · same wine, other vintages")
        XCTAssertEqual(TierCopy.headline("3"), "Matched at Tier 3 · different bottling, same vintage")
        XCTAssertEqual(TierCopy.headline("4"), "Matched at Tier 4 · different bottling, nearby vintage")
        XCTAssertNil(TierCopy.headline("none"))
    }

    func testTheResultLineSaysWhatChanged() {
        XCTAssertEqual(TierCopy.resultLine(tier: "1", scores: 4, trusted: 3), "Now matched at Tier 1 — 3 trusted scores")
        XCTAssertEqual(TierCopy.resultLine(tier: "2", scores: 1, trusted: 0), "Now matched at Tier 2 — 1 score")
        XCTAssertTrue(TierCopy.resultLine(tier: "none", scores: 0, trusted: 0).hasPrefix("Saved."))
    }
}

@MainActor
final class ChooseBottlingModelTests: XCTestCase {
    func testAnAnswerPostsTheChoiceAndTakesTheRescoredWine() async throws {
        let wine = try Fixture.decode(Wine.self, "wine-bottling-prompt")
        var answered = wine
        answered.vineyard = "Castiglione"
        answered.bottlingPrompt = nil
        let body = #"{"wine":\#(String(decoding: try JSONEncoder().encode(answered), as: UTF8.self)),"result":{"tier":"1","scores":4,"trusted_scores":3,"duplicate":{"kind":"none"}}}"#
        StubURLProtocol.requests = []
        StubURLProtocol.router = nil
        StubURLProtocol.response = (200, Data(body.utf8))
        var changed = 0
        let model = WineDetailModel(wine: wine, api: StubURLProtocol.api(), onChanged: { changed += 1 })

        let outcome = await model.chooseBottling(.vineyard("Castiglione"))

        XCTAssertEqual(outcome, .done("Now matched at Tier 1 — 3 trusted scores"))
        XCTAssertEqual(model.wine.vineyard, "Castiglione")
        XCTAssertNil(model.wine.bottlingPrompt)
        XCTAssertEqual(changed, 1)
        let request = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(request.url?.path, "/api/wines/\(wine.id)/choose-bottling")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(StubURLProtocol.requests.count, 1, "no lookup, no second request")
    }

    func testAFailedAnswerChangesNothingAndSaysSo() async throws {
        let wine = try Fixture.decode(Wine.self, "wine-bottling-prompt")
        StubURLProtocol.response = (500, Data(#"{"error":"nope"}"#.utf8))
        let model = WineDetailModel(wine: wine, api: StubURLProtocol.api(), onChanged: {})
        let outcome = await model.chooseBottling(.plain)
        XCTAssertEqual(outcome, .failed("Couldn't save your answer. Try again."))
        XCTAssertNotNil(model.wine.bottlingPrompt)
    }

    func testPriceAndReviewAnswersCarryTheLadderAndPromptAcross() throws {
        let fresh = try Fixture.decode(Wine.self, "wine-bottling-prompt")
        var current = try Fixture.fullWine
        current.reviewLadder = nil
        current = current.applying(fresh, from: .reviews)
        XCTAssertEqual(current.reviewLadder?.tier, "1")
        XCTAssertNotNil(current.bottlingPrompt)
        var priceOnly = try Fixture.fullWine
        priceOnly.reviewLadder = nil
        priceOnly = priceOnly.applying(fresh, from: .price)
        XCTAssertNil(priceOnly.reviewLadder, "a price answer does not own the ladder")
    }
}

final class ScorelessPagesTests: XCTestCase {
    func testAPageFoundWithoutAScoreDecodesAsOneSoTheBlockCanSaySo() throws {
        let json = #"{"tier":"none","rungs":[],"pages":[{"slug":"woodland","name":"Woodland Hills","product_url":"https://whwc.com/x-2023/","rung":null,"page_vintage":2023,"vintage_delta":3,"scores":0,"trusted_scores":0,"badge":null,"tier_note":null}]}"#
        let ladder = try JSONDecoder().decode(ReviewLadder.self, from: Data(json.utf8))
        let scoreless = try XCTUnwrap(ladder.pages).filter { $0.scores == 0 }
        XCTAssertEqual(scoreless.map(\.name), ["Woodland Hills"])
        XCTAssertEqual(scoreless.first?.pageVintage, 2023)
    }

    func testALadderFromAnOlderBackendWithNoPagesStillDecodes() throws {
        let ladder = try JSONDecoder().decode(ReviewLadder.self, from: Data(#"{"tier":"2","rungs":[]}"#.utf8))
        XCTAssertNil(ladder.pages)
    }
}

/// Phase 12.3 WI-4: Tier 3a/3b became 3/4. A ladder from a backend that has
/// not been restarted since the rename still decodes, under the new names.
final class LegacyTierDecodingTests: XCTestCase {
    func testTheOldTierNamesDecodeAsTier3And4() throws {
        let json = Data("""
        {"tier":"3a","rungs":[{"tier":"3a","pages":2,"scores":3,"trusted_scores":1,"critics":["Vinous"],"vintages":[2021]},
                              {"tier":"3b","pages":1,"scores":1,"trusted_scores":0,"critics":[],"vintages":[2019]}]}
        """.utf8)
        let ladder = try JSONDecoder().decode(ReviewLadder.self, from: json)
        XCTAssertEqual(ladder.tier, "3")
        XCTAssertEqual(ladder.rungs.map(\.tier), ["3", "4"])
        XCTAssertEqual(TierCopy.headline(ladder.tier), "Matched at Tier 3 · different bottling, same vintage")
        XCTAssertEqual(LadderTier.normalize("2"), "2")
    }
}
