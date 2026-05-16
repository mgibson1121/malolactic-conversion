/**
 * label-scan/index.ts
 * GPT-4o vision label scan module.
 *
 * Responsibilities:
 * 1. Resize input image to max 1024px on longest side (sharp)
 * 2. Call GPT-4o vision with a Tier 1 + Tier 2 extraction prompt
 * 3. Parse + validate the structured JSON response
 * 4. Return LabelScanResult or graceful unavailable state
 */

import sharp from 'sharp'
import OpenAI from 'openai'
import type { LabelScanInput, LabelScanResponse, LabelScanResult } from './types'

const MAX_PX = 1024

// ── Image resize ─────────────────────────────────────────────────────────────

/**
 * Resize the image so neither dimension exceeds MAX_PX.
 * Preserves aspect ratio. Returns a JPEG buffer (safe for all OpenAI vision inputs).
 */
async function resizeImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: MAX_PX, height: MAX_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer()
}

// ── GPT-4o prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a wine label reading assistant. Extract structured data from wine label images with precision.

You will return a single JSON object. Follow these rules exactly:

TIER 1 FIELDS (canonical — extract from every label):
- name: The clean commercial wine name on the label. Do NOT include vineyard, classification, or producer text in this field.
- producer: The producer or domaine name.
- vintage: A 4-digit year as a number, or null if NV (non-vintage).
- region: The broad geographic region (e.g. Burgundy, Piedmont, Rioja, Napa Valley).
- denomination: The controlled designation of origin — AOC/AOP (France), DOC/DOCG (Italy), DO/DOCa (Spain), AVA (USA). Examples: Volnay, Barolo, Rioja DOCa, Chablis.
- grape_varieties: Array of grape variety strings. Empty array [] if none visible.

TIER 2 FIELDS (LLM-enriched — nullable by design, never hallucinate):
- quality_classification: Extract ONLY if the label explicitly contains one of these terms or close equivalents: Premier Cru, 1er Cru, Grand Cru, Riserva, Reserva, Gran Reserva, Superiore, Classico, Cru Bourgeois. Return null if none found. Do not infer or guess.
- vineyard: A specific vineyard name or lieu-dit within the denomination. Extract if: (a) text appears in quotation marks on the front label and is not the producer or wine name, OR (b) text is preceded by a known vineyard prefix: Viña, Vina, Vigna, Vigneto, Clos, Les. If label text remains unclassified after all other fields are assigned, attempt to classify it as a vineyard — if confidence is low, it should have been appended to 'name' instead. Return null if no rule is triggered. Do not guess.

CRITICAL RULES:
- Return ONLY valid JSON. No markdown fences, no explanation text.
- A null value is always preferable to a hallucinated value.
- Never invent data that is not clearly present on the label.
- Tier 2 fields left null are correct behaviour — do not fill them speculatively.

Return this exact JSON structure:
{
  "name": string | null,
  "producer": string | null,
  "vintage": number | null,
  "region": string | null,
  "denomination": string | null,
  "grape_varieties": string[],
  "quality_classification": string | null,
  "vineyard": string | null
}`

// ── Scan function ─────────────────────────────────────────────────────────────

export async function scanLabel(input: LabelScanInput): Promise<LabelScanResponse> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return { available: false, reason: 'no_api_key' }
  }

  const client = new OpenAI({ apiKey })

  // 1. Resize
  const resized = await resizeImage(input.imageBuffer)
  const base64 = resized.toString('base64')

  // 2. GPT-4o vision call
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 500,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${base64}`,
              detail: 'high',
            },
          },
          { type: 'text', text: 'Extract all wine label data from this image.' },
        ],
      },
    ],
  })

  const rawText = response.choices[0]?.message?.content ?? ''

  // 3. Parse JSON
  let parsed: Partial<LabelScanResult>
  try {
    // Strip any accidental markdown fences the model might add
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    // Return what we can with a clear signal that parsing failed
    return {
      available: true,
      result: {
        name: null,
        producer: null,
        vintage: null,
        region: null,
        denomination: null,
        grape_varieties: [],
        quality_classification: null,
        vineyard: null,
        missing_tier1_fields: ['name', 'producer', 'vintage', 'region', 'denomination'],
        raw_response: rawText,
      },
    }
  }

  // 4. Build result with safe defaults
  const result: LabelScanResult = {
    name: parsed.name ?? null,
    producer: parsed.producer ?? null,
    vintage: parsed.vintage ?? null,
    region: parsed.region ?? null,
    denomination: parsed.denomination ?? null,
    grape_varieties: Array.isArray(parsed.grape_varieties) ? parsed.grape_varieties : [],
    quality_classification: parsed.quality_classification ?? null,
    vineyard: parsed.vineyard ?? null,
    missing_tier1_fields: [],
    raw_response: rawText,
  }

  // 5. Flag missing Tier 1 fields for the UI
  const tier1: Array<keyof Pick<LabelScanResult, 'name' | 'producer' | 'vintage' | 'region' | 'denomination'>> =
    ['name', 'producer', 'vintage', 'region', 'denomination']

  result.missing_tier1_fields = tier1.filter(f => result[f] === null || result[f] === undefined)

  return { available: true, result }
}
