import { cardBadge, labelFor, yearTagOf } from './criticBadge'
import { makeSummaryItem } from '../test-fixtures'

describe('cardBadge (Phase 12.1 WI-10)', () => {
  it('is the first score in the backend order, with its abbreviation', () => {
    const b = cardBadge({ ordered: [makeSummaryItem({ publication: 'Wine Advocate', score: 96 }), makeSummaryItem({ publication: 'Vinous' })] })
    expect(b).toMatchObject({ score: '96', label: 'WA', yearTag: null, additional: 1, known: true })
  })

  it('tags a score from another vintage with a muted year', () => {
    const b = cardBadge({ ordered: [makeSummaryItem({ publication: 'Vinous', score: 93, vintage: 2017, same_vintage: false })] })
    expect(b!.yearTag).toBe("'17")
  })

  it('no tag when the page stated no vintage', () => {
    expect(yearTagOf({ same_vintage: false, vintage: null })).toBeNull()
  })

  it('is null for no scores', () => {
    expect(cardBadge({ ordered: [] })).toBeNull()
  })

  it('shows an unknown source as its raw text, truncated, flagged unknown', () => {
    const item = makeSummaryItem({ publication: 'Some Very Long Wine Blog Name', known_publication: false })
    expect(labelFor(item)).toBe('Some Very Lo…')
    expect(cardBadge({ ordered: [item] })!.known).toBe(false)
  })

  it('keeps a decimal score as is', () => {
    expect(cardBadge({ ordered: [makeSummaryItem({ score: 17.5 })] })!.score).toBe('17.5')
  })
})
