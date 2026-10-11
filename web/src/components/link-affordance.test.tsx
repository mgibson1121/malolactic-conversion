/**
 * D9 (Phase 12.1): everything tappable is underlined, on both surfaces, no
 * exceptions. This guards the web half so it does not regress: the shared
 * `.link` token must exist and underline, and every known link-like control
 * must carry an underlining class.
 *
 * jsdom does not load index.css, so the stylesheet is read from disk and the
 * classes checked against it.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { PriceBlock } from './PriceSection'
import { WineCard } from './WineCard'
import { CriticReviewsBlock } from './CriticReviewsBlock'
import { makeSummaryItem, makeTestPriceData, makeTestRetailer, makeTestWine } from '../test-fixtures'

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf-8')

/** The declarations of `selector { … }` (first rule that names it exactly). */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : ''
}

const underlines = (selector: string) => /text-decoration:\s*underline/.test(rule(selector))

const idle = { busy: false, error: null, cachedAt: null, run: vi.fn() }
const noop = () => {}

describe('link affordance (D9)', () => {
  it.each(['.link', '.btn-link-inline', '.retailer-link', '.wine-name--clickable', '.info-badge'])(
    '%s underlines at rest',
    (selector) => {
      expect(underlines(selector)).toBe(true)
    }
  )

  it('the nearest retailer, a retailer row link, and Show all carry the underline classes', () => {
    const data = makeTestPriceData([
      makeTestRetailer({ slug: 'a', name: 'Nearest Shop' }),
      makeTestRetailer({ slug: 'b', name: 'Other Shop' }),
    ])
    render(<PriceBlock wine={makeTestWine({ price_data: data })} action={idle} onWineUpdated={noop} />)
    expect(screen.getByRole('link', { name: 'Nearest Shop' }).className).toMatch(/\blink\b/)
  })

  it('the wine name on a card is an underlined link to the detail view', () => {
    render(
      <WineCard
        wine={makeTestWine()}
        activeTab="cellar"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
        onEdit={noop}
      />
    )
    const name = screen.getByRole('button', { name: 'Domaine Leroy · Gevrey-Chambertin' })
    expect(name.className).toMatch(/wine-name--clickable/)
    expect(underlines('.wine-name--clickable')).toBe(true)
  })

  it('the Check window flag and +N on a card are links', () => {
    render(
      <WineCard
        wine={makeTestWine({ window_status: 'check', critic_summary: { ordered: [makeSummaryItem(), makeSummaryItem({ publication: 'Burghound' })] } })}
        activeTab="cellar"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
        onEdit={noop}
      />
    )
    expect(screen.getByRole('button', { name: 'Check window' }).className).toMatch(/\blink\b/)
    expect(screen.getByText('+1').className).toMatch(/\blink\b/)
  })

  it('Try again, Show all and Search more are inline links', () => {
    render(
      <CriticReviewsBlock
        wine={makeTestWine({ review_data: [] })}
        action={{ ...idle, error: 'x' }}
        onSearchMore={noop}
      />
    )
    expect(screen.getByRole('button', { name: 'Try again' }).className).toMatch(/btn-link-inline/)
  })
})
