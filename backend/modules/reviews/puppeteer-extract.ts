const PAGE_TIMEOUT_MS = 15_000
// Fixed settle delay after domcontentloaded, added Phase 8 (2026-07-29) after
// live testing on a real product page (amsterwine.com) showed a client-side
// data-fetch race: the same domcontentloaded render intermittently included
// or omitted a description paragraph depending on whether that fetch had
// resolved yet — confirmed by re-running the identical render 7 times in a
// row and observing both outcomes. A short fixed wait (not a network-idle
// wait, see below) reliably caught the content in testing.
const POST_LOAD_SETTLE_MS = 1_500
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Renders the single product page found by find-product-page.ts — never a
 * search-results page (that's pricing's job, see modules/price/). Same
 * conventions as modules/price/puppeteer-extract.ts (duplicated locally per
 * CLAUDE.md §5, modules don't import from each other): 'domcontentloaded'
 * rather than 'networkidle2', since retail sites running persistent
 * analytics/chat connections never truly go network-idle — a fixed
 * POST_LOAD_SETTLE_MS wait after domcontentloaded hedges the client-side
 * rendering race (see above) without risking a hang on those persistent
 * connections. This is a partial mitigation for the same class of issue
 * tracked in build-phases.md's "Puppeteer domcontentloaded fidelity gap"
 * open question (found 2026-07-26 against price/verify-listing.ts, a
 * differently-shaped count-based check) — that note's underlying fix
 * (waiting for a specific DOM signal to stabilize, rather than a fixed
 * delay) still hasn't been applied there.
 */
export async function renderPageHtml(url: string): Promise<string | null> {
  let browser
  try {
    // Dynamic import so the module can be mocked in tests without Puppeteer running
    const puppeteer = await import('puppeteer')
    browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage()
    await page.setUserAgent(USER_AGENT)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })
    await new Promise((resolve) => setTimeout(resolve, POST_LOAD_SETTLE_MS))
    return await page.content()
  } catch {
    return null
  } finally {
    if (browser) await browser.close()
  }
}
