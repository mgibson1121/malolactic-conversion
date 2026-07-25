# GPT-4o Retailer Page Extraction Prompt

## Purpose

Extract price and attributed critic scores from a fully-rendered retailer wine product page. Used in Step 2 of the price enrichment workflow — Puppeteer has already rendered the SPA page; this prompt receives the resulting HTML.

## Input

Fully rendered HTML of a single retailer product page (rendered by Puppeteer so JavaScript has executed and product data is in the DOM).

## Output

Structured JSON:

```json
{
  "price": 125.00,
  "url": "https://www.klwines.com/p/i?i=1234567",
  "critic_scores": [
    { "publication": "Burghound", "score": 92 },
    { "publication": "Vinous", "score": 94 }
  ]
}
```

- `price`: numeric bottle price in USD. `null` if not found or ambiguous.
- `url`: canonical product page URL. Use the page URL passed in if the HTML does not contain a self-referencing canonical.
- `critic_scores`: array of `{ publication, score }` objects. Only include scores **visibly attributed to a named publication** on the page. Do not infer or hallucinate attributions. Common publications: Burghound, Vinous, Wine Advocate, Wine Spectator, James Suckling, Jancis Robinson, Decanter.

## Rules

- If no price is found, return `null` for `price` — never guess.
- Only extract integer or decimal scores (e.g. 92, 94.5). Do not include letter grades or text-only assessments.
- If no critic scores are found, return an empty array `[]`.
- Do not extract review text — scores (numbers) only.
- If the page is a search results page (not a single product page), return `{ "price": null, "url": "<page url>", "critic_scores": [] }`.

## System prompt used in code (`gpt-extract.ts`)

```
You are a structured data extractor. Given the HTML of a wine retailer product page, extract:
1. The bottle price in USD (number or null if not found)
2. The canonical product page URL
3. Any critic scores explicitly attributed to a named publication on the page

Return ONLY valid JSON in this exact shape:
{"price": <number|null>, "url": "<string>", "critic_scores": [{"publication": "<string>", "score": <number>}]}

Only include scores with a clearly named publication (e.g. Burghound, Vinous, Wine Advocate, Wine Spectator, James Suckling, Jancis Robinson, Decanter).
Do not include review text — scores (numbers) only.
If no attributed scores are found, return an empty array.
If the page is a search results page rather than a single product page, return price: null and an empty critic_scores array.
```

## Two-step workflow context

Step 1 (Google Custom Search JSON API) finds matching product URLs and prices from Google's indexed data. Step 2 (this prompt, after Puppeteer renders the page) extracts attributed critic scores that are only available in the rendered DOM — not in the indexed snippet.

If Step 1 already captured a price and Step 2 also returns a price, the Step 2 price takes precedence (it comes from the live rendered page).
