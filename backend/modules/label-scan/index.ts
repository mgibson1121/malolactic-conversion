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
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFile, readFile, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import OpenAI from 'openai'
import type { LabelScanInput, LabelScanResponse, LabelScanResult } from './types'

const MAX_PX = 1024

const HEIC_MIMES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'])

// ── HEIC conversion via sips (macOS built-in) ────────────────────────────────

/**
 * Convert a HEIC/HEIF buffer to JPEG using macOS's built-in `sips` tool.
 * sips is available on every Mac at /usr/bin/sips — no extra dependencies.
 */
async function heicToJpeg(buffer: Buffer): Promise<Buffer> {
  const id = randomUUID()
  const inPath = join(tmpdir(), `${id}.heic`)
  const outPath = join(tmpdir(), `${id}.jpg`)

  try {
    await writeFile(inPath, buffer)
    await new Promise<void>((resolve, reject) => {
      execFile('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', inPath, '--out', outPath], (err) => {
        if (err) reject(new Error(`sips conversion failed: ${err.message}`))
        else resolve()
      })
    })
    return await readFile(outPath)
  } finally {
    await unlink(inPath).catch(() => {})
    await unlink(outPath).catch(() => {})
  }
}

// ── Image resize ─────────────────────────────────────────────────────────────

/**
 * Resize the image so neither dimension exceeds MAX_PX.
 * HEIC/HEIF files are first converted to JPEG via sips (macOS built-in).
 * Returns a JPEG buffer safe for all OpenAI vision inputs.
 */
async function resizeImage(buffer: Buffer, mimeType: string): Promise<Buffer> {
  let workingBuffer = buffer

  // Step 1: convert HEIC/HEIF → JPEG using sips before sharp touches it
  if (HEIC_MIMES.has(mimeType)) {
    console.log('[label-scan] converting HEIC → JPEG via sips')
    workingBuffer = await heicToJpeg(buffer)
  }

  // Step 2: resize via sharp
  try {
    return await sharp(workingBuffer, { failOn: 'none' })
      .rotate()               // honour EXIF orientation
      .toColorspace('srgb')   // normalise wide-gamut (P3) ICC profiles
      .resize({ width: MAX_PX, height: MAX_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[label-scan] sharp error:', detail)
    throw new Error(`IMAGE_FORMAT_UNSUPPORTED: ${detail}`)
  }
}

// ── GPT-4o prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a wine label reading assistant. Extract structured data from wine label images with precision.

You will return a single JSON object. Follow these rules exactly:

TIER 1 FIELDS (canonical — must be extracted from every label; flag as null only if truly absent):
- producer: The producer or domaine name.
- vintage: A 4-digit year as a number, or null if NV (non-vintage).
- region: The broad geographic region (e.g. Burgundy, Piedmont, Rioja, Napa Valley).
- denomination: The controlled designation of origin — AOC/AOP (France), DOC/DOCG (Italy), DO/DOCa (Spain), AVA (USA). Examples: Volnay, Barolo, Rioja DOCa, Chablis.

TIER 2 FIELDS (LLM-enriched — nullable by design, never hallucinate):
- quality_classification: Extract ONLY if the label explicitly contains one of these terms or close equivalents: Premier Cru, 1er Cru, Grand Cru, Riserva, Reserva, Gran Reserva, Superiore, Classico, Cru Bourgeois. Return null if none found. Do not infer or guess.
- vineyard: A specific vineyard or lieu-dit name within the denomination. Extract if: (a) text appears in quotation marks on the front label and is not the producer or denomination, OR (b) text is preceded by a known vineyard prefix: Viña, Vina, Vigna, Vigneto, Clos, Les. If label text remains unclassified after all other fields are assigned and vineyard confidence is low, put it in 'cuvee' instead. Return null if no rule is triggered. Do not guess.
- cuvee: A proper commercial name for the wine that is distinct from the denomination, vineyard, or producer. Typically used by Champagne houses, prestige cuvées, and some New World producers (e.g. Cristal, Belle Époque, Opus One). Also use as the overflow field for any label text that cannot be confidently assigned to vineyard. Return null if no distinct cuvee name is present. Do not populate with the denomination or producer name.
- grape_varieties: Array of grape variety strings. Extract directly from the label if listed. If not listed, infer from the denomination using established regional conventions. Examples of required inferences: Volnay → ["Pinot Noir"], Gevrey-Chambertin → ["Pinot Noir"], Chambolle-Musigny → ["Pinot Noir"], Meursault → ["Chardonnay"], Chablis → ["Chardonnay"], Bouzeron → ["Aligoté"], Mâcon → ["Chardonnay"], Barolo → ["Nebbiolo"], Barbaresco → ["Nebbiolo"], Brunello di Montalcino → ["Sangiovese"], Rioja Tinto → ["Tempranillo"], Châteauneuf-du-Pape → ["Grenache"], Hermitage Rouge → ["Syrah"], Sancerre → ["Sauvignon Blanc"], Pouilly-Fumé → ["Sauvignon Blanc"], Muscadet → ["Melon de Bourgogne"]. NEVER return an empty array []. Either return a populated array or null — an empty array is always wrong.

CRITICAL RULES:
- Return ONLY valid JSON. No markdown fences, no explanation text.
- A null value is always preferable to a hallucinated value.
- Never invent data that is not clearly present on the label.
- Tier 2 fields left null are correct behaviour — do not fill them speculatively.
- grape_varieties must be null (not []) when you cannot reliably determine the varieties. An empty array [] is NEVER a valid response.

Return this exact JSON structure:
{
  "producer": string | null,
  "vintage": number | null,
  "region": string | null,
  "denomination": string | null,
  "quality_classification": string | null,
  "vineyard": string | null,
  "cuvee": string | null,
  "grape_varieties": string[] | null
}`

// ── Scan function ─────────────────────────────────────────────────────────────

export async function scanLabel(input: LabelScanInput): Promise<LabelScanResponse> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return { available: false, reason: 'no_api_key' }
  }

  const client = new OpenAI({ apiKey })

  // 1. Resize — catch unsupported format errors before hitting the API
  let resized: Buffer
  try {
    resized = await resizeImage(input.imageBuffer, input.mimeType)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith('IMAGE_FORMAT_UNSUPPORTED')) {
      return { available: false, reason: 'unsupported_format', detail: msg }
    }
    throw err
  }
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
        producer: null,
        vintage: null,
        region: null,
        denomination: null,
        quality_classification: null,
        vineyard: null,
        cuvee: null,
        grape_varieties: null,
        missing_tier1_fields: ['producer', 'vintage', 'region', 'denomination'],
        raw_response: rawText,
      },
    }
  }

  // 4. Build result with safe defaults
  const result: LabelScanResult = {
    producer: parsed.producer ?? null,
    vintage: parsed.vintage ?? null,
    region: parsed.region ?? null,
    denomination: parsed.denomination ?? null,
    quality_classification: parsed.quality_classification ?? null,
    vineyard: parsed.vineyard ?? null,
    cuvee: parsed.cuvee ?? null,
    grape_varieties: Array.isArray(parsed.grape_varieties) && parsed.grape_varieties.length > 0
      ? parsed.grape_varieties
      : null,
    missing_tier1_fields: [],
    raw_response: rawText,
  }

  // 5. Flag missing Tier 1 fields for the UI
  const tier1: Array<keyof Pick<LabelScanResult, 'producer' | 'vintage' | 'region' | 'denomination'>> =
    ['producer', 'vintage', 'region', 'denomination']

  result.missing_tier1_fields = tier1.filter(f => result[f] === null || result[f] === undefined)

  return { available: true, result }
}
