import XCTest
@testable import WineApp

// Phase 14 WI-4: a running review search is shown as running wherever the wine
// appears, scores arrive under a skeleton, nothing is click-gated, and a search
// outlives the request that started it.

private func reviewsJob(_ state: JobState, done: Int = 0, total: Int = 11, scores: Int = 0, stage: String = "shops") -> ReviewsJob {
    ReviewsJob(state: state, stage: stage, startedAt: "2026-11-22T10:00:00.000Z", updatedAt: "2026-11-22T10:00:05.000Z",
               shopsTotal: total, shopsDone: done, scoresFound: scores, identity: "x")
}

/// A saved wine with no scores yet and the given reviews job.
private func unscored(_ job: ReviewsJob?, promoted: Bool = true) throws -> Wine {
    // The same wine as `scored`, so a poll that carries scores is about the same wine (same id),
    // and a complete Tier 1 identity so the scan path fires.
    var wine = try Fixture.fullWine
    wine.criticSummary = CriticSummary(ordered: [])
    wine.reviewData = nil
    wine.reviewLadder = nil
    wine.priceData = nil
    wine.promotedAt = promoted ? "2026-11-22T09:00:00.000Z" : nil
    wine.enrichmentJob = job.map { EnrichmentJobs(reviews: $0, price: nil) }
    return wine
}

/// A wine with scores (the fixture's) and the given reviews job.
private func scored(_ job: ReviewsJob?) throws -> Wine {
    var wine = try Fixture.fullWine
    wine.enrichmentJob = job.map { EnrichmentJobs(reviews: $0, price: nil) }
    return wine
}

private func priceJob(_ state: JobState) -> PriceJob {
    PriceJob(state: state, startedAt: "2026-11-22T10:00:00.000Z", updatedAt: "2026-11-22T10:00:05.000Z", identity: "x")
}

/// A saved wine with no price yet and the given price job (and no review job).
private func unpriced(_ job: PriceJob?) throws -> Wine {
    var wine = try Fixture.fullWine
    wine.priceData = nil
    wine.priceState = nil
    wine.enrichmentJob = job.map { EnrichmentJobs(reviews: nil, price: $0) }
    return wine
}

/// A wine with prices (the fixture's) and the given price job.
private func priced(_ job: PriceJob?) throws -> Wine {
    var wine = try Fixture.fullWine
    wine.enrichmentJob = job.map { EnrichmentJobs(reviews: nil, price: $0) }
    return wine
}

@MainActor
private func waitUntil(timeout: TimeInterval = 5, _ condition: @escaping () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() {
        if Date() > deadline { return XCTFail("timed out waiting") }
        try await Task.sleep(for: .milliseconds(10))
    }
}

// MARK: - Decoding

final class EnrichmentJobDecodingTests: XCTestCase {
    func testAJobDecodesFromTheServersJSON() throws {
        let json = Data("""
        {"reviews":{"state":"running","stage":"shops","started_at":"2026-11-22T10:00:00.000Z","updated_at":"2026-11-22T10:00:05.000Z",
         "shops_total":11,"shops_done":3,"scores_found":2,"identity":"k"},
         "price":{"state":"done","started_at":"a","updated_at":"b","identity":"k"}}
        """.utf8)
        let jobs = try JSONDecoder().decode(EnrichmentJobs.self, from: json)
        XCTAssertEqual(jobs.reviews?.state, .running)
        XCTAssertEqual(jobs.reviews?.shopsDone, 3)
        XCTAssertEqual(jobs.reviews?.scoresFound, 2)
        XCTAssertEqual(jobs.price?.state, .done)
        XCTAssertTrue(jobs.anyRunning)
    }

