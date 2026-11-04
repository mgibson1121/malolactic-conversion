import { CHROMIUM_ARGS, withSharedBrowser } from '@shared/utils/render-gate'

const PAGE_TIMEOUT_MS = 15_000
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function launchChromium() {
  // Dynamic import so the module can be mocked in tests without Puppeteer running
  const puppeteer = await import('puppeteer')
  return puppeteer.default.launch({ headless: true, args: CHROMIUM_ARGS })
}

/**
 * Renders in a fresh browser context of the shared Chromium
 * (shared/utils/render-gate.ts), once a render slot is free. Any failure,
 * including a failed launch, is null, as before.
 */
export async function renderPageHtml(url: string): Promise<string | null> {
  try {
    return await withSharedBrowser(launchChromium, async (browser) => {
      const context = await browser.createBrowserContext()
      try {
        const page = await context.newPage()
        await page.setUserAgent(USER_AGENT)
        // 'networkidle2' reliably times out on retail sites running persistent
        // analytics/chat connections (GTM, Intercom, etc.) — the network never
        // truly goes idle, so the full PAGE_TIMEOUT_MS gets burned waiting for a
        // condition that never fires. 'domcontentloaded' reflects real page-load
        // time instead and is the standard fix for this class of site.
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })
        return await page.content()
      } finally {
        await context.close().catch(() => {})
      }
    })
  } catch {
    return null
  }
}
