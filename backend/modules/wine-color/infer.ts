import type OpenAI from 'openai'
import type { WineColor } from '@shared/types'

/**
 * Wine colour for imported wines (Phase 12.4 WI-6, developer decision
 * 2026-10-31). Amends Phase 10.5, where `wine_color` came from label-scan
 * vision only: a wine that arrived by sheet or CSV import has no label, so
 * its colour is inferred here from what the row already says — producer,
 * appellation, cuvée, vineyard, region, grapes — and allowed to be null when
 * those leave it open. The scan path is unchanged.
 *
 * Text only, batched: one GPT-4o call per BATCH_SIZE wines (about 2 calls for
 * the 33 colourless wines in the 2026-10-31 cellar), no Serper.
 */
export const BATCH_SIZE = 20

export interface ColourCandidate {
  id: string
  producer: string | null
  denomination: string | null
  cuvee: string | null
  vineyard: string | null
  quality_classification: string | null
  region: string | null
  grape_varieties: string[] | null
}

export interface ColourProposal {
  id: string
  wine_color: WineColor | null
  /** One short clause: why, or why it is left open. */
  reason: string
}

const SYSTEM = [
  'You decide the colour of wines from their identity. For each wine return "red", "white", "rosé", or null.',
  'Give a colour only when the identity settles it: an appellation that permits one colour (Chablis → white, Barolo → red),',
  'a grape that settles it (Chardonnay → white), or a cuvée or vineyard name that states it (Blanc, Rosé).',
  'Return null when the appellation permits more than one colour and nothing else in the identity decides which',
  '(e.g. Châteauneuf-du-Pape with no stated grape or colour), or when the producer or appellation is not one you know.',
  'Do not guess from what is most common. Sparkling wines take the colour of the wine (Champagne without "Rosé" → white).',
  'Reply with JSON only: {"wines":[{"id":"…","wine_color":"red"|"white"|"rosé"|null,"reason":"one short clause"}]}',
].join(' ')

const COLOURS: ReadonlySet<string> = new Set(['red', 'white', 'rosé'])

function describe(w: ColourCandidate): Record<string, unknown> {
  return {
    id: w.id,
    producer: w.producer,
    appellation: w.denomination,
    cuvee: w.cuvee,
    vineyard: w.vineyard,
    classification: w.quality_classification,
    region: w.region,
    grapes: w.grape_varieties,
  }
}

/** Parses one batch's reply. Anything not a known colour is null; a wine the reply skipped is null, with that said. */
export function parseColourReply(raw: string, batch: ColourCandidate[]): ColourProposal[] {
  let rows: Array<{ id?: unknown; wine_color?: unknown; reason?: unknown }> = []
  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim())
    rows = Array.isArray(parsed?.wines) ? parsed.wines : []
  } catch {
    rows = []
  }
  return batch.map(w => {
    const row = rows.find(r => r.id === w.id)
    if (!row) return { id: w.id, wine_color: null, reason: 'no answer for this wine' }
    const colour = typeof row.wine_color === 'string' && COLOURS.has(row.wine_color) ? (row.wine_color as WineColor) : null
    return { id: w.id, wine_color: colour, reason: typeof row.reason === 'string' ? row.reason : '' }
  })
}

export async function inferWineColors(wines: ColourCandidate[], client: OpenAI): Promise<ColourProposal[]> {
  const out: ColourProposal[] = []
  for (let i = 0; i < wines.length; i += BATCH_SIZE) {
    const batch = wines.slice(i, i + BATCH_SIZE)
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify({ wines: batch.map(describe) }) },
      ],
    })
    out.push(...parseColourReply(response.choices[0]?.message?.content ?? '', batch))
  }
  return out
}