    func testAStateOrStageFromANewerBackendNeverFailsTheWholeWine() throws {
        let json = Data(#"{"reviews":{"state":"paused","stage":"cooling","started_at":"a","updated_at":"b","shops_total":1,"shops_done":0,"scores_found":0,"identity":"k"}}"#.utf8)
        let jobs = try JSONDecoder().decode(EnrichmentJobs.self, from: json)
        XCTAssertEqual(jobs.reviews?.state, .unknown)
        XCTAssertFalse(jobs.anyRunning)
    }

    func testEveryFixtureStillDecodesAndCarriesNoJob() throws {
        XCTAssertNil(try Fixture.fullWine.enrichmentJob)
        XCTAssertNil(try Fixture.decode(Wine.self, "wine-draft-nv").enrichmentJob)
    }

    func testApplyingOneKindKeepsTheOthersJob() throws {
        var mine = try Fixture.fullWine
        mine.enrichmentJob = EnrichmentJobs(reviews: reviewsJob(.running), price: PriceJob(state: .running, startedAt: "a", updatedAt: "b", identity: "k"))
        var fresh = try Fixture.fullWine
        fresh.enrichmentJob = EnrichmentJobs(reviews: reviewsJob(.done, done: 11, scores: 3), price: nil)

        let merged = mine.applying(fresh, from: .reviews)
        XCTAssertEqual(merged.enrichmentJob?.reviews?.state, .done)
        XCTAssertEqual(merged.enrichmentJob?.price?.state, .running, "a review answer must not erase what is known about the price job")

        let other = mine.applying(fresh, from: .price)
        XCTAssertEqual(other.enrichmentJob?.reviews?.state, .running, "and the other way round")
        XCTAssertNil(other.enrichmentJob?.price)
    }
}

// MARK: - What the critic block says

final class ReviewSearchCopyTests: XCTestCase {
    func testWhileRunningItSaysHowFarItHasGoneAndHowManyScoresSoFar() throws {
        let search = ReviewSearch(wine: try unscored(reviewsJob(.running, done: 7, scores: 2)), control: EnrichmentControl())
        XCTAssertTrue(search.isSearching)
        XCTAssertEqual(search.metaLine, "Checked 7 of 11 shops · 2 scores so far")
    }

    func testNoScoresYetLeavesOutThatClause() throws {
        let search = ReviewSearch(wine: try unscored(reviewsJob(.running, done: 4)), control: EnrichmentControl())
        XCTAssertEqual(search.metaLine, "Checked 4 of 11 shops")
        XCTAssertEqual(ReviewSearch(wine: try unscored(reviewsJob(.running, done: 1, scores: 1)), control: EnrichmentControl()).metaLine,
                       "Checked 1 of 11 shops · 1 score so far")
    }

    func testBeforeTheFirstCountItSaysItIsSearching() throws {
        let search = ReviewSearch(wine: try unscored(reviewsJob(.running, total: 0)), control: EnrichmentControl())
        XCTAssertEqual(search.metaLine, "Searching shops…")
    }

    func testOnceDoneItSaysHowManyShopsWereChecked() throws {
        let search = ReviewSearch(wine: try scored(reviewsJob(.done, done: 11, total: 11, scores: 3)), control: EnrichmentControl())
        XCTAssertFalse(search.isSearching)
        XCTAssertEqual(search.metaLine, "Checked 11 shops")
    }

    func testNothingFoundSaysHowHardItLooked() throws {
        let search = ReviewSearch(wine: try unscored(reviewsJob(.done, done: 11)), control: EnrichmentControl())
        XCTAssertEqual(search.noneLine, "No critic scores found at 11 shops.")
        XCTAssertEqual(ReviewSearch(wine: try unscored(nil), control: EnrichmentControl()).noneLine, "No critic scores found.")
    }

    func testTheCountNeverReadsAsMoreThanTheTotal() throws {
        let search = ReviewSearch(wine: try unscored(reviewsJob(.running, done: 12)), control: EnrichmentControl())
        XCTAssertEqual(search.metaLine, "Checked 11 of 11 shops")
    }

    func testAnAppRequestInFlightCountsAsSearchingBeforeTheServerHasSaidSo() throws {
        let search = ReviewSearch(wine: try unscored(nil), control: EnrichmentControl(isBusy: true))
        XCTAssertTrue(search.isSearching)
    }

    func testAStoppedSearchIsNotSearching() throws {
        let search = ReviewSearch(wine: try unscored(reviewsJob(.interrupted, done: 3)), control: EnrichmentControl())
        XCTAssertFalse(search.isSearching)
        XCTAssertTrue(search.isInterrupted)
    }
}

final class CriticStateWithJobsTests: XCTestCase {
    func testAScoreFoundMidSearchStaysFoundWhileTheSearchRunsOn() throws {
        let wine = try scored(reviewsJob(.running, done: 3, scores: 1))
        XCTAssertEqual(CriticReviewsState.of(wine: wine, control: EnrichmentControl()), .found)
        XCTAssertTrue(ReviewSearch(wine: wine, control: EnrichmentControl()).isSearching, "the skeleton stays up under the scores")
    }

