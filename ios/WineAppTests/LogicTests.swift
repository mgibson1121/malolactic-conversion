import XCTest
@testable import WineApp

final class DrinkReadinessTests: XCTestCase {
    private let window = DrinkingWindow(start: "2026-01-01", end: "2038-12-31")

    private func readiness(_ window: DrinkingWindow?, on date: String) -> DrinkReadiness {
        DrinkReadiness.of(window, today: day(date), calendar: utcCalendar)
    }

    func testBeforeTheWindowNeedsTime() {
        XCTAssertEqual(readiness(window, on: "2025-12-31"), .needsTime)
    }

    func testBothEndpointsAreInsideTheWindow() {
        XCTAssertEqual(readiness(window, on: "2026-01-01"), .readyNow)
        XCTAssertEqual(readiness(window, on: "2038-12-31"), .readyNow)
    }

    func testPastTheWindowCountsAsReadyNowOnTheWidget() {
        let result = readiness(window, on: "2039-01-01")
        XCTAssertEqual(result, .pastWindow)
        XCTAssertEqual(result.segment, .readyNow)
    }

    func testANilWindowIsNeverGuessedAt() {
        XCTAssertEqual(readiness(nil, on: "2030-06-01"), .noWindow)
    }
}

final class CriticScoresTests: XCTestCase {
    private func score(_ publication: String, _ value: Double, known: Bool = true) -> CriticScore {
        CriticScore(publication: publication, score: value, knownPublication: known,
                    drinkingWindow: nil, vintageCharacter: nil, deal: false)
    }

    private func review(_ scores: [CriticScore]) -> RetailerReview {
        RetailerReview(slug: "zachys", name: "Zachys", productUrl: "https://example.com", criticScores: scores,
                       fetchedAt: "2026-09-20T00:00:00.000Z", source: .configured, pageVintage: nil, vintageGap: nil,
                       match: MatchVerdict(producer: .match, denomination: .match, bottling: .match, vintage: .match,
                                           candidateVintage: nil, vintageGap: nil),
                       pagePrice: nil)
    }

    func testDedupesByPublicationKeepingTheFirstOccurrence() throws {
        let scores = CriticScores.deduped(try Fixture.fullWine.reviewData)
        XCTAssertEqual(scores.map(\.publication), ["Burghound", "Vinous", "Jancis Robinson MW"])
        XCTAssertEqual(scores[0].score, 96, "the later Burghound 95 is dropped, not averaged")
    }

    func testCardShowsTheHighestScoreWithACountOfTheRest() throws {
        let badge = try XCTUnwrap(CriticScores.cardBadge(try Fixture.fullWine.reviewData))
        // Burghound and Vinous tie at 96, both known → first in deduped order.
        XCTAssertEqual(badge.text, "96 BH")
        XCTAssertEqual(badge.suffix, "+2")
    }

    func testATieIsWonByAKnownPublication() throws {
        let badge = try XCTUnwrap(CriticScores.cardBadge([review([score("Some Blog", 94, known: false), score("Wine Spectator", 94)])]))
        XCTAssertEqual(badge.text, "94 WS")
        XCTAssertTrue(badge.isKnownPublication)
    }

    func testAnUnnormalizedSourceShowsTruncatedRawText() throws {
        let badge = try XCTUnwrap(CriticScores.cardBadge([review([score("Jancis Robinson MW", 18.5, known: false)])]))
        XCTAssertEqual(badge.text, "18.5 Jancis Robin…")
        XCTAssertFalse(badge.isKnownPublication)
        XCTAssertNil(badge.suffix)
    }

    func testNoScoresMeansNoBadge() {
        XCTAssertNil(CriticScores.cardBadge(nil))
        XCTAssertNil(CriticScores.cardBadge([review([])]))
    }
}

final class CellarSummaryTests: XCTestCase {
    private func wine(_ id: String, region: String?, colour: WineColor?, bottles: Int,
                      window: DrinkingWindow? = nil) -> Wine {
        Wine(id: id, producer: "Test", vintage: 2019, region: region, denomination: nil,
             qualityClassification: nil, vineyard: nil, cuvee: nil, grapeVarieties: nil, wineColor: colour,
             labelImageUrl: nil, tagDiscovered: false, tagWishlist: false, tagCellar: true, tagConsumed: false,
             cellarQuantity: bottles, cellarCategory: nil, drinkingWindow: window, drinkingWindowSource: nil,
             vintageRating: nil, vintageRatingSource: nil, myRating: nil, myTags: [], wishlistNotes: nil,
             pricePaid: nil, purchasedFrom: nil, latestTastingNoteId: nil, latestTastingNoteDate: nil,
             priceData: nil, retailerLinks: nil, reviewData: nil, dateAdded: "2026-01-01T00:00:00.000Z",
             dateFirstConsumed: nil, promotedAt: "2026-01-01T00:00:00.000Z")
    }

    func testTotalsCapacityAndClampedFill() {
        let wines = [wine("a", region: "Burgundy", colour: .red, bottles: 100),
                     wine("b", region: "Burgundy", colour: .white, bottles: 48)]
        let summary = CellarSummary(wines: wines, settings: AppSettings(cellarCapacity: 120), today: .now)
        XCTAssertEqual(summary.totalBottles, 148)
        XCTAssertEqual(summary.percentFull, 123)
        XCTAssertEqual(summary.fillFraction, 1, "the bar clamps; the red pill carries the overage")
        XCTAssertTrue(summary.isOverCapacity)
    }

    func testNoCapacityMeansNoPercentage() {
        let summary = CellarSummary(wines: [wine("a", region: nil, colour: nil, bottles: 2)], settings: AppSettings(cellarCapacity: nil), today: .now)
        XCTAssertNil(summary.percentFull)
        XCTAssertNil(summary.fillFraction)
        XCTAssertFalse(summary.isOverCapacity)
    }

