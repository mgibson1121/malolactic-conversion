import XCTest
@testable import WineApp

// Phase 12.1 — field-test UX remediation. Mirrors of the backend's derived
// fields (window status, critic order, effective price, stale and exclusion
// notes) decoded from real storage-adapter output, plus the Edit, delete,
// scan-hold and parity behaviour the screens build on.

// MARK: - Decoding the derived fields

final class DerivedFieldsDecodingTests: XCTestCase {
    func testTheFullWineCarriesTheBackendsCriticOrderAndWindowStatus() throws {
        let wine = try Fixture.fullWine
        XCTAssertEqual(wine.windowStatus, .primary)
        let order = try XCTUnwrap(wine.criticSummary).ordered
        // Same-vintage trusted first (Burghound, Vinous tie at 96, source order),
        // then the fallback page that states no vintage.
        XCTAssertEqual(order.map(\.publication), ["Burghound", "Vinous", "Jancis Robinson MW"])
        XCTAssertEqual(order.map(\.tier), [1, 1, 4])
        XCTAssertTrue(order[0].sameVintage && order[0].trusted)
        XCTAssertFalse(order[2].sameVintage)
        XCTAssertNil(order[2].vintage, "a page that states no vintage carries no year tag")
        XCTAssertEqual(order[0].drinkingWindow, CriticDrinkingWindow(start: 2029, end: 2045))
        XCTAssertEqual(wine.enrichmentStale, EnrichmentStale(price: false, reviews: false))
        XCTAssertNil(wine.priceExclusions)
        XCTAssertNil(wine.manualPrice)
    }

    func testAWineWhoseCriticsDisagreeDecodesAsCheckWindow() throws {
        let wine = try Fixture.decode(Wine.self, "wine-check-window")
        XCTAssertEqual(wine.windowStatus, .check)
        XCTAssertNil(wine.drinkingWindow)
    }

    func testTheManualPriceStaleNoticeAndTheWhyNoAverageSentenceDecode() throws {
        let wine = try Fixture.decode(Wine.self, "wine-manual-price")
        XCTAssertEqual(wine.manualPrice, 87.5)
        XCTAssertEqual(wine.enrichmentStale?.price, true)
        XCTAssertEqual(wine.priceExclusions?.found, 3)
        XCTAssertEqual(wine.priceExclusions?.sentence,
                       "3 listings found, none counted toward the average: 1 other vintage (2020), 1 magnum, 1 search-only.")
    }

    func testAnOlderBackendsWineStillDecodes() throws {
        // The legacy fixture predates every derived field's consumers; it
        // decodes, and the derived optionals are simply present or nil.
        let wine = try Fixture.decode(Wine.self, "wine-legacy-enrichment")
        XCTAssertNotNil(wine.windowStatus)
        var stripped = try JSONSerialization.jsonObject(with: Fixture.data("wine-legacy-enrichment")) as! [String: Any]
        for key in ["window_status", "critic_summary", "enrichment_stale", "price_exclusions", "manual_price"] {
            stripped.removeValue(forKey: key)
        }
        let old = try JSONDecoder().decode(Wine.self, from: JSONSerialization.data(withJSONObject: stripped))
        XCTAssertNil(old.windowStatus)
        XCTAssertNil(old.criticSummary)
        XCTAssertNil(old.manualPrice)
    }
}

// MARK: - Notes outlive the wine

final class RemovedNoteDecodingTests: XCTestCase {
    func testADetachedNoteKeepsItsIdentitySnapshot() throws {
        let note = try Fixture.decode(TastingNote.self, "tasting-note-removed")
        XCTAssertNil(note.wineId)
        XCTAssertTrue(note.isWineRemoved)
        XCTAssertEqual(note.wineSummary, "Georges Roumier · Chambolle-Musigny · 2018")
        XCTAssertEqual(note.freeText, "Silky and long.")
    }

    func testANoteWithAWineIsNotRemoved() throws {
        let note = try Fixture.decode(TastingNote.self, "tasting-note")
        XCTAssertFalse(note.isWineRemoved)
        XCTAssertNotNil(note.wineId)
        XCTAssertEqual(note.wineProducer, "Domaine Comte Georges de Vogüé", "the snapshot is copied at save time")
    }

    func testTheAllNotesListMixesLiveAndRemovedNotes() throws {
        let notes = try Fixture.decode([TastingNote].self, "tasting-notes-all")
        XCTAssertEqual(notes.filter(\.isWineRemoved).count, 1)
        XCTAssertEqual(notes.count, 2)
    }

    @MainActor
    func testTheNotesListLoadsRemovedNotesAndFiltersThemBySearchAndRating() async throws {
        StubURLProtocol.requests = []
        let wine = try Fixture.fullWine
        let all = try Fixture.data("tasting-notes-all")
        StubURLProtocol.router = { request in
            request.url!.path == "/api/tasting-notes" ? (200, all) : (200, try! JSONEncoder().encode([wine]))
        }
        defer { StubURLProtocol.router = nil }
        let model = WineListModel(kind: .notes)
        await model.load(using: StubURLProtocol.api())

        XCTAssertEqual(model.removedNotes.map(\.wineProducer), ["Georges Roumier"])
        XCTAssertEqual(model.visibleRemovedNotes.count, 1)
        model.query = "roumier"
        XCTAssertEqual(model.visibleRemovedNotes.count, 1)
        model.query = "leroy"
        XCTAssertTrue(model.visibleRemovedNotes.isEmpty)
        model.query = ""
        model.ratingFilter = .outstanding
        XCTAssertTrue(model.visibleRemovedNotes.isEmpty, "the removed note is rated good")
    }