    func testARunningSearchWithNothingYetIsLookingEvenOnAWineThatHasStoredReviews() throws {
        var wine = try unscored(reviewsJob(.running))
        wine.reviewData = []
        XCTAssertEqual(CriticReviewsState.of(wine: wine, control: EnrichmentControl()), .looking, "never \"No critic scores found\" while working")
    }

    func testASavedWineMidSearchNeverReadsAsNeverLookedUp() throws {
        // Phase 14 F4: this used to be .idle, "Critic scores haven't been looked up yet".
        XCTAssertEqual(CriticReviewsState.of(wine: try unscored(reviewsJob(.running)), control: EnrichmentControl()), .looking)
    }

    func testFinishedWithNothingIsNone_FailedAndInterruptedAreFailed() throws {
        var finished = try unscored(reviewsJob(.done, done: 11))
        finished.reviewData = []
        XCTAssertEqual(CriticReviewsState.of(wine: finished, control: EnrichmentControl()), .none)
        XCTAssertEqual(CriticReviewsState.of(wine: try unscored(reviewsJob(.failed)), control: EnrichmentControl()), .failed)
        XCTAssertEqual(CriticReviewsState.of(wine: try unscored(reviewsJob(.interrupted)), control: EnrichmentControl()), .failed)
    }
}

// MARK: - The list row

final class SearchingBadgeTests: XCTestCase {
    func testARowWithARunningSearchShowsTheIndicator() throws {
        let running = WineRowView(wine: try scored(reviewsJob(.running)), kind: .discovered)
        XCTAssertTrue(running.badges.contains(.searching))
        let done = WineRowView(wine: try scored(reviewsJob(.done, done: 11)), kind: .discovered)
        XCTAssertFalse(done.badges.contains(.searching))
        XCTAssertFalse(WineRowView(wine: try scored(nil), kind: .discovered).badges.contains(.searching))
    }

    func testARunningPriceJobAloneAlsoShowsIt() throws {
        var wine = try scored(nil)
        wine.enrichmentJob = EnrichmentJobs(reviews: nil, price: PriceJob(state: .running, startedAt: "a", updatedAt: "b", identity: "k"))
        XCTAssertTrue(WineRowView(wine: wine, kind: .cellar).badges.contains(.searching))
    }

    func testAStoppedSearchShowsNoIndicator() throws {
        XCTAssertFalse(WineRowView(wine: try scored(reviewsJob(.interrupted)), kind: .discovered).badges.contains(.searching))
    }
}

// MARK: - The watcher

@MainActor
final class EnrichmentWatcherTests: XCTestCase {
    private func make(_ states: [JobState?], grace: Duration = .seconds(5), cap: Duration = .seconds(5),
                      reads: @escaping () -> Void = {}) throws -> (EnrichmentWatcher, () -> [Wine]) {
        var index = 0
        var seen: [Wine] = []
        let base = try unscored(nil)
        let watcher = EnrichmentWatcher(interval: .milliseconds(10), startGrace: grace, maxDuration: cap) { _ in
            reads()
            let state = states[min(index, states.count - 1)]
            index += 1
            var wine = base
            wine.enrichmentJob = state.map { EnrichmentJobs(reviews: reviewsJob($0), price: nil) }
            return wine
        }
        watcher.onWine = { seen.append($0) }
        return (watcher, { seen })
    }

    func testItFollowsTheSearchUntilItHasEnded() async throws {
        let (watcher, seen) = try make([.running, .running, .done, .done])
        watcher.start(wineID: "w")
        XCTAssertTrue(watcher.isWatching)
        try await waitUntil { !watcher.isWatching }
        XCTAssertEqual(seen().count, 3, "two running reads and the one that saw it end")
        XCTAssertEqual(seen().last?.enrichmentJob?.reviews?.state, .done)
    }

    func testItStopsOnAStoppedOrFailedSearchToo() async throws {
        for ended in [JobState.interrupted, .failed] {
            let (watcher, _) = try make([.running, ended])
            watcher.start(wineID: "w")
            try await waitUntil { !watcher.isWatching }
        }
    }

