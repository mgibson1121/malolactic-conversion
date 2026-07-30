# GPT-4o Retailer Page Extraction Prompt

## Purpose

Extract price, vintage, and attributed critic scores (plus, as of Phase 8, each score citation's drinking window / vintage character / value signal) from a real retailer product page. Used by `modules/reviews/` (Phase 7) — Puppeteer renders the page, `keyword-window.ts` windows the rendered text down to the portion(s) around score citations, and this prompt runs against that windowed excerpt, not the full page.

## Input

Windowed excerpt of a single retailer product page — one or more spans of text around each detected score-citation pattern, or a stripped/capped fallback of the whole page when no citation pattern is found (see `keyword-window.ts`). Never the raw, unwindowed HTML.

## Output

Structured JSON:

```json
{
  "price": 125.00,
  "url": "https://www.klwines.com/p/i?i=1234567",
  "vintage": 2020,
  "critic_scores": [
    {
      "publication": "Burghound",
      "score": 92,
      "drinking_window": { "start": 2028, "end": 2040 },
      "vintage_character": "very_good",
      "deal": false
    },
    {
      "publication": "Vinous",
      "score": 94,
      "drinking_window": null,
      "vintage_character": null,
      "deal": true
    }
  ]
}
```

- `price`: numeric bottle price in USD. `null` if not found or ambiguous.
- `url`: canonical product page URL. Use the page URL passed in if the excerpt does not contain a self-referencing canonical.
- `vintage`: 4-digit vintage year of the wine on this specific page. `null` if not stated or the wine is non-vintage.
- `critic_scores`: array of score citation objects. Only include scores **visibly attributed to a named publication or critic** in the excerpt. Do not infer or hallucinate attributions. Common publications: Burghound, Vinous, Wine Advocate, Wine Spectator, James Suckling, Jancis Robinson, Decanter.
  - `publication`: full name, critic surname, or a short abbreviation shown next to the score (e.g. "WA", "JD", "V") — canonicalized against `critic-keywords.ts` after extraction, not by this prompt.
  - `score`: if given as a range or plus form ("94-96", "94+"), the higher number.
  - `drinking_window` (Phase 8): `{ start, end }` year range **explicitly stated** in the citation (e.g. "drink 2028-2040"). Never inferred or interpolated from the score or vintage. `null` if the citation doesn't state one.
  - `vintage_character` (Phase 8): one of `below_avg` / `avg` / `good` / `very_good`. Set only when the source characterizes the **vintage as a whole** for the region/appellation ("2019 was an excellent vintage in Barolo"), not when it's only describing this specific wine. `null` otherwise.
  - `deal` (Phase 8): `true` only when the source explicitly signals value/QPR ("overdelivers for the price", "great value", "fairly priced"). Never inferred from a score-to-price ratio — text-stated only. `false`/absent otherwise.

## Rules

- If no price is found, return `null` for `price` — never guess.
- Only extract integer or decimal scores (e.g. 92, 94.5). Do not include letter grades or text-only assessments.
- If no critic scores are found, return an empty array `[]`.
- Do not extract review text — structured facts only (numbers, an enum value, a boolean, a year range). Never quote or paraphrase the source's sentence — this is the copyright boundary (`CLAUDE.md` §15).
- If the excerpt is from a search-results page rather than a single product page, return `{ "price": null, "url": "<page url>", "vintage": null, "critic_scores": [] }`.

## System prompt used in code (`gpt-extract.ts`)

```
You are a structured data extractor. Given an excerpt of a wine retailer product page (HTML or plain text, possibly just the portion surrounding a critic score citation), extract:
1. The bottle price in USD (number or null if not found)
2. The canonical product page URL
3. The vintage year of the wine on this specific page (4-digit year, or null if not stated or the wine is non-vintage)
4. Any critic scores explicitly attributed to a named publication or critic in the excerpt, each with three additional facts drawn from the same citation

Return ONLY valid JSON in this exact shape:
{"price": <number|null>, "url": "<string>", "vintage": <number|null>, "critic_scores": [{"publication": "<string>", "score": <number>, "drinking_window": {"start": <number|null>, "end": <number|null>}|null, "vintage_character": "below_avg"|"avg"|"good"|"very_good"|null, "deal": <boolean>}]}

Only include scores with a clearly named publication or critic — this can be a full publication name (e.g. Burghound, Vinous, Wine Advocate, Wine Spectator, James Suckling, Jancis Robinson, Decanter), a critic's name, or a short abbreviation shown right next to the score (e.g. "WA", "JD", "V"). If a score is given as a range or plus form (e.g. "94-96" or "94+"), return the higher number. Do not include review text — scores (numbers) only. If no attributed scores are found, return an empty array. If the excerpt is from a search results page rather than a single product page, return price: null, vintage: null, and an empty critic_scores array.

For each critic score, also extract:
- drinking_window: a year range the citation explicitly states for when to drink the wine (e.g. "drink 2028-2040" -> {"start": 2028, "end": 2040}). Only extract years explicitly stated in the text — never infer, estimate, or interpolate a window from the score or vintage. null if no window is stated.
- vintage_character: one of "below_avg", "avg", "good", "very_good" — set ONLY when the source characterizes the vintage as a whole for the region/appellation (e.g. "2019 was an excellent vintage in Barolo"), not when it only describes this specific wine. Map the source's own language to the closest of these four levels. null if the source does not characterize the vintage broadly.
- deal: true only when the source explicitly signals strong value or QPR (e.g. "overdelivers for the price", "great value", "fairly priced"). Never infer this from the score-to-price ratio yourself — text-stated only. false if not explicitly stated.
These three fields describe a fact stated in the source text, not your own assessment — never paraphrase or reproduce the source's sentence, extract only the derived value (a date range, an enum, or a boolean).
```

## Workflow context

Step 1 (`find-product-page.ts`, Serper organic `/search` with a `site:`-restricted query) locates a real product page URL. Step 2 renders it with Puppeteer (`puppeteer-extract.ts`), windows the rendered text around score citations (`keyword-window.ts`), and runs this prompt against the windowed excerpt — never the full page, and never a search-results page.

`publication` values returned here are canonicalized (or flagged `known_publication: false`) by `canonicalizePublication` in `gpt-extract.ts` against `critic-keywords.ts`, after this prompt runs — that lookup never gates whether a score is captured.

`drinking_window`/`vintage_character`/`deal` (Phase 8) are extracted per citation into `review_data`. Populating the wine-level `drinking_window`/`vintage_rating` columns from these — without blending across critics — is separate logic in `derive-wine-level.ts`, not part of this prompt.