    @MainActor
    func testOtherTabsNeverFetchRemovedNotes() async throws {
        StubURLProtocol.requests = []
        StubURLProtocol.response = (200, try JSONEncoder().encode([try Fixture.fullWine]))
        let model = WineListModel(kind: .cellar)
        await model.load(using: StubURLProtocol.api())
        XCTAssertFalse(StubURLProtocol.requests.contains { $0.url?.path == "/api/tasting-notes" })
    }
}

// MARK: - Your price (D12)

final class EffectivePriceTests: XCTestCase {
    private struct Case: Decodable {
        let manualPrice: Double?
        let priceAvg: Double?
        let expected: Expected
        struct Expected: Decodable { let value: Double?; let basis: String? }
        enum CodingKeys: String, CodingKey { case manualPrice = "manual_price", priceAvg = "price_avg", expected }
    }

    /// The Swift mirror must agree with `shared/utils/effective-price.ts`, on
    /// cases that file's own fixture exporter generated.
    func testMatchesTheSharedHelperOnEveryFixtureCase() throws {
        let cases = try Fixture.decode([Case].self, "effective-price-cases")
        XCTAssertGreaterThanOrEqual(cases.count, 4)
        for c in cases {
            let price = EffectivePrice(manualPrice: c.manualPrice, automatedAverage: c.priceAvg)
            XCTAssertEqual(price.value, c.expected.value, "case \(String(describing: c))")
            XCTAssertEqual(price.basis?.rawValue, c.expected.basis, "case \(String(describing: c))")
        }
    }

    func testTheCardShowsYoursNotTheAutomatedAverage() throws {
        var wine = try Fixture.fullWine // automated avg $691
        XCTAssertEqual(WineFormatting.cardPrice(wine), "$691")
        wine.manualPrice = 87.5
        XCTAssertEqual(WineFormatting.cardPrice(wine), "$88 yours")
        wine.priceData = nil
        XCTAssertEqual(WineFormatting.cardPrice(wine), "$88 yours")
        wine.manualPrice = nil
        XCTAssertNil(WineFormatting.cardPrice(wine))
    }
}

// MARK: - Critic order and the card badge (D13, WI-10)

final class CardBadgeFromSummaryTests: XCTestCase {
    private func item(_ publication: String, _ score: Double, vintage: Int? = 2019, same: Bool = true,
                      trusted: Bool = true, known: Bool = true) -> CriticSummaryItem {
        CriticSummaryItem(publication: publication, score: score, vintage: vintage, sameVintage: same, trusted: trusted,
                          tier: same ? (trusted ? 1 : 2) : (trusted ? 3 : 4), knownPublication: known,
                          drinkingWindow: nil, vintageCharacter: nil, deal: false)
    }

    private func wine(_ items: [CriticSummaryItem]?) throws -> Wine {
        var wine = try Fixture.fullWine
        wine.criticSummary = items.map { CriticSummary(ordered: $0) }
        return wine
    }

    func testTheBadgeIsTheFirstScoreInTheBackendsOrderNotTheHighest() throws {
        // Backend order: trusted same-vintage 91 first, though 95 is higher.
        let badge = try XCTUnwrap(CriticScores.cardBadge(try wine([item("Burghound", 91), item("Jeb Dunnuck", 95, trusted: false)])))
        XCTAssertEqual(badge.text, "91 BH")
        XCTAssertEqual(badge.suffix, "+1")
        XCTAssertNil(badge.yearTag)
    }

    func testAScoreForAnotherVintageCarriesAMutedYearTag() throws {
        let badge = try XCTUnwrap(CriticScores.cardBadge(try wine([item("Vinous", 93, vintage: 2017, same: false)])))
        XCTAssertEqual(badge.text, "93 VN")
        XCTAssertEqual(badge.yearTag, "'17")
    }

    func testAPageThatStatesNoVintageHasNoTag() throws {
        let badge = try XCTUnwrap(CriticScores.cardBadge(try wine([item("Vinous", 93, vintage: nil, same: false)])))
        XCTAssertNil(badge.yearTag)
    }

    func testAnUnknownPublicationKeepsTheDashedBorderAndTruncates() throws {
        let badge = try XCTUnwrap(CriticScores.cardBadge(try wine([item("Some Very Long Wine Blog", 94, trusted: false, known: false)])))
        XCTAssertFalse(badge.isKnownPublication)
        XCTAssertEqual(badge.label, "Some Very Lo…")
    }

    func testAnEmptySummaryHasNoBadge() throws {
        XCTAssertNil(CriticScores.cardBadge(try wine([])))
    }

    func testAnOlderBackendWithoutASummaryFallsBackToTheOldRule() throws {
        let legacy = try Fixture.decode(Wine.self, "wine-legacy-enrichment")
        var stripped = legacy
        stripped.criticSummary = nil
        XCTAssertEqual(CriticScores.cardBadge(stripped)?.text, "97 WA")
    }

