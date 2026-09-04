import type { WineEntry } from '@shared/types'
import { findDuplicate } from './duplicateMatch'
import type { LabelScanResult } from '../api'

function makeScan(overrides: Partial<LabelScanResult> = {}): LabelScanResult {
  return {
    producer: 'Domaine Leroy',
    vintage: 2019,
    region: 'Burgundy',
    denomination: 'Gevrey-Chambertin',
    quality_classification: null,
    vineyard: null,
    cuvee: null,
    grape_varieties: null,
    wine_color: null,
    missing_tier1_fields: [],
    raw_response: '',
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
