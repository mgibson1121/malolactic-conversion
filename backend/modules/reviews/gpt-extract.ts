import OpenAI from 'openai'
import { CRITIC_KEYWORDS } from './critic-keywords'
import type { CriticScore, GptPageExtraction } from './types'

const SYSTEM_PROMPT =
  'You are a structured data extractor. Given an excerpt of a wine retailer product page (HTML or plain text, possibly just the portion surrounding a critic score citation), extract:\n' +
  '1. The bottle price in USD (number or null if not found)\n' +
  '2. The canonical product page URL\n' +
  '3. The vintage year of the wine on this specific page (4-digit year, or null if not stated or the wine is non-vintage)\n' +
  '4. Any critic scores explicitly attributed to a named publication or critic in the excerpt\n\n' +
  'Return ONLY valid JSON in this exact shape:\n' +
  '{"price": <number|null>, "url": "<string>", "vintage": <number|null>, "critic_scores": [{"publication": "<string>", "score": <number>}]}\n\n' +
  'Only include scores with a clearly named publication or critic — this can be a full publication name (e.g. Burghound, Vinous, Wine Advocate, Wine Spectator, James Suckling, Jancis Robinson, Decanter), a critic\'s name, or a short abbreviation shown right next to the score (e.g. "WA", "JD", "V"). ' +
  'If a score is given as a range or plus form (e.g. "94-96" or "94+"), return the higher number. ' +
  'Do not include review text — scores (numbers) only. ' +
  'If no attributed scores are found, return an empty array. ' +
  'If the excerpt is from a search results page rather than a single product page, return price: null, vintage: null, and an empty critic_scores array.'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Looks up GPT-4o's raw attribution text against CRITIC_KEYWORDS. A match
 * normalizes to the canonical publication name and sets known_publication:
 * true; no match keeps the raw text as-is and sets known_publication:
 * false. Never gates whether the score itself gets kept — that decision is
 * already made by the time this runs (see keyword-window.ts).
 */
export function canonicalizePublication(rawPublication: string): { publication: string; known_publication: boolean } {
  const trimmed = rawPublication.trim()

  for (const kw of CRITIC_KEYWORDS) {
    if (trimmed.toLowerCase() === kw.term.toLowerCase()) {
      return { publication: kw.publication, known_publication: true }
    }
  }
  for (const kw of CRITIC_KEYWORDS) {
    const re = new RegExp(`\\b${escapeRegExp(kw.term)}\\b`, 'i')
    if (re.test(trimmed)) {
      return { publication: kw.publication, known_publication: true }
    }
  }
  return { publication: trimmed, known_publication: false }
}

/**
 * `text` is pre-windowed by keyword-window.ts before this is called — it's
 * an excerpt around one or more score citations (or a stripped/capped
 * fallback), never the full raw HTML page. No truncation happens here.
 */
export async function extractFromRenderedHtml(
  openai: OpenAI,
  text: string,
  pageUrl: string
): Promise<GptPageExtraction | null> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Page URL: ${pageUrl}\n\nExcerpt:\n${text}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    })
    const content = response.choices[0]?.message?.content
    if (!content) return null

    const parsed = JSON.parse(content) as {
      price: number | null
      url: string
      vintage: number | null
      critic_scores: Array<{ publication: string; score: number }>
    }
    const critic_scores: CriticScore[] = parsed.critic_scores.map((s) => ({
      score: s.score,
      ...canonicalizePublication(s.publication),
    }))

    return { price: parsed.price, url: parsed.url, vintage: parsed.vintage ?? null, critic_scores }
  } catch {
    return null
  }
}
