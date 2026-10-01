import type { WineEntry } from '@shared/types'
import { findDuplicate, type DuplicateCheckInput } from '@shared/utils/duplicate-match'

function makeScan(overrides: Partial<DuplicateCheckInput> = {}): DuplicateCheckInput {
  return {
    producer: 'Domaine Leroy',
    vintage: 2019,
    denomination: 'Gevrey-Chambertin',
    ...overrides,
  }
}

function makeWine(overrides: Partial<WineEntry> = {}): WineEntry {
  return {
    id: 'wine-1',
    producer: 'Domaine Leroy',
    denomination: 'Gevrey-Chambertin',
    vintage: 2019,
    region: 'Burgundy',
    quality_classification: null,
    vineyard: null,
    cuvee: null,
    grape_varieties: null,
    ...overrides,
  } as WineEntry
}

describe('findDuplicate', () => {
  it('is a confident duplicate when producer, denomination, and vintage all match', () => {
    const result = findDuplicate(makeScan(), [makeWine()])
    expect(result).toEqual({ kind: 'duplicate', wine: makeWine() })
  })

  it('is none when producer differs', () => {
    const result = findDuplicate(makeScan({ producer: 'Domaine Rousseau' }), [makeWine()])
    expect(result.kind).toBe('none')
  })

  it('is none when denomination differs', () => {
    const result = findDuplicate(makeScan({ denomination: 'Chambolle-Musigny' }), [makeWine()])
    expect(result.kind).toBe('none')
  })

  it('is a vintage_mismatch — not a duplicate — when producer/denomination match but vintage differs', () => {
    const existing = makeWine({ vintage: 2021 })
    const result = findDuplicate(makeScan({ vintage: 2019 }), [existing])
    expect(result).toEqual({ kind: 'vintage_mismatch', wine: existing })
  })

  it('is none when vintage is unknown on either side (not enough to call it either way)', () => {
    const existing = makeWine({ vintage: null })
    const result = findDuplicate(makeScan({ vintage: 2019 }), [existing])
    expect(result.kind).toBe('none')
  })

  it('is none for an empty collection', () => {
    expect(findDuplicate(makeScan(), []).kind).toBe('none')
  })

  it('is none when the scan has neither producer nor denomination', () => {
    const result = findDuplicate(makeScan({ producer: null, denomination: null }), [makeWine()])
    expect(result.kind).toBe('none')
  })
})

// 2026-09-30, Phase 12 QA: the regular Sesta di Sopra Brunello 2018 was
// offered as a duplicate of the Magistra 2018 the developer already had.
describe('findDuplicate — bottling', () => {
  const magistra = makeWine({
    id: 'magistra', producer: 'Sesta di Sopra', denomination: 'Brunello di Montalcino', vintage: 2018,
    cuvee: 'Magistra', quality_classification: 'Magistra',
  })
  const regular = { producer: 'Sesta di Sopra', denomination: 'Brunello di Montalcino', vintage: 2018 }

  it('is still a possible duplicate when only one side names a bottling — and says what differs', () => {
    expect(findDuplicate(regular, [magistra])).toEqual({
      kind: 'duplicate', wine: magistra, bottling: { existing: 'Magistra', scanned: null },
    })
  })

  it('is not a duplicate at all when both sides name different bottlings', () => {
    expect(findDuplicate({ ...regular, cuvee: 'Vigna del Lago' }, [magistra]).kind).toBe('none')
  })

  it('is a plain duplicate when both sides name the same bottling', () => {
    expect(findDuplicate({ ...regular, cuvee: 'Magistra' }, [magistra])).toEqual({ kind: 'duplicate', wine: magistra })
  })

  it('prefers an exact bottling match over one that differs, whatever the collection order', () => {
    const plain = makeWine({ id: 'plain', producer: 'Sesta di Sopra', denomination: 'Brunello di Montalcino', vintage: 2018 })
    expect(findDuplicate(regular, [magistra, plain])).toEqual({ kind: 'duplicate', wine: plain })
    expect(findDuplicate({ ...regular, cuvee: 'Magistra' }, [plain, magistra])).toEqual({ kind: 'duplicate', wine: magistra })
  })
})
