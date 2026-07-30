/**
 * Unit tests for extractFromRenderedHtml's Phase 8 field parsing
 * (drinking_window, vintage_character, deal). OpenAI is mocked — these
 * tests verify gpt-extract.ts faithfully parses/defaults whatever the model
 * returns; they cannot verify the model itself correctly judges "broad
 * vintage language" vs. "wine-specific note that mentions a year" — that
 * judgment lives in the prompt and can only be validated against real
 * GPT-4o output (see backend/scripts/validate-reviews.ts).
 */
jest.mock('openai')

import OpenAI from 'openai'
import { extractFromRenderedHtml } from './gpt-extract'

function mockOpenAI(content: string) {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  })
  ;(OpenAI as unknown as jest.Mock).mockImplementation(() => ({
    chat: { completions: { create } },
  }))
  return create
}

describe('extractFromRenderedHtml — Phase 8 fields', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('parses drinking_window, vintage_character, and deal when the model returns all three', async () => {
    mockOpenAI(JSON.stringify({
      price: 125,
      url: 'https://example.com/p/1',
      vintage: 2019,
      critic_scores: [
        {
          publication: 'Wine Advocate',
          score: 94,
          drinking_window: { start: 2028, end: 2040 },
          vintage_character: 'very_good',
          deal: true,
        },
      ],
    }))
    const openai = new OpenAI({ apiKey: 'test' })

    const result = await extractFromRenderedHtml(openai, 'excerpt text', 'https://example.com/p/1')

    expect(result?.critic_scores).toEqual([
      {
        publication: 'Wine Advocate',
        score: 94,
        known_publication: true,
        drinking_window: { start: 2028, end: 2040 },
        vintage_character: 'very_good',
        deal: true,
      },
    ])
  })

  it('defaults drinking_window to null, vintage_character to null, and deal to false when the model omits them', async () => {
    mockOpenAI(JSON.stringify({
      price: 60,
      url: 'https://example.com/p/2',
      vintage: 2020,
      critic_scores: [{ publication: 'Vinous', score: 91 }],
    }))
    const openai = new OpenAI({ apiKey: 'test' })

    const result = await extractFromRenderedHtml(openai, 'excerpt text', 'https://example.com/p/2')

    expect(result?.critic_scores[0]).toMatchObject({
      drinking_window: null,
      vintage_character: null,
      deal: false,
    })
  })

  it('defaults drinking_window to null, vintage_character to null, and deal to false when the model returns them as explicit null/false', async () => {
    mockOpenAI(JSON.stringify({
      price: 60,
      url: 'https://example.com/p/3',
      vintage: 2020,
      critic_scores: [
        { publication: 'Vinous', score: 91, drinking_window: null, vintage_character: null, deal: false },
      ],
    }))
    const openai = new OpenAI({ apiKey: 'test' })

    const result = await extractFromRenderedHtml(openai, 'excerpt text', 'https://example.com/p/3')

    expect(result?.critic_scores[0]).toMatchObject({
      drinking_window: null,
      vintage_character: null,
      deal: false,
    })
  })

  it('preserves independent per-citation fields across multiple critic scores in the same excerpt', async () => {
    mockOpenAI(JSON.stringify({
      price: 200,
      url: 'https://example.com/p/4',
      vintage: 2018,
      critic_scores: [
        { publication: 'Burghound', score: 92, drinking_window: { start: 2026, end: 2035 }, vintage_character: 'good', deal: false },
        { publication: 'Vinous', score: 95, drinking_window: null, vintage_character: null, deal: true },
      ],
    }))
    const openai = new OpenAI({ apiKey: 'test' })

    const result = await extractFromRenderedHtml(openai, 'excerpt text', 'https://example.com/p/4')

    expect(result?.critic_scores).toEqual([
      { publication: 'Burghound', score: 92, known_publication: true, drinking_window: { start: 2026, end: 2035 }, vintage_character: 'good', deal: false },
      { publication: 'Vinous', score: 95, known_publication: true, drinking_window: null, vintage_character: null, deal: true },
    ])
  })
})
