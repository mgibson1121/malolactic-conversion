/**
 * Phase 12.2 WI-7 spike: does a producer's own technical sheet turn up, and
 * does it name the bottling? ONE Serper organic query per wine (6 wines = 6
 * credits), printed raw. Search only: no sheet is downloaded or parsed here, so
 * no file leaves a third party's server. Results are the titles, URLs and
 * snippets Serper returns, and the script says only what those show.
 *
 *   npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/scripts/producer-sheet-spike.ts
 *
 * Reads SERPER_API_KEY from the environment (.env via dotenv); never prints it.
 */
import path from 'path'
import { config } from 'dotenv'
import { serperFetch } from '@shared/utils/serper-client'

config({ path: path.resolve(__dirname, '../../.env') })

const WINES = [
  { label: 'Vietti Barolo 2021', q: 'Vietti Barolo 2021 scheda tecnica OR "tech sheet" OR "fiche technique" pdf' },
  { label: 'Domaine de Marcoux Châteauneuf-du-Pape 2019', q: 'Domaine de Marcoux Châteauneuf-du-Pape 2019 "fiche technique" OR "tech sheet" pdf' },
  { label: 'Domaine du Pavillon Pommard 1er Cru Les Rugiens 2019', q: 'Domaine du Pavillon Pommard 1er Cru Les Rugiens 2019 "fiche technique" OR "tech sheet" pdf' },
  { label: 'Vincent Girardin Chassagne-Montrachet 1er Cru Les Cailleret 2017', q: 'Vincent Girardin Chassagne-Montrachet 1er Cru Cailleret 2017 "fiche technique" OR "tech sheet" pdf' },
  { label: "Podere Le Ripi Brunello di Montalcino Cielo d'Ulisse 2020", q: "Podere Le Ripi Brunello di Montalcino Cielo d'Ulisse 2020 scheda tecnica OR \"tech sheet\" pdf" },
  { label: 'Covalli Amarone della Valpolicella 2018', q: 'Covalli Amarone della Valpolicella 2018 scheda tecnica OR "tech sheet" pdf' },
]

async function main() {
  const key = process.env.SERPER_API_KEY
  if (!key) throw new Error('SERPER_API_KEY is not set')
  let calls = 0
  for (const w of WINES) {
    calls += 1
    const res = await serperFetch('search', { q: w.q, gl: 'us', num: 8 }, key, 'spike:producer-sheet')
    const json = (await res.json()) as { organic?: Array<{ title: string; link: string; snippet?: string }> }
    console.log(`\n## ${w.label}\nquery: ${w.q}`)
    for (const r of json.organic ?? []) {
      const pdf = /\.pdf(\?|#|$)/i.test(r.link) ? 'PDF ' : '    '
      console.log(`  ${pdf}${r.title}\n      ${r.link}\n      ${(r.snippet ?? '').slice(0, 220)}`)
    }
    if (!json.organic?.length) console.log('  (no results)')
  }
  console.log(`\nSerper queries sent: ${calls}`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