    func testAnOldDoneIsNotTheEndOfASearchThatHasNotStartedYet() async throws {
        // The wine still carries the previous run's "done"; the new run's "running" lands a moment later.
        let (watcher, seen) = try make([.done, .done, .running, .done])
        watcher.start(wineID: "w")
        try await waitUntil { !watcher.isWatching }
        XCTAssertEqual(seen().count, 4)
    }

    func testItGivesUpWhenNothingEverRuns() async throws {
        let (watcher, seen) = try make([.done], grace: .milliseconds(60))
        watcher.start(wineID: "w")
        try await waitUntil { !watcher.isWatching }
        XCTAssertGreaterThanOrEqual(seen().count, 1)
    }

    func testItStopsAtTheCapEvenIfTheSearchNeverEnds() async throws {
        let (watcher, _) = try make([.running], cap: .milliseconds(80))
        watcher.start(wineID: "w")
        try await waitUntil { !watcher.isWatching }
    }

    func testAFailedReadIsNotTheEndOfTheSearch() async throws {
        var calls = 0
        let base = try unscored(reviewsJob(.running))
        var done = base
        done.enrichmentJob = EnrichmentJobs(reviews: reviewsJob(.done, done: 11), price: nil)
        let watcher = EnrichmentWatcher(interval: .milliseconds(10), startGrace: .seconds(5), maxDuration: .seconds(5)) { _ in
            calls += 1
            if calls == 1 { return base }
            return calls < 4 ? nil : done
        }
        watcher.start(wineID: "w")
        try await waitUntil { !watcher.isWatching }
        XCTAssertGreaterThanOrEqual(calls, 4)
    }

    func testStopCancelsItAndItCanStartAgain() async throws {
        var reads = 0
        let (watcher, _) = try make([.running], reads: { reads += 1 })
        watcher.start(wineID: "w")
        try await waitUntil { reads >= 2 }
        watcher.stop()
        XCTAssertFalse(watcher.isWatching)
        let frozen = reads
        try await Task.sleep(for: .milliseconds(60))
        XCTAssertLessThanOrEqual(reads, frozen + 1, "no more reads after stop")
        watcher.start(wineID: "w")
        XCTAssertTrue(watcher.isWatching)
        watcher.stop()
    }

    func testStartingTwiceFollowsOnlyOnce() async throws {
        var reads = 0
        let (watcher, _) = try make([.running, .done], reads: { reads += 1 })
        watcher.start(wineID: "w")
        watcher.start(wineID: "w")
        try await waitUntil { !watcher.isWatching }
        XCTAssertEqual(reads, 2)
    }
}

// MARK: - The scan flow

@MainActor
final class ScanSearchTests: XCTestCase {
    private let draftID = "draft-p14"
    private var postStatus = 200
    private var postBody = Data()
    private var priceStatus = 200
    private var priceBody: Data?
    /// What each GET of the wine answers, in turn; the last repeats.
    private var gets: [Data] = []
    private var getCount = 0
    private var drafts = Data()

    private func json(_ wine: Wine) throws -> Data {
        var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(wine)) as! [String: Any]
        object["id"] = draftID
        return try JSONSerialization.data(withJSONObject: object)
    }