    func testRegionsGroupLikeTheWebAndDropEmptyOnes() {
        let wines = [
            wine("a", region: "Burgundy", colour: .red, bottles: 3),
            wine("b", region: "Burgundy", colour: .white, bottles: 2),
            wine("c", region: nil, colour: nil, bottles: 1),
            wine("d", region: "Piedmont", colour: .red, bottles: 0),
        ]
        let summary = CellarSummary(wines: wines, settings: nil, today: .now)
        XCTAssertEqual(summary.regions.map(\.region), ["Burgundy", "Unspecified"])
        XCTAssertEqual(summary.regions[0].counts, ColourCounts(red: 3, white: 2, rose: 0, unknown: 0))
        XCTAssertEqual(summary.colours, ColourCounts(red: 3, white: 2, rose: 0, unknown: 1))
    }

    func testReadinessCountsWinesNotBottles() {
        let wines = [
            wine("a", region: nil, colour: nil, bottles: 6, window: DrinkingWindow(start: "2020-01-01", end: "2030-12-31")),
            wine("b", region: nil, colour: nil, bottles: 1, window: DrinkingWindow(start: "2031-01-01", end: "2040-12-31")),
            wine("c", region: nil, colour: nil, bottles: 2),
        ]
        let summary = CellarSummary(wines: wines, settings: nil, today: day("2026-09-23"), calendar: utcCalendar)
        XCTAssertEqual(summary.readiness, [.readyNow: 1, .needsTime: 1, .noWindow: 1])
        XCTAssertTrue(summary.hasReadinessData)
    }
}

final class WineFormattingTests: XCTestCase {
    func testTitleJoinsProducerAndDenomination() throws {
        XCTAssertEqual(WineFormatting.title(try Fixture.fullWine),
                       "Domaine Comte Georges de Vogüé · Chambolle-Musigny 1er Cru Les Amoureuses")
    }

    func testNVAndTheDashFallback() throws {
        var wine = try Fixture.decode(Wine.self, "wine-draft-nv")
        XCTAssertEqual(WineFormatting.subtitle(wine), "NV · Champagne")
        wine.producer = nil
        XCTAssertEqual(WineFormatting.title(wine), "—")
    }

    func testDrinkWindowUsesTwoDigitYearsAndIsOmittedWhenNil() {
        XCTAssertEqual(WineFormatting.drinkWindow(DrinkingWindow(start: "2026-01-01", end: "2038-12-31")), "Drink '26–'38")
        XCTAssertNil(WineFormatting.drinkWindow(nil))
    }

    func testPricesAreWholeDollarsAndNeverAbbreviated() {
        XCTAssertEqual(WineFormatting.price(690.5), "$691")
        XCTAssertEqual(WineFormatting.price(1240), "$1,240")
        XCTAssertNil(WineFormatting.price(nil))
    }
}

final class PlumbingTests: XCTestCase {
    func testLabelImageNeverExceeds1024AndNeverUpscales() {
        XCTAssertEqual(LabelImage.targetPixelSize(for: CGSize(width: 4032, height: 3024)), CGSize(width: 1024, height: 768))
        XCTAssertEqual(LabelImage.targetPixelSize(for: CGSize(width: 3024, height: 4032)), CGSize(width: 768, height: 1024))
        XCTAssertEqual(LabelImage.targetPixelSize(for: CGSize(width: 800, height: 600)), CGSize(width: 800, height: 600))
    }

    func testServerMessagesFollowTheWebClientsNormalisation() {
        let plain = Data(#"{"error":"Wine not found"}"#.utf8)
        XCTAssertEqual(APIError.serverMessage(from: plain, status: 404), "Wine not found")

        let format = Data(#"{"error":"IMAGE_FORMAT_UNSUPPORTED","message":"Try saving the photo as a JPEG."}"#.utf8)
        XCTAssertEqual(APIError.serverMessage(from: format, status: 400), "IMAGE_FORMAT_UNSUPPORTED")

        let zod = Data(#"{"error":{"_errors":[],"vintage":{"_errors":["Expected number"]}}}"#.utf8)
        XCTAssertEqual(APIError.serverMessage(from: zod, status: 400), "HTTP 400", "never a JSON blob")

        XCTAssertEqual(APIError.serverMessage(from: Data(), status: 502), "HTTP 502")
    }

    func testServerAddressAcceptsABareHostAndPort() {
        XCTAssertEqual(AppSession.normalisedURL("192.168.1.20:3000")?.absoluteString, "http://192.168.1.20:3000")
        XCTAssertEqual(AppSession.normalisedURL(" http://mac.local:3000 ")?.absoluteString, "http://mac.local:3000")
        XCTAssertNil(AppSession.normalisedURL(""))
    }

    @MainActor
    func testNotesTabSortsByLatestNoteDateNewestFirst() throws {
        var older = try Fixture.fullWine
        older.latestTastingNoteDate = "2026-01-01T00:00:00.000Z"
        var newer = older
        newer.latestTastingNoteDate = "2026-06-01T00:00:00.000Z"
        var none = older
        none.latestTastingNoteDate = nil

        let sorted = WineListModel.ordered([older, none, newer], for: .notes)
        XCTAssertEqual(sorted.map(\.latestTastingNoteDate), ["2026-06-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", nil])
        XCTAssertEqual(WineListModel.ordered([older, none, newer], for: .cellar).map(\.latestTastingNoteDate),
                       [older, none, newer].map(\.latestTastingNoteDate), "other tabs keep server order")
    }
}
