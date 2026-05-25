/**
 * tag-extraction.ts
 * GPT-4o tag extraction from tasting note content.
 *
 * Combines structured aroma fields with free-text analysis.
 * Degrades gracefully: if OPENAI_API_KEY is not configured, returns tags
 * derived from the structured aroma arrays only (no LLM call).
 */

import OpenAI from 'openai'
import type { CreateTastingNoteInput } from '@shared/types'

export async function extractTags(note: CreateTastingNoteInput): Promise<string[]> {
  // Structured aromas are always available as tags
  const candidateTags: string[] = [
    ...note.nose_primary_aromas,
    ...note.nose_secondary_aromas,
    ...note.nose_tertiary_aromas,
  ]

  const apiKey = process.env.OPENAI_API_KEY

  // If a key and free text are present, supplement with GPT-4o extraction
  if (apiKey && note.free_text?.trim()) {
    try {
      const client = new OpenAI({ apiKey })
      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 150,
        messages: [
          {
            role: 'system',
            content:
              'Extract concise, searchable tags from a wine tasting note. ' +
              'Return a JSON array of lowercase strings — e.g. ["earthy", "needs-time", "high-tannin"]. ' +
              'Max 8 tags. Focus on characteristics not already captured in aroma descriptors: ' +
              'structural observations (e.g. high-tannin, bright-acid), cellaring signals ' +
              '(needs-time, drink-now), style descriptors (elegant, powerful, mineral). ' +
              'Return ONLY the JSON array. No markdown fences, no explanation.',
          },
          {
            role: 'user',
            content: note.free_text,
          },
        ],
      })
      const raw = response.choices[0]?.message?.content ?? '[]'
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
      const extracted: unknown = JSON.parse(cleaned)
      if (Array.isArray(extracted)) {
        candidateTags.push(...(extracted as string[]))
      }
    } catch {
      // LLM extraction failed — structured aromas are sufficient
    }
  }

  // Deduplicate, lowercase, trim, remove empties
  return [...new Set(candidateTags.map((t) => t.toLowerCase().trim()).filter(Boolean))]
}
