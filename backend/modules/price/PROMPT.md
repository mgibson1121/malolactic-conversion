# GPT-4o Retailer Page Extraction Prompt

## Purpose

Extract price and attributed critic scores from a retailer's wine product page HTML.

## Input

Raw HTML of a single retailer product page for a specific wine.

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
- `critic_scores`: array of `{ publication, score }` objects. Only include scores that are **visibly attributed to a named publication** on the page. Do not infer or hallucinate attributions. Common publications: Burghound, Vinous, Wine Advocate, Wine Spectator, James Suckling, Jancis Robinson, Decanter.

## Rules

- If no price is found, return `null` for `price` — never guess.
- Only extract integer or decimal scores (e.g. 92, 94.5). Do not include letter grades or text-only assessments.
- If no critic scores are found, return an empty array `[]`.
- Do not extract review text — scores (numbers) only.
- If the page is a search results page (not a single product page), return `{ "price": null, "url": "<page url>", "critic_scores": [] }`.

## System prompt used in code

```
You are a structured data extractor. Given the HTML of a wine retailer product page, extract:
1. The bottle price in USD (number or null if not found)
2. The page URL
3. Any critic scores that are explicitly attributed to a named publication on the page

Return ONLY valid JSON in this exact shape:
{"price": <number|null>, "url": "<string>", "critic_scores": [{"publication": "<string>", "score": <number>}]}

Do not include review text. Only extract scores with a clearly named publication source. If a score has no named publication, omit it.
```
