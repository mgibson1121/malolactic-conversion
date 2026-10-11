import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { EnrichmentAction } from '../hooks/useEnrichmentAction'
import { CriticReviewsBlock } from './CriticReviewsBlock'
import { makeSummaryItem, makeTestWine } from '../test-fixtures'

vi.mock('../api', () => ({ chooseBottling: vi.fn() }))
import { chooseBottling } from '../api'
const mockChoose = chooseBottling as unknown as ReturnType<typeof vi.fn>

const idle: EnrichmentAction = { busy: false, error: null, cachedAt: null, run: vi.fn() }

const ladder = (tier: '1' | '2' | '3a' | '3b') => ({
  tier,
  pages: [],
  rungs: [{ tier, pages: 2, scores: 3, trusted_scores: 1, critics: ['Vinous', 'Decanter'], vintages: [2021, 2019] }],
})

function wineAt(tier: '1' | '2' | '3a', extra: Record<string, unknown> = {}) {
  return makeTestWine({
    vintage: 2021,
    critic_summary: { ordered: [makeSummaryItem({ publication: 'Vinous', score: 94 })] },
    review_ladder: ladder(tier),
    ...extra,
  })
}

describe('Tier marker and explainer sheet (Phase 12.2 WI-2.3)', () => {
  it('names the tier in words, with an underlined, tappable ⓘ', () => {
    render(<CriticReviewsBlock wine={wineAt('2')} action={idle} />)
    const marker = screen.getByTestId('tier-marker')
    expect(marker).toHaveTextContent('Matched at Tier 2 · same wine, other vintages')
    const info = within(marker).getByRole('button', { name: 'What does this tier mean?' })
    expect(info.className).toMatch(/\blink\b/)
  })

  it('shows Tier 1 too, in the quiet style', () => {
    render(<CriticReviewsBlock wine={wineAt('1')} action={idle} />)
    expect(screen.getByTestId('tier-marker')).toHaveTextContent('Matched at Tier 1 · exact wine and vintage')
    expect(screen.getByTestId('tier-marker').className).toMatch(/quiet/)
  })

  it('opens a sheet that says what the tier means, what it does, and what was found at each rung', async () => {
    render(<CriticReviewsBlock wine={wineAt('2')} action={idle} />)
    await userEvent.click(screen.getByRole('button', { name: 'What does this tier mean?' }))
    const sheet = screen.getByRole('dialog', { name: 'Tier 2' })
    expect(sheet).toHaveTextContent('looked at other vintages of the same wine, nearest first')
    expect(sheet).toHaveTextContent('Tier 2: 2 pages, 3 scores (Vinous, Decanter)')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers "Which bottling is yours?" from a Tier 3 sheet', async () => {
    render(<CriticReviewsBlock wine={wineAt('3a')} action={idle} onWineUpdated={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'What does this tier mean?' }))
    expect(screen.getByRole('button', { name: 'Which bottling is yours?' })).toBeInTheDocument()
  })

  it('tags a score from a different bottling and from another vintage', () => {
    const wine = makeTestWine({
      vintage: 2021,
      critic_summary: {
        ordered: [
          makeSummaryItem({ publication: 'Decanter', score: 95, same_vintage: false, vintage: 2019, vintage_delta: 2, bottling_badge: "Names Castiglione — yours doesn't" }),
        ],
      },
      review_ladder: ladder('3b'),
    })
    render(<CriticReviewsBlock wine={wine} action={idle} />)
    expect(screen.getByText(/2019 · 2 yrs earlier/)).toBeInTheDocument()
    expect(screen.getByTitle("Names Castiglione — yours doesn't")).toHaveTextContent('different bottling?')
  })
})

