import { buildCriticSummary } from '@shared/utils/critic-summary'
import { review, score } from '../helpers/review-fixtures'

const order = (rd: Parameters<typeof buildCriticSummary>[0], vintage: number | null) =>
  buildCriticSummary(rd, vintage).ordered.map((i) => `${i.publication} ${i.score}${i.vintage ? ` '${i.vintage}` : ''}`)

describe('buildCriticSummary (Phase 12.1 WI-10, D13)', () => {
  it('2019 wine: trusted same-vintage outranks a higher untrusted same-vintage score', () => {
    const rd = [
      review('a', 2019, [score('Jeb Dunnuck', 95)]),
      review('b', 2019, [score('Burghound', 91)]),
      review('c', 2017, [score('Vinous', 93)]),
    ]
    const summary = buildCriticSummary(rd, 2019)
    expect(summary.ordered.map((i) => i.publication)).toEqual(['Burghound', 'Jeb Dunnuck', 'Vinous'])
    expect(summary.ordered.map((i) => i.tier)).toEqual([1, 2, 3])
  })

  it('a same-vintage score from an untrusted source outranks a trusted score for another vintage', () => {
    const rd = [review('a', 2017, [score('Vinous', 93)]), review('b', 2019, [score('Jeb Dunnuck', 95)])]
    expect(buildCriticSummary(rd, 2019).ordered[0]).toMatchObject({ publication: 'Jeb Dunnuck', tier: 2, same_vintage: true })
  })

  it('with no same-vintage score, trusted other-vintage leads, tagged with its year', () => {
    const rd = [review('a', 2017, [score('Vinous', 93)]), review('b', 2016, [score('Wine Spectator', 92)])]
    const s = buildCriticSummary(rd, 2019)
    expect(s.ordered.map((i) => i.publication)).toEqual(['Vinous', 'Wine Spectator'])
    expect(s.ordered[0]).toMatchObject({ vintage: 2017, same_vintage: false, trusted: true, tier: 3 })
  })

  it('tier 4 is everything else, highest first', () => {
    const rd = [
      review('a', 2017, [score('James Suckling', 94)]),
      review('b', 2016, [score('Jeb Dunnuck', 96)]),
      review('c', 2018, [score('Some Blog', 97, { known: false })]),
    ]
    const s = buildCriticSummary(rd, 2019)
    expect(s.ordered.map((i) => i.publication)).toEqual(['Some Blog', 'Jeb Dunnuck', 'James Suckling'])
    expect(new Set(s.ordered.map((i) => i.tier))).toEqual(new Set([4]))
  })

  it('dedupes per publication after classification: a 2019 score is not hidden by a 2017 one', () => {
    const rd = [review('a', 2017, [score('Wine Advocate', 97)]), review('b', 2019, [score('Wine Advocate', 92)])]
    const s = buildCriticSummary(rd, 2019)
    expect(s.ordered).toHaveLength(1)
    expect(s.ordered[0]).toMatchObject({ publication: 'Wine Advocate', score: 92, vintage: 2019, same_vintage: true })
  })

  it('a page with no stated vintage is not-same, untagged, never rejected', () => {
    const s = buildCriticSummary([review('a', null, [score('Vinous', 93)])], 2019)
    expect(s.ordered).toEqual([
      { publication: 'Vinous', score: 93, vintage: null, same_vintage: false, trusted: true, tier: 3, known_publication: true },
    ])
  })

  it('a legacy blob (no page_vintage field at all) orders by trust then score, with no year tags', () => {
    const legacy = review('a', 2019, [score('Jeb Dunnuck', 95), score('Burghound', 91)])
    delete (legacy as Partial<typeof legacy>).page_vintage
    const s = buildCriticSummary([legacy], 2019)
    expect(s.ordered.map((i) => i.publication)).toEqual(['Burghound', 'Jeb Dunnuck'])
    expect(s.ordered.every((i) => i.vintage === null && !i.same_vintage)).toBe(true)
  })

  it('NV wine: a page stating no vintage counts as same', () => {
    const s = buildCriticSummary([review('a', null, [score('Vinous', 93)])], null)
    expect(s.ordered[0]).toMatchObject({ same_vintage: true, tier: 1 })
  })

  it('NV wine: a page stating a vintage is not same', () => {
    const s = buildCriticSummary([review('a', 2015, [score('Vinous', 93)])], null)
    expect(s.ordered[0]).toMatchObject({ same_vintage: false, tier: 3 })
  })

  it('breaks score ties by known_publication, then source order', () => {
    const rd = [
      review('a', 2019, [score('Raw Blog', 92, { known: false })]),
      review('b', 2019, [score('Jeb Dunnuck', 92)]),
      review('c', 2019, [score('James Suckling', 92)]),
    ]
    expect(buildCriticSummary(rd, 2019).ordered.map((i) => i.publication)).toEqual([
      'Jeb Dunnuck',
      'James Suckling',
      'Raw Blog',
    ])
  })

  it('an unknown publication is never trusted, even if its raw text matches a trusted name', () => {
    const s = buildCriticSummary([review('a', 2019, [score('Vinous', 99, { known: false })])], 2019)
    expect(s.ordered[0].trusted).toBe(false)
  })

  it('does not average or alter scores', () => {
    const rd = [review('a', 2019, [score('Vinous', 93), score('Burghound', 91)])]
    expect(buildCriticSummary(rd, 2019).ordered.map((i) => i.score)).toEqual([93, 91])
  })

  it('is empty for no review data', () => {
    expect(order(null, 2019)).toEqual([])
    expect(order([], 2019)).toEqual([])
  })

  it('honours an overridden trusted set', () => {
    const rd = [review('a', 2019, [score('Jeb Dunnuck', 95), score('Burghound', 91)])]
    const s = buildCriticSummary(rd, 2019, ['Jeb Dunnuck'])
    expect(s.ordered.map((i) => i.publication)).toEqual(['Jeb Dunnuck', 'Burghound'])
  })
})
