import OpenAI from 'openai'
import type { GptPageExtraction } from './types'

const SYSTEM_PROMPT =
  'You are a structured data extractor. Given the HTML of a wine retailer product page, extract:\n' +
  '1. The bottle price in USD (number or null if not found)\n' +
  '2. The canonical product page URL\n' +
  '3. Any critic scores explicitly attributed to a named publication on the page\n\n' +
  'Return ONLY valid JSON in this exact shape:\n' +
  '{"price": <number|null>, "url": "<string>", "critic_scores": [{"publication": "<string>", "score": <number>}]}\n\n' +
  'Only include scores with a clearly named publication (e.g. Burghound, Vinous, Wine Advocate, Wine Spectator, James Suckling, Jancis Robinson, Decanter). ' +
  'Do not include review text — scores (numbers) only. ' +
  'If no attributed scores are found, return an empty array. ' +
  'If the page is a search results page rather than a single product page, return price: null and an empty critic_scores array.'

export async function extractFromRenderedHtml(
  openai: OpenAI,
  html: string,
  pageUrl: string
): Promise<GptPageExtraction | null> {
  const trimmed = html.slice(0, 80_000)
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Page URL: ${pageUrl}\n\nHTML:\n${trimmed}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    })
    const text = response.choices[0]?.message?.content
    if (!text) return null
    return JSON.parse(text) as GptPageExtraction
  } catch {
    return null
  }
}