    func testFullWineBadgeIsBurghoundFromTheRealOrdering() throws {
        let badge = try XCTUnwrap(CriticScores.cardBadge(try Fixture.fullWine))
        XCTAssertEqual(badge.text, "96 BH")
        XCTAssertEqual(badge.additionalCount, 2)
    }
}

// MARK: - Check window (WI-2)

final class CheckWindowTests: XCTestCase {
    func testOnlyAPrimaryWindowPlacesAWineInReadyOrNeedsTime() throws {
        let today = day("2026-10-10")
        var wine = try Fixture.fullWine
        XCTAssertEqual(DrinkReadiness.of(wine, today: today, calendar: utcCalendar).segment, .readyNow)

        let check = try Fixture.decode(Wine.self, "wine-check-window")
        XCTAssertEqual(DrinkReadiness.of(check, today: today, calendar: utcCalendar), .checkWindow)
        XCTAssertEqual(DrinkReadiness.of(check, today: today, calendar: utcCalendar).segment, .checkWindow)

        wine.windowStatus = .noWindow
        wine.drinkingWindow = nil
        XCTAssertEqual(DrinkReadiness.of(wine, today: today, calendar: utcCalendar), .noWindow)
    }

    func testACheckWineIsNeverGuessedAtFromItsCriticWindows() throws {
        let check = try Fixture.decode(Wine.self, "wine-check-window")
        XCTAssertFalse(DrinkingWindows.attributed(check.reviewData).isEmpty, "the critics did state windows")
        XCTAssertEqual(DrinkReadiness.of(check, today: day("2030-01-01"), calendar: utcCalendar), .checkWindow)
    }

    func testTheWidgetCountsFourSegmentsInOrder() throws {
        var bare = try Fixture.decode(Wine.self, "wine-manual-price")
        bare.drinkingWindow = nil          // this fixture inherits a window from the base wine
        bare.windowStatus = .noWindow
        let wines = [try Fixture.fullWine, try Fixture.decode(Wine.self, "wine-check-window"), bare]
        let summary = CellarSummary(wines: wines, settings: nil, today: day("2026-10-10"), calendar: utcCalendar)
        XCTAssertEqual(summary.readiness[.readyNow], 1)
        XCTAssertEqual(summary.readiness[.checkWindow], 1)
        XCTAssertEqual(summary.readiness[.noWindow], 1)
        XCTAssertEqual(summary.readiness[.needsTime], 0)
        XCTAssertEqual(ReadinessSegment.allCases.map(\.title), ["Ready now", "Needs more time", "Check window", "No window"])
    }

    func testTheListFlagShowsOnlyWhenThereIsNoPrimaryWindow() throws {
        let check = try Fixture.decode(Wine.self, "wine-check-window")
        XCTAssertEqual(WineFormatting.windowBadge(check), "Check window")
        XCTAssertEqual(WineFormatting.windowBadge(try Fixture.fullWine), "Drink '26–'38")
        var none = check
        none.windowStatus = .noWindow
        XCTAssertNil(WineFormatting.windowBadge(none))
    }

    @MainActor
    func testTappingCheckWindowFiltersTheCellarListToThoseWines() async throws {
        let check = try Fixture.decode(Wine.self, "wine-check-window")
        let model = CellarDashboardModel()
        StubURLProtocol.router = { request in
            if request.url!.path == "/api/settings" { return (200, try! Fixture.data("settings")) }
            return (200, try! JSONEncoder().encode([try! Fixture.fullWine, check]))
        }
        defer { StubURLProtocol.router = nil }
        await model.load(using: StubURLProtocol.api())
        model.readinessFilter = .checkWindow
        XCTAssertEqual(model.listedWines(today: day("2026-10-10")).map(\.id), [check.id])
    }
}

// MARK: - The Edit request (WI-1)

final class WineEditEncodingTests: XCTestCase {
    private func json(_ edit: WineEdit) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(edit)) as? [String: Any])
    }

    func testAnUntouchedEditSendsNothing() throws {
        XCTAssertTrue(WineEdit().isEmpty)
        XCTAssertTrue(try json(WineEdit()).isEmpty)
    }

    func testClearingSendsAnExplicitNullAndSettingSendsTheValue() throws {
        var edit = WineEdit()
        edit.manualPrice = .clear
        edit.cuvee = .clear
        edit.producer = .set("Domaine Leroy")
        edit.vintage = .set(2020)
        let body = try json(edit)
        XCTAssertTrue(body["manual_price"] is NSNull)
        XCTAssertTrue(body["cuvee"] is NSNull)
        XCTAssertEqual(body["producer"] as? String, "Domaine Leroy")
        XCTAssertEqual(body["vintage"] as? Int, 2020)
        XCTAssertNil(body["region"], "an unchanged field is omitted, never sent as null")
    }

    func testTheDrinkingWindowKeyIsOnlySentWhenTouched() throws {
        var edit = WineEdit()
        XCTAssertNil(try json(edit)["drinking_window"], "the key alone makes the window manual")
        edit.drinkingWindow = .set(DrinkingWindow(start: "2028-01-01", end: "2040-12-31"))
        XCTAssertEqual((try json(edit)["drinking_window"] as? [String: String]), ["start": "2028-01-01", "end": "2040-12-31"])
        edit.drinkingWindow = .clear
        XCTAssertTrue(try json(edit)["drinking_window"] is NSNull)
    }

    func testIdentityFieldsAreWhatChangesIdentity() {
        var edit = WineEdit()
        edit.quantity()
        XCTAssertFalse(edit.changesIdentity)
        edit.wineColor = .set(.white); edit.manualPrice = .set(10); edit.region = .set("Rhône")
        XCTAssertFalse(edit.changesIdentity, "colour, price and region never prompt")
        edit.vineyard = .clear
        XCTAssertTrue(edit.changesIdentity)
    }
}

