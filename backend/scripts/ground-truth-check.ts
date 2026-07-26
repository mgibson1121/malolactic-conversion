/**
 * Diagnostic: renders a list of real product page URLs with Puppeteer and
 * checks whether the resulting HTML actually contains visible critic-score
 * text, independent of GPT-4o's interpretation — useful when a wine's
 * review_data comes back empty and it's unclear whether Step 1 (product
 * page discovery), rendering, or Step 2 extraction is at fault. Saves each
 * rendered page under __fixtures__/ for reuse as a regression fixture.
 *
 * Edit the URLs below to whatever product page you're investigating, then:
 * npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/scripts/ground-truth-check.ts
 */
import fs from 'fs'
import path from 'path'
import { renderPageHtml } from '../modules/reviews/puppeteer-extract'

const URLS = [
  'https://shop.klwines.com/products/details/1592587', // Clos des Papes CDP 2020, K&L
  'https://www.zachys.com/products/chateauneuf-du-pape-clos-des-papes-2020-750ml',
  'https://www.benchmarkwine.com/products/139881-clos-des-papes-chateauneuf-du-pape-2020',
]

const SIGNALS = ['advocate', 'vinous', 'spectator', 'suckling', 'decanter', 'enthusiast', 'parker', 'jeb dunnuck', 'jancis', '/100', 'pts']

async function main() {
  for (const url of URLS) {
    console.log(`\n→ ${url}`)
    const html = await renderPageHtml(url)
    if (!html) {
      console.log('   render failed (null)')
      continue
    }
    console.log(`   rendered ${html.length} chars`)
    const lower = html.toLowerCase()
    const found = SIGNALS.filter(s => lower.includes(s))
    console.log(`   signal words present: ${found.length ? found.join(', ') : '(none)'}`)

    const file = path.resolve(__dirname, `../modules/reviews/__fixtures__/adhoc-${url.replace(/[^a-z0-9]/gi, '_').slice(0, 60)}.html`)
    fs.writeFileSync(file, html)
    console.log(`   saved to ${file}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