    override func setUp() async throws {
        StubURLProtocol.requests = []
        PriceOnce.reset()
        getCount = 0
        postStatus = 200
        priceStatus = 200
        priceBody = nil
        drafts = try json(try unscored(nil, promoted: false))
        postBody = drafts
        gets = [drafts]
        let scan = Data(#"{"producer":"Sesta di Sopra","vintage":2018,"region":"Tuscany","denomination":"Brunello di Montalcino","quality_classification":null,"vineyard":null,"cuvee":null,"grape_varieties":null,"wine_color":"red","missing_tier1_fields":[],"raw_response":""}"#.utf8)
        StubURLProtocol.router = { [unowned self] request in
            let path = request.url!.path
            switch (request.httpMethod ?? "GET", path) {
            case ("POST", "/api/label-scan"): return (200, scan)
            case ("POST", "/api/wines/duplicate-check"): return (200, Data(#"{"kind":"none"}"#.utf8))
            case ("POST", "/api/wines"): return (201, self.drafts)
            case ("POST", let p) where p.hasSuffix("/fetch-reviews"):
                return self.postStatus == 200 ? (200, self.postBody) : (self.postStatus, Data(#"{"error":"connection lost"}"#.utf8))
            case ("POST", let p) where p.hasSuffix("/fetch-price"):
                return self.priceStatus == 200 ? (200, self.priceBody ?? self.drafts) : (self.priceStatus, Data(#"{"error":"connection lost"}"#.utf8))
            case ("GET", "/api/wines/\(self.draftID)"):
                return (200, self.nextGet())
            default: return (404, Data(#"{"error":"unrouted \(path)"}"#.utf8))
            }
        }
    }

    override func tearDown() { StubURLProtocol.router = nil }

    /// The next scripted answer to a GET of the wine; the last repeats.
    private func nextGet() -> Data {
        let body = gets.isEmpty ? drafts : gets[min(getCount, gets.count - 1)]
        getCount += 1
        return body
    }

    private func scan(_ model: ScanFlowModel) {
        model.scan(UIGraphicsImageRenderer(size: CGSize(width: 40, height: 60)).image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 40, height: 60))
        })
    }

    private func model(hold: Duration = .seconds(30)) -> ScanFlowModel {
        let m = ScanFlowModel(api: StubURLProtocol.api(), previewHold: hold, pollInterval: .milliseconds(15), watchGrace: .seconds(5))
        // A watcher outlives its test and would poll the next test's stub.
        addTeardownBlock { @MainActor in m.stopWatching() }
        return m
    }

    private var reviewPosts: [URLRequest] {
        StubURLProtocol.requests.filter { $0.httpMethod == "POST" && $0.url?.path.hasSuffix("/fetch-reviews") == true }
    }

    func testTheScanSearchesEverythingAndNeverAsksForATier() async throws {
        postBody = try json(try scored(reviewsJob(.done, done: 11, scores: 3)))
        let m = model()
        scan(m)
        try await waitUntil { m.step == .review }
        XCTAssertEqual(reviewPosts.count, 1)
        XCTAssertNil(reviewPosts[0].url?.query, "no ?tier=primary: the full search, with nothing click-gated")
    }

    func testTheInterstitialIsEndedByTheFirstScoreEvenIfTheRequestIsStillOpen() async throws {
        // The POST never returns scores in time; a poll does.
        postStatus = 500
        gets = [try json(try unscored(reviewsJob(.running, done: 2))), try json(try scored(reviewsJob(.running, done: 3, scores: 1)))]
        let m = model()
        scan(m)
        try await waitUntil { m.step == .review }
        XCTAssertEqual(m.wine?.criticSummary?.ordered.isEmpty, false)
    }

    func testADroppedRequestIsNotAnErrorWhileTheServerIsStillSearching() async throws {
        postStatus = 500
        gets = [try json(try unscored(reviewsJob(.running, done: 2))),
                try json(try unscored(reviewsJob(.running, done: 5))),
                try json(try scored(reviewsJob(.done, done: 11, scores: 2)))]
        let m = model(hold: .milliseconds(50))
        scan(m)
        try await waitUntil { m.step == .review }
        try await waitUntil { m.wine?.enrichmentJob?.reviews?.state == .done }
        XCTAssertNil(m.reviews.error, "the request failed; the search did not (Phase 14 F6)")
        XCTAssertFalse(m.reviews.isBusy)
        XCTAssertEqual(reviewPosts.count, 1, "and nothing was started a second time")
        XCTAssertEqual(m.wine?.criticSummary?.ordered.isEmpty, false)
    }

    func testAFailureThatLeavesNoSearchRunningIsShownAsOne() async throws {
        postStatus = 500
        gets = [try json(try unscored(nil))]
        let m = model(hold: .milliseconds(30))
        scan(m)
        try await waitUntil { m.reviews.error != nil }
        XCTAssertEqual(m.reviews.error, "Couldn't check reviews")
    }

    func testASearchTheServerStoppedIsResumedOnceAndOnlyOnce() async throws {
        postStatus = 500
        gets = [try json(try unscored(reviewsJob(.interrupted, done: 3)))]
        let m = model(hold: .milliseconds(30))
        scan(m)
        try await waitUntil { m.reviews.error != nil }
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(reviewPosts.count, 2, "the original request and exactly one resume")
        XCTAssertEqual(m.reviews.error, "Couldn't check reviews", "after that one resume, a failure reads as one")
    }

    func testNothingElseStartsASearch_RetryAfterAFailureDoes() async throws {
        postStatus = 500
        gets = [try json(try unscored(nil))]
        let m = model(hold: .milliseconds(30))
        scan(m)
        try await waitUntil { m.reviews.error != nil }
        XCTAssertEqual(reviewPosts.count, 1)
        postStatus = 200
        postBody = try json(try scored(reviewsJob(.done, done: 11, scores: 1)))
        m.retryReviews()
        try await waitUntil { m.reviews.error == nil && !m.reviews.isBusy }
        XCTAssertEqual(reviewPosts.count, 2)
        XCTAssertNil(reviewPosts[1].url?.query)
    }

    func testTheListsAreToldWhenTheSearchEnds() async throws {
        postStatus = 500
        gets = [try json(try unscored(reviewsJob(.running, done: 2))), try json(try scored(reviewsJob(.done, done: 11, scores: 2)))]
        let m = model(hold: .milliseconds(30))
        var landed = 0
        m.onEnrichmentLanded = { landed += 1 }
        scan(m)
        try await waitUntil { m.wine?.enrichmentJob?.reviews?.state == .done }
        try await waitUntil { landed >= 1 }
    }

    // MARK: Price (WI-5)

    private var pricePosts: [URLRequest] {
        StubURLProtocol.requests.filter { $0.httpMethod == "POST" && $0.url?.path.hasSuffix("/fetch-price") == true }
    }

    func testALockedPhoneDropsBothRequestsAndNeitherLookupIsAnError() async throws {
        postStatus = 500
        priceStatus = 500
        var running = try unscored(reviewsJob(.running, done: 3), promoted: false)
        running.enrichmentJob?.price = priceJob(.running)
        var finished = try scored(reviewsJob(.done, done: 11, scores: 2))
        finished.promotedAt = nil
        finished.enrichmentJob?.price = priceJob(.done)
        gets = [try json(running), try json(running), try json(finished)]
        let m = model(hold: .milliseconds(30))
        scan(m)
        try await waitUntil { m.wine?.enrichmentJob?.price?.state == .done && m.wine?.enrichmentJob?.reviews?.state == .done }
        XCTAssertNil(m.reviews.error)
        XCTAssertNil(m.price.error, "the requests were cut off; the lookups were not")
        XCTAssertFalse(m.price.isBusy)
        XCTAssertNotNil(m.wine?.priceData, "the price the server finished is on screen")
        XCTAssertEqual(pricePosts.count, 1, "and nothing was started a second time")
    }

    func testAPriceFailureWithNoLookupRunningIsShownAsOne() async throws {
        priceStatus = 500
        gets = [try json(try unscored(nil, promoted: false))]
        let m = model(hold: .milliseconds(30))
        scan(m)
        try await waitUntil { m.price.error != nil }
        XCTAssertEqual(m.price.error, "Price lookup failed")
    }

    func testAPriceLookupAnotherScreenIsStillRunningKeepsTheSkeleton() async throws {
        // The reviews answer arrives, naming a price job that is still going: keep following it.
        var running = try unscored(reviewsJob(.done, done: 11), promoted: false)
        running.enrichmentJob?.price = priceJob(.running)
        postBody = try json(running)
        priceStatus = 500
        var finished = try unpriced(priceJob(.done))
        finished.priceData = try Fixture.fullWine.priceData
        finished.promotedAt = nil
        gets = [try json(running), try json(finished)]
        let m = model(hold: .milliseconds(30))
        scan(m)
        try await waitUntil { m.wine?.enrichmentJob?.price?.state == .done }
        XCTAssertNil(m.price.error)
        XCTAssertNotNil(m.wine?.priceData)
    }
}

// MARK: - The detail screen

@MainActor
final class DetailSearchTests: XCTestCase {
    private var gets: [Data] = []
    private var getCount = 0
    private var changed = 0

    private func data(_ wine: Wine) throws -> Data { try JSONEncoder().encode(wine) }

    override func setUp() async throws {
        StubURLProtocol.requests = []
        getCount = 0
        changed = 0
        StubURLProtocol.router = { [unowned self] request in
            if request.httpMethod == "GET" { return (200, self.nextGet()) }
            return (200, self.gets.last ?? Data())
        }
    }

    private func nextGet() -> Data {
        let body = gets.isEmpty ? Data() : gets[min(getCount, gets.count - 1)]
        getCount += 1
        return body
    }

    override func tearDown() { StubURLProtocol.router = nil }

    private func model(_ wine: Wine) -> WineDetailModel {
        let m = WineDetailModel(wine: wine, api: StubURLProtocol.api(), onChanged: { [unowned self] in changed += 1 },
                                pollInterval: .milliseconds(15), watchGrace: .seconds(5))
        addTeardownBlock { @MainActor in m.stopWatching() }
        return m
    }

    private var reviewPosts: Int {
        StubURLProtocol.requests.filter { $0.httpMethod == "POST" && $0.url?.path.hasSuffix("/fetch-reviews") == true }.count
    }

    func testAWineSavedMidSearchShowsTheSearchAndThenItsScores() async throws {
        let running = try unscored(reviewsJob(.running, done: 4))
        gets = [try data(try scored(reviewsJob(.running, done: 8, scores: 2))), try data(try scored(reviewsJob(.done, done: 11, scores: 3)))]
        let m = model(running)

        XCTAssertTrue(m.isSearchingReviews, "opened while the scan's search is still going: running, never \"Not fetched\"")
        XCTAssertEqual(CriticReviewsState.of(wine: m.wine, control: m.reviews), .looking)

        m.watchSearches()
        try await waitUntil { m.wine.enrichmentJob?.reviews?.state == .done }
        XCTAssertFalse(m.isSearchingReviews)
        XCTAssertEqual(m.wine.criticSummary?.ordered.isEmpty, false)
        XCTAssertEqual(changed, 1, "the lists are told once, when it ends — not on every poll")
        XCTAssertEqual(reviewPosts, 0, "watching starts nothing")
    }

    func testATapDuringARunningSearchStartsNothing() async throws {
        let m = model(try unscored(reviewsJob(.running, done: 4)))
        await m.fetchReviews()
        await m.fetchReviews(force: true)
        XCTAssertEqual(reviewPosts, 0, "Phase 14 F5: no second search on the same wine")
    }

    func testOnceTheSearchHasEndedARefreshWorksAgain() async throws {
        let finished = try scored(reviewsJob(.done, done: 11, scores: 3))
        gets = [try data(finished)]
        let m = model(finished)
        await m.fetchReviews(force: true)
        XCTAssertEqual(reviewPosts, 1)
    }

    func testAWineWithNoSearchRunningStartsNoWatcher() async throws {
        gets = [try data(try scored(reviewsJob(.done, done: 11)))]
        let m = model(try scored(reviewsJob(.done, done: 11)))
        m.watchSearches()
        try await Task.sleep(for: .milliseconds(80))
        XCTAssertEqual(getCount, 0, "nothing running, nothing read")
    }

    func testARequestThatDropsWhileTheSearchRunsIsNotAnError() async throws {
        StubURLProtocol.router = { [unowned self] request in
            if request.httpMethod == "POST" { return (500, Data(#"{"error":"lost"}"#.utf8)) }
            return (200, self.nextGet())
        }
        gets = [try data(try unscored(reviewsJob(.running, done: 6))), try data(try scored(reviewsJob(.done, done: 11, scores: 1)))]
        let m = model(try unscored(nil))
        await m.fetchReviews()
        XCTAssertNil(m.reviews.error, "the search is still running on the server")
        try await waitUntil { m.wine.enrichmentJob?.reviews?.state == .done }
    }
}

// MARK: - Price (WI-5)

final class PriceSearchCopyTests: XCTestCase {
    func testARunningJobOrAnOutstandingRequestIsSearching() throws {
        XCTAssertTrue(PriceSearch(wine: try unpriced(priceJob(.running)), control: EnrichmentControl()).isSearching)
        XCTAssertTrue(PriceSearch(wine: try unpriced(nil), control: EnrichmentControl(isBusy: true)).isSearching)
        XCTAssertFalse(PriceSearch(wine: try priced(priceJob(.done)), control: EnrichmentControl()).isSearching)
        XCTAssertFalse(PriceSearch(wine: try unpriced(nil), control: EnrichmentControl()).isSearching)
    }

    func testAFailedOrStoppedLookupIsShownAsFailedUnlessItIsRunning() throws {
        XCTAssertTrue(PriceSearch(wine: try unpriced(priceJob(.failed)), control: EnrichmentControl()).hasFailed)
        XCTAssertTrue(PriceSearch(wine: try unpriced(priceJob(.interrupted)), control: EnrichmentControl()).hasFailed)
        var failedControl = EnrichmentControl(); failedControl.error = "Price lookup failed"
        XCTAssertTrue(PriceSearch(wine: try unpriced(nil), control: failedControl).hasFailed)
        // An error from the last tap does not outrank a lookup that is running now.
        XCTAssertFalse(PriceSearch(wine: try unpriced(priceJob(.running)), control: failedControl).hasFailed)
    }
}

@MainActor
final class DetailPriceSearchTests: XCTestCase {
    private var gets: [Data] = []
    private var getCount = 0
    private var changed = 0

    override func setUp() async throws {
        StubURLProtocol.requests = []
        getCount = 0
        changed = 0
        StubURLProtocol.router = { [unowned self] request in
            if request.httpMethod == "GET" {
                let body = self.gets.isEmpty ? Data() : self.gets[min(self.getCount, self.gets.count - 1)]
                self.getCount += 1
                return (200, body)
            }
            return (500, Data(#"{"error":"lost"}"#.utf8))
        }
    }

    override func tearDown() { StubURLProtocol.router = nil }

    private func model(_ wine: Wine) -> WineDetailModel {
        let m = WineDetailModel(wine: wine, api: StubURLProtocol.api(), onChanged: { [unowned self] in changed += 1 },
                                pollInterval: .milliseconds(15), watchGrace: .seconds(5))
        addTeardownBlock { @MainActor in m.stopWatching() }
        return m
    }

    private var pricePosts: Int {
        StubURLProtocol.requests.filter { $0.httpMethod == "POST" && $0.url?.path.hasSuffix("/fetch-price") == true }.count
    }

    func testAWineSavedWhileItsPriceIsBeingCheckedShowsThatAndThenThePrices() async throws {
        let m = model(try unpriced(priceJob(.running)))
        XCTAssertTrue(m.isSearchingPrice, "Checking prices…, not \"No price data yet\"")
        XCTAssertTrue(PriceSearch(wine: m.wine, control: m.price).isSearching)

        gets = [try JSONEncoder().encode(try priced(priceJob(.done)))]
        m.watchSearches()
        try await waitUntil { m.wine.enrichmentJob?.price?.state == .done }
        XCTAssertFalse(m.isSearchingPrice)
        XCTAssertNotNil(m.wine.priceData)
        XCTAssertEqual(changed, 1, "the lists are told once, when the lookup ends")
        XCTAssertEqual(pricePosts, 0, "watching starts nothing")
    }

    func testATapDuringARunningPriceLookupStartsNothing() async throws {
        let m = model(try unpriced(priceJob(.running)))
        await m.fetchPrice()
        await m.fetchPrice(force: true)
        XCTAssertEqual(pricePosts, 0)
    }

    func testThePriceOnceOnOpenDoesNotStartASecondLookup() async throws {
        PriceOnce.reset()
        let m = model(try unpriced(priceJob(.running)))
        await m.fetchPriceOnceIfNeeded()
        XCTAssertEqual(pricePosts, 0, "the scan's lookup is still going: no second one")
    }

    func testARequestThatDropsWhileThePriceIsBeingCheckedIsNotAnError() async throws {
        gets = [try JSONEncoder().encode(try unpriced(priceJob(.running))), try JSONEncoder().encode(try priced(priceJob(.done)))]
        let m = model(try unpriced(nil))
        await m.fetchPrice()
        XCTAssertNil(m.price.error, "the lookup is still running on the server")
        try await waitUntil { m.wine.enrichmentJob?.price?.state == .done }
        XCTAssertNotNil(m.wine.priceData)
    }

    func testAPriceLookupThatNeverRanIsShownAsFailed() async throws {
        gets = [try JSONEncoder().encode(try unpriced(nil))]
        let m = model(try unpriced(nil))
        await m.fetchPrice()
        XCTAssertEqual(m.price.error, "Price lookup failed")
    }
}
