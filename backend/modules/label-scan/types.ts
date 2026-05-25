/**
 * label-scan/types.ts
 * Types for the GPT-4o label scan module.
 * Mirrors the Tier 1 / Tier 2 field split defined in wine-app-product-context.md §3.
 */

/** Structured output returned by the label scan module. */
export interface LabelScanResult {
  // ── Tier 1 — Canonical fields (expected on every scan) ──────────────────────
  producer: string | null
  vintage: number | null          // null for NV
  region: string | null
  denomination: string | null     // AOC/AOP, DOC/DOCG, DO/DOCa, AVA, etc.

  // ── Tier 2 — LLM-enriched, nullable by design ────────────────────────────────
  quality_classification: string | null  // Premier Cru, Grand Cru, Riserva, etc.
  vineyard: string | null                // Specific lieu-dit within the denomination
  cuvee: string | null                   // Prestige/commercial name; overflow for unclassified text
  grape_varieties: string[] | null       // Extracted or inferred from denomination; null if ambiguous

  // ── Metadata ──────────────────────────────────────────────────────────────────
  /** Tier 1 fields the scan could not confidently populate — UI should prompt user */
  missing_tier1_fields: Array<keyof Pick<LabelScanResult, 'producer' | 'vintage' | 'region' | 'denomination'>>
  /** Raw model response text, retained for debugging */
  raw_response: string
}

/** Input accepted by the scan function. */
export interface LabelScanInput {
  /** Raw image buffer (any format — will be resized before API call). */
  imageBuffer: Buffer
  /** MIME type of the original image (e.g. "image/jpeg"). */
  mimeType: string
}

/** Returned when OPENAI_API_KEY is not configured. */
export interface LabelScanUnavailable {
  available: false
  reason: 'no_api_key'
}

/** Returned when the image cannot be decoded (unsupported format). */
export interface LabelScanFormatError {
  available: false
  reason: 'unsupported_format'
  detail: string
}

export type LabelScanResponse =
  | { available: true; result: LabelScanResult }
  | LabelScanUnavailable
  | LabelScanFormatError