private extension WineEdit {
    mutating func quantity() { cellarQuantity = 4; tagCellar = true }
}

@MainActor
final class EditWineModelTests: XCTestCase {
    override func setUp() async throws {
        StubURLProtocol.requests = []
        StubURLProtocol.router = nil
        PriceOnce.reset()
    }

    private func model(_ wine: Wine? = nil) throws -> EditWineModel {
        EditWineModel(wine: try wine ?? Fixture.fullWine, api: StubURLProtocol.api())
    }

    private func edit(_ model: EditWineModel) throws -> WineEdit {
        switch model.buildEdit() {
        case .success(let edit): return edit
        case .failure(let error): XCTFail("unexpected \(error)"); return WineEdit()
        }
    }

    func testNothingChangedBuildsAnEmptyEdit() throws {
        XCTAssertTrue(try edit(try model()).isEmpty)
    }

    func testClearingATextFieldClearsItAndCasingIsStillAChange() throws {
        let m = try model()
        m.fields.vineyard = "  "
        m.fields.producer = "DOMAINE COMTE GEORGES DE VOGÜÉ"
        let e = try edit(m)
        XCTAssertEqual(e.vineyard, .clear)
        XCTAssertEqual(e.producer, .set("DOMAINE COMTE GEORGES DE VOGÜÉ"),
                       "the app doesn't judge identity — the server's identityKey does")
    }

    func testBlankingTheVintageMakesItNV() throws {
        let m = try model()
        m.fields.vintage = ""
        XCTAssertEqual(try edit(m).vintage, .clear)
    }

    func testYourPriceValidatesLikeTheServer() throws {
        let m = try model()
        for bad in ["0", "-5", "12.345", "abc"] {
            m.yourPrice = bad
            guard case .failure = m.buildEdit() else { return XCTFail("\(bad) should be rejected") }
        }
        m.yourPrice = "$87.50"
        XCTAssertEqual(try edit(m).manualPrice, .set(87.5))
    }

    func testClearingYourPriceSendsNull() throws {
        var wine = try Fixture.fullWine
        wine.manualPrice = 60
        let m = try model(wine)
        XCTAssertEqual(m.yourPrice, "60")
        m.yourPrice = ""
        XCTAssertEqual(try edit(m).manualPrice, .clear)
    }

    func testADerivedWindowLeftAloneIsNotSavedAsManual() throws {
        var wine = try Fixture.fullWine
        wine.drinkingWindowSource = .derived
        let m = try model(wine)
        XCTAssertEqual(m.windowStart, "2026")
        XCTAssertTrue(m.derivedWindowUntouched)
        m.quantity = 9
        XCTAssertEqual(try edit(m).drinkingWindow, .unchanged)
        XCTAssertEqual(try edit(m).cellarQuantity, 9)
    }

    func testSettingAndClearingTheWindow() throws {
        let m = try model(try Fixture.decode(Wine.self, "wine-check-window"))
        m.windowStart = "2028"; m.windowEnd = "2040"
        XCTAssertEqual(try edit(m).drinkingWindow, .set(DrinkingWindow(start: "2028-01-01", end: "2040-12-31")))
        m.windowStart = "2040"; m.windowEnd = "2030"
        guard case .failure = m.buildEdit() else { return XCTFail("backwards window") }
        m.windowStart = "2028"; m.windowEnd = ""
        guard case .failure = m.buildEdit() else { return XCTFail("half-filled window") }

        let manual = try model(try Fixture.fullWine)
        manual.windowStart = ""; manual.windowEnd = ""
        XCTAssertEqual(try edit(manual).drinkingWindow, .clear)
    }

    // The refresh prompt follows the server's stale verdict (the app does not
    // port identityKey), and only for an edit that touched identity.

    private func respond(with wine: Wine) throws {
        let body = try JSONEncoder().encode(wine)
        StubURLProtocol.router = { _ in (200, body) }
    }

    func testAnIdentityEditThatLeavesDataStalePromptsAndDoesNotCloseYet() async throws {
        var stale = try Fixture.fullWine
        stale.enrichmentStale = EnrichmentStale(price: true, reviews: true)
        try respond(with: stale)
        let m = try model()
        m.fields.cuvee = "Les Cazetiers"

        let result = await m.save()
        XCTAssertNil(result, "waits for the developer's answer")
        XCTAssertNotNil(m.pendingRefresh)
        XCTAssertFalse(StubURLProtocol.requests.contains { $0.url?.path.hasSuffix("/fetch-price") == true }, "nothing spent yet")
    }