describe('"Which bottling is yours?" (Phase 12.2 WI-2.5)', () => {
  const prompt = {
    reasons: ['modifiers' as const, 'price_split' as const],
    signature: 'castiglione|monvigliero',
    options: [
      { name: 'Castiglione', words: ['castiglione'], retailers: ['Woodland Hills'], critics: ['Decanter'], price_range: { min: 149, max: 199.99 }, links: [{ name: 'Woodland Hills', url: 'https://whwc.com/x' }], count: 2 },
      { name: 'Monvigliero', words: ['monvigliero'], retailers: ['JJ Buckley'], critics: [], price_range: null, links: [], count: 1 },
    ],
  }

  it('shows a non-blocking banner (with the check-the-bottle hint when the wine names no vineyard) that opens a sheet with the evidence', async () => {
    render(<CriticReviewsBlock wine={wineAt('2', { bottling_prompt: prompt })} action={idle} onWineUpdated={() => {}} />)
    const banner = screen.getByTestId('bottling-banner')
    expect(banner).toHaveTextContent('Listings name different bottlings — which is yours?')
    expect(banner).toHaveTextContent('check the bottle')
    await userEvent.click(within(banner).getByRole('button', { name: 'Choose' }))
    const sheet = screen.getByRole('dialog', { name: 'Which bottling is yours?' })
    expect(sheet).toHaveTextContent('Castiglione')
    expect(sheet).toHaveTextContent('Woodland Hills')
    expect(sheet).toHaveTextContent('$149–$200')
    expect(within(sheet).getByRole('link', { name: 'Woodland Hills' })).toHaveAttribute('href', 'https://whwc.com/x')
    expect(sheet).toHaveTextContent('Plain / no special bottling')
    expect(within(sheet).getByRole('button', { name: 'Not sure' })).toBeInTheDocument()
  })

  it('answering saves, hands the updated wine up, and says what changed in one line', async () => {
    const updated = wineAt('1', { vineyard: 'Castiglione' })
    mockChoose.mockResolvedValueOnce({ wine: updated, result: { tier: '1', scores: 4, trusted_scores: 3, headline_basis: 'multiple', duplicate: { kind: 'none' } } })
    const onUpdated = vi.fn()
    render(<CriticReviewsBlock wine={wineAt('2', { bottling_prompt: prompt })} action={idle} onWineUpdated={onUpdated} />)
    await userEvent.click(screen.getByRole('button', { name: 'Choose' }))
    const sheet = screen.getByRole('dialog')
    await userEvent.click(within(sheet.querySelectorAll('li')[0] as HTMLElement).getByRole('button', { name: 'This one' }))
    expect(mockChoose).toHaveBeenCalledWith(expect.any(String), { choice: 'vineyard', name: 'Castiglione' })
    expect(onUpdated).toHaveBeenCalledWith(updated)
    expect(await screen.findByRole('status')).toHaveTextContent('Now matched at Tier 1 — 3 trusted scores')
  })

  it('"Something else" sends the typed name with the chosen kind', async () => {
    mockChoose.mockResolvedValueOnce({ wine: wineAt('2'), result: { tier: '2', scores: 1, trusted_scores: 0, headline_basis: null, duplicate: null } })
    render(<CriticReviewsBlock wine={wineAt('2', { bottling_prompt: prompt })} action={idle} onWineUpdated={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Choose' }))
    await userEvent.click(screen.getByLabelText('Cuvée'))
    await userEvent.type(screen.getByLabelText('Name'), 'Riserva Speciale')
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))
    expect(mockChoose).toHaveBeenCalledWith(expect.any(String), { choice: 'cuvee', name: 'Riserva Speciale' })
  })

  it('treats a Vieilles-Vignes-style name as a cuvée', async () => {
    mockChoose.mockResolvedValueOnce({ wine: wineAt('2'), result: { tier: '2', scores: 1, trusted_scores: 0, headline_basis: null, duplicate: null } })
    const vv = { ...prompt, options: [{ name: 'Vieilles Vignes', words: ['vieilles', 'vignes'], retailers: [], critics: [], price_range: null, links: [], count: 1 }] }
    render(<CriticReviewsBlock wine={wineAt('2', { bottling_prompt: vv })} action={idle} onWineUpdated={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Choose' }))
    await userEvent.click(within(screen.getByRole('dialog').querySelectorAll('li')[0] as HTMLElement).getByRole('button', { name: 'This one' }))
    expect(mockChoose).toHaveBeenCalledWith(expect.any(String), { choice: 'cuvee', name: 'Vieilles Vignes' })
  })

  it('shows no banner when the server raised no prompt', () => {
    render(<CriticReviewsBlock wine={wineAt('2')} action={idle} onWineUpdated={() => {}} />)
    expect(screen.queryByTestId('bottling-banner')).not.toBeInTheDocument()
  })
})

describe('pages found without a score (Phase 12.2 WI-5)', () => {
  it('says which page was found and that no score could be read, instead of staying silent', () => {
    const wine = makeTestWine({
      vintage: 2020,
      review_data: [],
      review_ladder: {
        tier: 'none',
        rungs: [],
        pages: [
          { slug: 'woodland', name: 'Woodland Hills', product_url: 'https://whwc.com/x-2023/', rung: null, page_vintage: 2023, vintage_delta: 3, scores: 0, trusted_scores: 0, badge: null, tier_note: null },
        ],
      },
    })
    render(<CriticReviewsBlock wine={wine} action={idle} />)
    const note = screen.getByTestId('scoreless-pages')
    expect(note).toHaveTextContent('A page was found but no score could be read from it')
    expect(within(note).getByRole('link', { name: 'Woodland Hills (2023)' })).toHaveAttribute('href', 'https://whwc.com/x-2023/')
  })

  it('is absent when every page gave a score', () => {
    render(<CriticReviewsBlock wine={wineAt('2')} action={idle} />)
    expect(screen.queryByTestId('scoreless-pages')).not.toBeInTheDocument()
  })
})
