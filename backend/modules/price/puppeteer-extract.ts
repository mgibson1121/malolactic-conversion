const PAGE_TIMEOUT_MS = 15_000
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

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
    await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT_MS })
    return await page.content()
  } catch {
    return null
  } finally {
    if (browser) await browser.close()
  }
}