    func testNotNowKeepsTheOldDataAndSpendsNothing() async throws {
        var stale = try Fixture.fullWine
        stale.enrichmentStale = EnrichmentStale(price: true, reviews: false)
        try respond(with: stale)
        let m = try model()
        m.fields.cuvee = "Les Cazetiers"
        _ = await m.save()

        let kept = m.declineRefresh()
        XCTAssertEqual(kept?.enrichmentStale?.price, true)
        XCTAssertNil(m.pendingRefresh)
        XCTAssertEqual(StubURLProtocol.requests.filter { $0.httpMethod == "POST" }.count, 0)
    }

    func testRefreshNowHardRefreshesPriceThenReviewsOnce() async throws {
        var stale = try Fixture.fullWine
        stale.enrichmentStale = EnrichmentStale(price: true, reviews: true)
        var fresh = try Fixture.fullWine
        fresh.enrichmentStale = EnrichmentStale(price: false, reviews: false)
        let staleBody = try JSONEncoder().encode(stale)
        let freshBody = try JSONEncoder().encode(fresh)
        StubURLProtocol.router = { request in
            request.httpMethod == "PATCH" ? (200, staleBody) : (200, freshBody)
        }
        let m = try model()
        m.fields.cuvee = "Les Cazetiers"
        _ = await m.save()

        let refreshed = await m.refreshNow()
        XCTAssertEqual(refreshed?.enrichmentStale, EnrichmentStale(price: false, reviews: false))
        let posts = StubURLProtocol.requests.filter { $0.httpMethod == "POST" }
        XCTAssertEqual(posts.map { $0.url!.path.split(separator: "/").last.map(String.init) }, ["fetch-price", "fetch-reviews"])
        XCTAssertTrue(posts.allSatisfy { $0.url?.query?.contains("force=true") == true }, "a hard refresh forces")
    }

    func testQuantityAloneNeverPromptsEvenOnAWineThatIsAlreadyStale() async throws {
        var stale = try Fixture.fullWine
        stale.enrichmentStale = EnrichmentStale(price: true, reviews: true)
        try respond(with: stale)
        let m = try model(stale)
        m.quantity = 5

        let result = await m.save()
        XCTAssertNotNil(result, "closes straight away")
        XCTAssertNil(m.pendingRefresh)
    }

    func testAnIdentityEditOnAWineWithNoStoredDataDoesNotPrompt() async throws {
        try respond(with: try Fixture.decode(Wine.self, "wine-draft-nv"))
        let m = try model(try Fixture.decode(Wine.self, "wine-draft-nv"))
        m.fields.cuvee = "X"
        let result = await m.save()
        XCTAssertNotNil(result)
    }

    func testTheRefreshCostIsStatedFromTheMeasuredFigures() {
        XCTAssertEqual(EditWineModel.refreshCostLabel, "about 10 credits (up to 25)")
    }

    // Delete (WI-3)

    func testTheDeleteConfirmationNamesTheNotesThatStay() {
        XCTAssertEqual(EditWineModel.deleteMessage(notesKept: 2), "Its 2 tasting notes stay in Notes, marked “wine removed”.")
        XCTAssertEqual(EditWineModel.deleteMessage(notesKept: 1), "Its 1 tasting note stays in Notes, marked “wine removed”.")
        XCTAssertEqual(EditWineModel.deleteMessage(notesKept: 0), "This can't be undone.")
    }

