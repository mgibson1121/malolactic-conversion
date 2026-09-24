import XCTest
@testable import WineApp

/// The Swift mirror of `shared/types.ts` against real API output.
final class ModelDecodingTests: XCTestCase {
    func testDecodesAFullyEnrichedPromotedWine() throws {
        let wine = try Fixture.fullWine

        XCTAssertEqual(wine.producer, "Domaine Comte Georges de Vogüé")
        XCTAssertEqual(wine.vintage, 2019)
        XCTAssertEqual(wine.wineColor, .red)
        XCTAssertTrue(wine.tagCellar)
        XCTAssertTrue(wine.tagDiscovered)
        XCTAssertTrue(wine.tagConsumed, "set by the tasting note")
        XCTAssertFalse(wine.tagWishlist)
        XCTAssertEqual(wine.cellarQuantity, 3)
        XCTAssertEqual(wine.drinkingWindow, DrinkingWindow(start: "2026-01-01", end: "2038-12-31"))
        XCTAssertEqual(wine.myRating, .outstanding)
        XCTAssertFalse(wine.isDraft)
        XCTAssertEqual(wine.latestTastingNoteDate, "2026-09-21T20:30:00.000Z")
        XCTAssertEqual(wine.retailerLinks?["kl"], "https://www.klwines.com/p/i?i=1592587",
                       "slug keys must survive decoding untouched")
    }

    func testDecodesPriceDataWithEveryRetailerBadgeDimension() throws {
        let price = try XCTUnwrap(try Fixture.fullWine.priceData)

        XCTAssertEqual(price.priceAvg, 690.5)
        XCTAssertEqual(price.otherVintagePriceRange, PriceRange(min: 520, max: 910))
        XCTAssertEqual(price.retailers.count, 3)
        XCTAssertEqual(price.nearestRetailer?.slug, "zachys")

        let kl = try XCTUnwrap(price.retailers.first { $0.slug == "kl" })
        XCTAssertTrue(kl.linkOnly)
        XCTAssertNil(kl.price)
        XCTAssertEqual(kl.verification, .unchecked)
        XCTAssertEqual(kl.vintageVerdict, .unknown)

        let benchmark = try XCTUnwrap(price.retailers.first { $0.slug == "benchmark" })
        XCTAssertTrue(benchmark.vintageMismatch)
        XCTAssertTrue(benchmark.nonStandardFormat)
        XCTAssertEqual(benchmark.formatLabel, "1.5L")
        XCTAssertEqual(benchmark.bottleSizeMl, 1500)
        XCTAssertEqual(benchmark.verification, .unverified)
    }

    func testDecodesReviewDataIncludingUnnormalizedHalfPointScores() throws {
        let reviews = try XCTUnwrap(try Fixture.fullWine.reviewData)

        XCTAssertEqual(reviews.count, 2)
        XCTAssertEqual(reviews[0].match.vintage, .match)
        XCTAssertEqual(reviews[0].match.candidateVintage, 2019)
        XCTAssertEqual(reviews[1].source, .fallback)
        XCTAssertNil(reviews[1].pageVintage)

        let jancis = reviews[1].criticScores[1]
        XCTAssertEqual(jancis.score, 18.5)
        XCTAssertFalse(jancis.knownPublication)
        XCTAssertTrue(jancis.deal)
        XCTAssertEqual(jancis.drinkingWindow, CriticDrinkingWindow(start: 2030, end: nil))
    }

    func testDecodesABareNVDraftWithEveryTier2FieldNull() throws {
        let wine = try Fixture.decode(Wine.self, "wine-draft-nv")

        XCTAssertTrue(wine.isDraft)
        XCTAssertNil(wine.vintage)
        XCTAssertNil(wine.denomination)
        XCTAssertNil(wine.wineColor)
        XCTAssertNil(wine.grapeVarieties)
        XCTAssertNil(wine.priceData)
        XCTAssertNil(wine.reviewData)
        XCTAssertNil(wine.latestTastingNoteDate)
        XCTAssertFalse(wine.tagDiscovered || wine.tagWishlist || wine.tagCellar || wine.tagConsumed)
    }

    func testDecodesAListResponse() throws {
        let wines = try Fixture.decode([Wine].self, "wine-list")
        XCTAssertEqual(wines.count, 1)
    }

    func testDecodesATastingNote() throws {
        let note = try Fixture.decode(TastingNote.self, "tasting-note")
        XCTAssertEqual(note.myRating, .outstanding)
        XCTAssertEqual(note.nosePrimaryAromas, ["red cherry", "violet"])
        XCTAssertEqual(note.tags, ["silky", "floral"])
    }

    func testDecodesSettings() throws {
        XCTAssertEqual(try Fixture.decode(AppSettings.self, "settings").cellarCapacity, 120)
    }

    func testDecodesAllThreeDuplicateOutcomes() throws {
        XCTAssertEqual(try Fixture.decode(DuplicateOutcome.self, "duplicate-none"), .noMatch)

        guard case .duplicate(let wine) = try Fixture.decode(DuplicateOutcome.self, "duplicate-match") else {
            return XCTFail("expected .duplicate")
        }
        XCTAssertEqual(wine.vintage, 2019)

        guard case .vintageMismatch(let other) = try Fixture.decode(DuplicateOutcome.self, "duplicate-vintage-mismatch") else {
            return XCTFail("expected .vintageMismatch")
        }
        XCTAssertEqual(other.vintage, 2019)
    }
}

/// Request bodies: what the backend's zod schemas will actually receive.
final class RequestEncodingTests: XCTestCase {
    private func json(_ value: some Encodable) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testPatchOmitsUnsetFieldsSoProvenanceIsNeverFlippedByAccident() throws {
        let body = try json(WinePatch(tagWishlist: true, cellarQuantity: 4))
        XCTAssertEqual(Set(body.keys), ["tag_wishlist", "cellar_quantity"])
    }

    func testSettingsSendsAnExplicitNullToClearCapacity() throws {
        let body = try json(AppSettings(cellarCapacity: nil))
        XCTAssertTrue(body.keys.contains("cellar_capacity"))
        XCTAssertTrue(body["cellar_capacity"] is NSNull)
    }

    func testDuplicateCheckSendsTheThreeIdentityFields() throws {
        let scan = LabelScanResult(producer: "Bollinger", vintage: nil, region: "Champagne", denomination: nil,
                                   qualityClassification: nil, vineyard: nil, cuvee: nil, grapeVarieties: nil,
                                   wineColor: nil, missingTier1Fields: ["vintage", "denomination"])
        let body = try json(DuplicateCheckRequest(scan))
        XCTAssertEqual(Set(body.keys), ["producer", "denomination", "vintage"])
        XCTAssertEqual(body["producer"] as? String, "Bollinger")
        XCTAssertTrue(body["vintage"] is NSNull)
    }

    func testPromoteTagsUseSnakeCaseKeys() throws {
        let body = try json(PromoteTags(tagWishlist: true))
        XCTAssertEqual(body["tag_wishlist"] as? Bool, true)
        XCTAssertEqual(body["tag_discovered"] as? Bool, false)
    }

    func testFilterBuildsTheWebsQueryParams() {
        var filter = WineFilter.notes
        filter.myRating = .veryGood
        filter.q = "  "
        XCTAssertEqual(filter.queryItems, [
            URLQueryItem(name: "has_tasting_note", value: "true"),
            URLQueryItem(name: "my_rating", value: "very_good"),
        ], "a whitespace-only query is not sent")
    }
}
