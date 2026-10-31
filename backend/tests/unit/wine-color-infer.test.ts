import { parseColourReply, type ColourCandidate } from '../../modules/wine-color/infer'

const wine = (id: string): ColourCandidate => ({ id, producer: 'P', denomination: 'D', cuvee: null, vineyard: null, quality_classification: null, region: null, grape_varieties: null })

describe('Colour inference reply (Phase 12.4 WI-6)', () => {
  it('reads each wine’s colour and reason, in the batch’s order', () => {
    const raw = '{"wines":[{"id":"b","wine_color":"white","reason":"Chablis is white only"},{"id":"a","wine_color":"red","reason":"Barolo"}]}'
    expect(parseColourReply(raw, [wine('a'), wine('b')])).toEqual([
      { id: 'a', wine_color: 'red', reason: 'Barolo' },
      { id: 'b', wine_color: 'white', reason: 'Chablis is white only' },
    ])
  })

  it('null stays null; an unknown colour word is null; a skipped wine says so', () => {
    const raw = '```json\n{"wines":[{"id":"a","wine_color":null,"reason":"CdP makes both"},{"id":"b","wine_color":"orange","reason":"?"}]}\n```'
    expect(parseColourReply(raw, [wine('a'), wine('b'), wine('c')]).map(p => p.wine_color)).toEqual([null, null, null])
    expect(parseColourReply(raw, [wine('c')])[0].reason).toBe('no answer for this wine')
  })

  it('an unreadable reply proposes nothing', () => {
    expect(parseColourReply('not json', [wine('a')])).toEqual([{ id: 'a', wine_color: null, reason: 'no answer for this wine' }])
  })
})