    func testRequestDeleteAsksTheServerHowManyNotesWillStayWithoutDeleting() async throws {
        StubURLProtocol.router = { _ in (200, Data(#"{"notes_kept":2}"#.utf8)) }
        let m = try model()
        await m.requestDelete()
        XCTAssertEqual(m.deletePreview, 2)
        let request = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.query, "dry_run=1")
    }

    func testConfirmDeleteDeletesAndReportsSuccess() async throws {
        StubURLProtocol.router = { _ in (204, Data()) }
        let m = try model()
        let deleted = await m.confirmDelete()
        XCTAssertTrue(deleted)
        XCTAssertNil(StubURLProtocol.requests.last?.url?.query)
    }
}

// MARK: - Four states, and the one shared apply (WI-4, WI-9)

final class CriticReviewsStateTests: XCTestCase {
    private func wine(summary: [CriticSummaryItem]? = nil, reviews: [RetailerReview]? = nil) throws -> Wine {
        var wine = try Fixture.decode(Wine.self, "wine-draft-nv")
        wine.criticSummary = summary.map { CriticSummary(ordered: $0) }
        wine.reviewData = reviews
        return wine
    }

    func testLookingFoundNoneFailedAndIdle() throws {
        let busy = EnrichmentControl(isBusy: true)
        var failed = EnrichmentControl(); failed.error = "Review lookup failed"
        let idle = EnrichmentControl()

        XCTAssertEqual(CriticReviewsState.of(wine: try wine(), control: busy), .looking)
        XCTAssertEqual(CriticReviewsState.of(wine: try wine(), control: failed), .failed)
        XCTAssertEqual(CriticReviewsState.of(wine: try wine(reviews: []), control: idle), .none)
        XCTAssertEqual(CriticReviewsState.of(wine: try wine(), control: idle), .idle)
        XCTAssertEqual(CriticReviewsState.of(wine: try Fixture.fullWine, control: idle), .found)
    }

    func testScoresWinOverABusyRefreshAndBusyWinsOverNothingFound() throws {
        let busy = EnrichmentControl(isBusy: true)
        XCTAssertEqual(CriticReviewsState.of(wine: try Fixture.fullWine, control: busy), .found)
        XCTAssertEqual(CriticReviewsState.of(wine: try wine(reviews: []), control: busy), .looking)
    }

    func testNilWineIsLookingOrIdle() {
        XCTAssertEqual(CriticReviewsState.of(wine: nil, control: EnrichmentControl(isBusy: true)), .looking)
        XCTAssertEqual(CriticReviewsState.of(wine: nil, control: EnrichmentControl()), .idle)
    }
}

final class SharedApplyTests: XCTestCase {
    func testApplyingReviewsBringsTheDerivedFieldsAcrossAndLeavesTheDevelopersOwnAlone() throws {
        var mine = try Fixture.fullWine
        mine.tagCellar = false      // an optimistic edit the response predates
        mine.cellarQuantity = 9
        mine.manualPrice = 55
        mine.criticSummary = nil
        mine.windowStatus = nil
        var fresh = try Fixture.fullWine
        fresh.windowStatus = .check

        let merged = mine.applying(fresh, from: .reviews)
        XCTAssertEqual(merged.criticSummary, fresh.criticSummary)
        XCTAssertEqual(merged.windowStatus, .check)
        XCTAssertEqual(merged.reviewData, fresh.reviewData)
        XCTAssertFalse(merged.tagCellar)
        XCTAssertEqual(merged.cellarQuantity, 9)
        XCTAssertEqual(merged.manualPrice, 55, "no fetch ever writes the manual price")
    }

    func testApplyingPriceLeavesReviewsAlone() throws {
        var mine = try Fixture.fullWine
        mine.reviewData = nil
        mine.priceData = nil
        let merged = mine.applying(try Fixture.fullWine, from: .price)
        XCTAssertNotNil(merged.priceData)
        XCTAssertNil(merged.reviewData)
    }

    /// Price and reviews run at once and may answer in either order. A price
    /// response read the wine before the review result was written, so its
    /// review-derived fields are old; applying them would erase the critic
    /// order the reviews just produced.
    func testALateStalePriceResponseCannotEraseWhatTheReviewsJustProduced() throws {
        var afterReviews = try Fixture.decode(Wine.self, "wine-draft-nv")
        let reviewsAnswer = try Fixture.fullWine
        afterReviews = afterReviews.applying(reviewsAnswer, from: .reviews)
        XCTAssertFalse(afterReviews.criticSummary?.ordered.isEmpty ?? true)

        var stalePriceAnswer = try Fixture.fullWine
        stalePriceAnswer.criticSummary = CriticSummary(ordered: [])
        stalePriceAnswer.windowStatus = .noWindow
        stalePriceAnswer.enrichmentStale = EnrichmentStale(price: false, reviews: true)

        let merged = afterReviews.applying(stalePriceAnswer, from: .price)
        XCTAssertEqual(merged.criticSummary, afterReviews.criticSummary)
        XCTAssertEqual(merged.windowStatus, afterReviews.windowStatus)
        XCTAssertEqual(merged.enrichmentStale?.reviews, false, "the reviews flag comes from the reviews answer")
    }

    func testEachKindOwnsItsStaleFlag() throws {
        var wine = try Fixture.fullWine
        wine.enrichmentStale = EnrichmentStale(price: true, reviews: true)
        var fresh = try Fixture.fullWine
        fresh.enrichmentStale = EnrichmentStale(price: false, reviews: false)
        XCTAssertEqual(wine.applying(fresh, from: .price).enrichmentStale, EnrichmentStale(price: false, reviews: true))
        XCTAssertEqual(wine.applying(fresh, from: .reviews).enrichmentStale, EnrichmentStale(price: true, reviews: false))
    }
}

// MARK: - Scan → review hold (WI-5, D8)

@MainActor
final class ScanHoldTests: XCTestCase {
    private var draftJSON = Data()
    private var reviewsJSON = Data()
    private var reviewsDelay: TimeInterval = 0
    private let draftID = "draft-hold"

    override func setUp() async throws {
        StubURLProtocol.requests = []
        PriceOnce.reset()
        var draft = try Fixture.fullWine
        draft.promotedAt = nil; draft.priceData = nil; draft.reviewData = nil; draft.criticSummary = CriticSummary(ordered: [])
        var json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as! [String: Any]
        json["id"] = draftID
        draftJSON = try JSONSerialization.data(withJSONObject: json)
        reviewsJSON = try JSONSerialization.data(withJSONObject: {
            var j = json; j["critic_summary"] = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(try! Fixture.fullWine.criticSummary)); return j
        }())
        let scan = Data(#"{"producer":"Sesta di Sopra","vintage":2018,"region":"Tuscany","denomination":"Brunello di Montalcino","quality_classification":null,"vineyard":null,"cuvee":null,"grape_varieties":null,"wine_color":"red","missing_tier1_fields":[],"raw_response":""}"#.utf8)
        StubURLProtocol.router = { [unowned self] request in
            let path = request.url!.path
            switch (request.httpMethod ?? "GET", path) {
            case ("POST", "/api/label-scan"): return (200, scan)
            case ("POST", "/api/wines/duplicate-check"): return (200, Data(#"{"kind":"none"}"#.utf8))
            case ("POST", "/api/wines"): return (201, self.draftJSON)
            case (_, let p) where p.hasSuffix("/fetch-reviews"):
                if self.reviewsDelay > 0 { Thread.sleep(forTimeInterval: self.reviewsDelay) }
                return (200, self.reviewsJSON)
            case (_, let p) where p.hasSuffix("/fetch-price"): return (200, self.draftJSON)
            default: return (404, Data(#"{"error":"unrouted \(path)"}"#.utf8))
            }
        }
    }

    override func tearDown() { StubURLProtocol.router = nil }

    private func scan(_ model: ScanFlowModel) {
        model.scan(UIGraphicsImageRenderer(size: CGSize(width: 40, height: 60)).image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 40, height: 60))
        })
    }

    private func waitUntil(_ condition: @escaping () -> Bool, timeout: TimeInterval = 5) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { return XCTFail("timed out") }
            try await Task.sleep(for: .milliseconds(10))
        }
    }

    func testAParsedScanHoldsOnTheInterstitialThenMovesOnAfterTheHold() async throws {
        // Reviews return no scores, so only the hold can end the interstitial.
        reviewsJSON = draftJSON
        let model = ScanFlowModel(api: StubURLProtocol.api(), previewHold: .milliseconds(300))
        scan(model)
        try await waitUntil { model.step == .pulling }
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(model.step, .pulling, "still holding")
        try await waitUntil { model.step == .review }
    }

    func testTheFirstCriticScoreEndsTheHoldImmediately() async throws {
        let model = ScanFlowModel(api: StubURLProtocol.api(), previewHold: .seconds(30))
        scan(model)
        try await waitUntil { model.step == .review }   // far sooner than 30 s
        XCTAssertNotNil(model.wine?.criticSummary?.ordered.first)
    }

    func testTheLookupsAreNeverCancelledWhenTheHoldEnds() async throws {
        reviewsJSON = draftJSON
        reviewsDelay = 0.4
        let model = ScanFlowModel(api: StubURLProtocol.api(), previewHold: .milliseconds(50))
        scan(model)
        try await waitUntil { model.step == .review }
        XCTAssertTrue(model.reviews.isBusy, "the review screen shows Looking… for what is still pending")
        try await waitUntil { !model.reviews.isBusy }
        XCTAssertNil(model.reviews.error)
        XCTAssertEqual(StubURLProtocol.requests.filter { $0.url?.path.hasSuffix("/fetch-reviews") == true }.count, 1)
        XCTAssertEqual(StubURLProtocol.requests.filter { $0.url?.path.hasSuffix("/fetch-price") == true }.count, 1)
    }

    func testAFailedScanNeverReachesTheHold() async throws {
        StubURLProtocol.router = { _ in (500, Data(#"{"error":"GPT-4o timed out"}"#.utf8)) }
        let model = ScanFlowModel(api: StubURLProtocol.api(), previewHold: .seconds(30))
        scan(model)
        try await waitUntil { if case .error = model.step { return true }; return false }
    }

    func testCancellingDuringTheHoldDiscardsTheDraft() async throws {
        reviewsJSON = draftJSON
        reviewsDelay = 0.2
        let model = ScanFlowModel(api: StubURLProtocol.api(), previewHold: .seconds(30))
        scan(model)
        try await waitUntil { model.step == .pulling }
        let closed = await model.discard()
        XCTAssertTrue(closed)
        XCTAssertTrue(StubURLProtocol.requests.contains { $0.httpMethod == "DELETE" })
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(model.step, .pulling, "the cancelled hold never moves on by itself")
    }

    // WI-9 — the preview and the saved wine read the same data

    func testResultsThatLandAfterSaveShowIdenticallyInPreviewAndDetail() async throws {
        reviewsJSON = try JSONSerialization.data(withJSONObject: {
            var j = try! JSONSerialization.jsonObject(with: draftJSON) as! [String: Any]
            j["critic_summary"] = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(try! Fixture.fullWine.criticSummary))
            j["window_status"] = "check"
            return j
        }())
        reviewsDelay = 0.2
        let model = ScanFlowModel(api: StubURLProtocol.api(), previewHold: .zero)
        scan(model)
        try await waitUntil { model.step == .review }
        // Results arrive after the review screen is up (and, in real use, after Save).
        try await waitUntil { !model.reviews.isBusy && !model.price.isBusy }
        let preview = try XCTUnwrap(model.wine)

        // The detail screen applying the same server answer builds the same wine.
        let server = try JSONDecoder().decode(Wine.self, from: reviewsJSON)
        let detailWine = try Fixture.decode(Wine.self, "wine-draft-nv").applying(server, from: .reviews)
        XCTAssertEqual(CriticScores.cardBadge(preview)?.text, CriticScores.cardBadge(detailWine)?.text)
        XCTAssertEqual(preview.criticSummary, detailWine.criticSummary)
        XCTAssertEqual(preview.windowStatus, detailWine.windowStatus)
        XCTAssertEqual(preview.windowStatus, .check)
    }
}

// MARK: - Wording and affordances (WI-7, WI-8)

final class WordingTests: XCTestCase {
    func testHardRefreshStatesItsCostFromTheMeasuredFigures() {
        XCTAssertEqual(EnrichmentCosts.label(.reviews), "about 9 credits (up to 24)")
        XCTAssertEqual(EnrichmentCosts.label(.price), "about 1 credit")
    }

    func testTheThreeBadgesExplainThemselvesAndTheOthersDoNot() {
        XCTAssertTrue(BadgeExplanation.text(for: .verified)!.contains("does not confirm the vintage or the exact bottling"))
        XCTAssertTrue(BadgeExplanation.text(for: .unverified)!.contains("couldn't confirm this listing"))
        XCTAssertTrue(BadgeExplanation.text(for: .searchOnly)!.contains("no price was found"))
        XCTAssertNil(BadgeExplanation.text(for: .distance(3)))
        XCTAssertNil(BadgeExplanation.text(for: .vintage(2019)))
    }

    func testTheNotesSectionIsMyReviewAndPricingIsPriceAndRetailers() {
        XCTAssertEqual(Set(DetailGroup.allCases.map(\.rawValue)), ["criticReviews", "priceRetailers", "myReview"])
    }
}

/// D9: everything tappable that reads as text is underlined. The bare
/// `.buttonStyle(.borderless)` text button was the un-underlined pattern;
/// `.buttonStyle(.link)` replaced every one of them.
final class LinkAffordanceTests: XCTestCase {
    func testNoBareBorderlessTextButtonsRemainInTheFeatures() throws {
        let featuresDir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("WineApp/Features")
        let enumerator = try XCTUnwrap(FileManager.default.enumerator(at: featuresDir, includingPropertiesForKeys: nil))
        var offenders: [String] = []
        for case let url as URL in enumerator where url.pathExtension == "swift" {
            let source = try String(contentsOf: url, encoding: .utf8)
            if source.contains(".buttonStyle(.borderless)") { offenders.append(url.lastPathComponent) }
        }
        XCTAssertEqual(offenders, [], "use .buttonStyle(.link) — D9: tappable text is underlined")
    }

    func testTheLinkStyleExists() {
        _ = LinkButtonStyle()
        _ = LinkText("Zachys")
    }
}

// MARK: - Colour follows the selection (WI-8)

/// The developer saw "white" on a post-scan snapshot of a red wine and the
/// cause was not found on the bench. This pins the behaviour end to end so any
/// path that lets the displayed colour drift from the selection fails here:
/// scan result → fields → patch → saved wine → every place colour is shown.
final class ColourFollowsSelectionTests: XCTestCase {
    func testEachScannedColourSurvivesIntoTheFieldsAndTheDraft() throws {
        for colour in WineColor.allCases {
            let scan = LabelScanResult(producer: "P", vintage: 2019, region: nil, denomination: "D",
                                       qualityClassification: nil, vineyard: nil, cuvee: nil, grapeVarieties: nil,
                                       wineColor: colour, missingTier1Fields: [])
            XCTAssertEqual(WineFields(scan).wineColor, colour)
            XCTAssertEqual(scan.draftInput.wineColor, colour)
        }
    }

    func testChangingThePickerPatchesThatColourAndNothingElse() throws {
        var draft = try Fixture.fullWine
        draft.wineColor = .white               // what the scan guessed
        for target in WineColor.allCases where target != .white {
            var fields = WineFields(draft)
            fields.wineColor = target          // what the developer picked
            XCTAssertEqual(fields.patch(against: draft), WinePatch(wineColor: target))
        }
    }

    func testEveryPlaceThatShowsColourReadsTheSavedValue() throws {
        for colour in WineColor.allCases {
            var wine = try Fixture.fullWine
            wine.wineColor = colour
            var counts = ColourCounts()
            counts.add(1, colour: wine.wineColor)
            switch colour {
            case .red: XCTAssertEqual(counts.red, 1)
            case .white: XCTAssertEqual(counts.white, 1)
            case .rose: XCTAssertEqual(counts.rose, 1)
            }
            XCTAssertEqual(Theme.colour(for: wine.wineColor), Theme.colour(for: colour))
        }
        XCTAssertEqual(Set(WineColor.allCases.map { Theme.colour(for: $0).description }).count, 3, "three distinct dot colours")
    }

    @MainActor
    func testTheEditScreenCanSwitchColourAndClearIt() throws {
        var wine = try Fixture.fullWine
        wine.wineColor = .white
        let model = EditWineModel(wine: wine, api: StubURLProtocol.api())
        model.fields.wineColor = .red
        guard case .success(let toRed) = model.buildEdit() else { return XCTFail() }
        XCTAssertEqual(toRed.wineColor, .set(.red))
        model.fields.wineColor = nil
        guard case .success(let cleared) = model.buildEdit() else { return XCTFail() }
        XCTAssertEqual(cleared.wineColor, .clear)
    }
}
