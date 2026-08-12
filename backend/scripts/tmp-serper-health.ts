import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(__dirname, '../../.env') })

async function main() {
  for (const ep of ['shopping', 'search']) {
    const res = await fetch(`https://google.serper.dev/${ep}`, {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'Chateau Mangot Saint-Emilion wine', gl: 'us' }),
    })
    const text = await res.text()
    let count = 'n/a'
    try {
      const j = JSON.parse(text)
      count = String((j.shopping ?? j.organic ?? []).length)
    } catch { /* not json */ }
    console.log(`${ep}: HTTP ${res.status} — results=${count}`)
    if (!res.ok || count === '0') console.log(`   body: ${text.slice(0, 300)}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
