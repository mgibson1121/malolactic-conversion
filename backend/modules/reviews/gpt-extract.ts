import OpenAI from 'openai'
import { CRITIC_KEYWORDS } from './critic-keywords'
import type { CriticScore, GptPageExtraction } from './types'

const SYSTEM_PROMPT =
  'You are a structured data extractor. Given an excerpt of a wine retailer product page (HTML or plain text, possibly just the portion surrounding a critic score citation), extract:\n' +
  '1. The bottle price in USD (number or null if not found)\n' +
  '2. The canonical product page URL\n' +
  '3. The vintage year of the wine on this specific page (4-digit year, or null if not stated or the wine is non-vintage)\n' +
  '4. Any critic scores explicitly attributed to a named publication or critic in the excerpt, each with three additional facts drawn from the same citation\n\n' +
  'Return ONLY valid JSON in this exact shape:\n' +
  '{"price": <number|null>, "url": "<string>", "vintage": <number|null>, "critic_scores": [{"publication": "<string>", "score": <number>, "drinking_window": {"start": <number|null>, "end": <number|null>}|null, "vintage_character": "below_avg"|"avg"|"good"|"very_good"|null, "deal": <boolean>}]}\n\n' +
  'Only include scores with a clearly named publication or critic — this can be a full publication name (e.g. Burghound, Vinous, Wine Advocate, Wine Spectator, James Suckling, Jancis Robinson, Decanter), a critic\'s name, or a short abbreviation shown right next to the score (e.g. "WA", "JD", "V"). ' +
  'If a score is given as a range or plus form (e.g. "94-96" or "94+"), return the higher number. ' +
  'Do not include review text — scores (numbers) only. ' +
  'If no attributed scores are found, return an empty array. ' +
  'If the excerpt is from a search results page rather than a single product page, return price: null, vintage: null, and an empty critic_scores array.\n\n' +
  'For each critic score, also extract:\n' +
  '- drinking_window: a year range the citation explicitly states for when to drink the wine (e.g. "drink 2028-2040" -> {"start": 2028, "end": 2040}). Only extract years explicitly stated in the text — never infer, estimate, or interpolate a window from the score or vintage. null if no window is stated.\n' +
  '- vintage_character: one of "below_avg", "avg", "good", "very_good" — set ONLY when the source characterizes the vintage as a whole for the region/appellation (e.g. "2019 was an excellent vintage in Barolo"), not when it only describes this specific wine. Map the source\'s own language to the closest of these four levels. null if the source does not characterize the vintage broadly.\n' +
  '- deal: true only when the source explicitly signals strong value or QPR (e.g. "overdelivers for the price", "great value", "fairly priced"). Never infer this from the score-to-price ratio yourself — text-stated only. false if not explicitly stated.\n' +
  'These three fields describe a fact stated in the source text, not your own assessment — never paraphrase or reproduce the source\'s sentence, extract only the derived value (a date range, an enum, or a boolean).'

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
      critic_scores: Array<{
        publication: string
        score: number
        drinking_window?: { start: number | null; end: number | null } | null
        vintage_character?: 'below_avg' | 'avg' | 'good' | 'very_good' | null
        deal?: boolean
      }>
    }
    const critic_scores: CriticScore[] = parsed.critic_scores.map((s) => ({
      score: s.score,
      ...canonicalizePublication(s.publication),
      drinking_window: s.drinking_window ?? null,
      vintage_character: s.vintage_character ?? null,
      deal: s.deal ?? false,
    }))

    return { price: parsed.price, url: parsed.url, vintage: parsed.vintage ?? null, critic_scores }
  } catch {
    return null
  }
}
