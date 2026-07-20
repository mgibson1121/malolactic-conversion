import { extractPackFormat, isNonStandardFormat, describeFormat } from './pack-format'

describe('extractPackFormat', () => {
  it('treats a plain title with no size/pack wording as a standard single bottle', () => {
    const f = extractPackFormat('Domaine Rousseau Gevrey-Chambertin 2019')
    expect(f).toEqual({ pack_quantity: 1, bottle_size_ml: null })
    expect(isNonStandardFormat(f)).toBe(false)
  })

  it('does not flag an explicitly stated standard 750ml bottle', () => {
    const f = extractPackFormat('Domaine Rousseau Gevrey-Chambertin 2019 750ml')
    expect(f).toEqual({ pack_quantity: 1, bottle_size_ml: 750 })
    expect(isNonStandardFormat(f)).toBe(false)
  })

  it('parses a metric liter size (magnum-equivalent) written as "1.5L"', () => {
    const f = extractPackFormat('Domaine Rousseau Gevrey-Chambertin 2019 1.5L')
    expect(f.bottle_size_ml).toBe(1500)
    expect(isNonStandardFormat(f)).toBe(true)
    expect(describeFormat(f)).toBe('1.5L')
  })

  it('parses the named format "Magnum" as 1500ml', () => {
    const f = extractPackFormat('Domaine Rousseau Gevrey-Chambertin 2019 Magnum')
    expect(f.bottle_size_ml).toBe(1500)
    expect(isNonStandardFormat(f)).toBe(true)
  })

  it('parses a half bottle as 375ml', () => {
    const f = extractPackFormat('Domaine Rousseau Gevrey-Chambertin 2019 375ml Half Bottle')
    expect(f.bottle_size_ml).toBe(375)
    expect(isNonStandardFormat(f)).toBe(true)
    expect(describeFormat(f)).toBe('375ml')
  })

  it('parses "6-Pack" and "6 Pack" as a 6-bottle pack', () => {
    expect(extractPackFormat('Domaine Rousseau Gevrey-Chambertin 2019 6-Pack').pack_quantity).toBe(6)
    expect(extractPackFormat('Domaine Rousseau Gevrey-Chambertin 2019 6 Pack').pack_quantity).toBe(6)
  })

  it('parses "Case of 6"', () => {
    const f = extractPackFormat('Domaine Rousseau Gevrey-Chambertin 2019 Case of 6')
    expect(f.pack_quantity).toBe(6)
    expect(isNonStandardFormat(f)).toBe(true)
    expect(describeFormat(f)).toBe('6-pack')
  })

  it('parses a combined "6 x 750ml" bundle as both pack quantity and bottle size', () => {
    const f = extractPackFormat('Domaine Rousseau Gevrey-Chambertin 2019 6 x 750ml')
    expect(f).toEqual({ pack_quantity: 6, bottle_size_ml: 750 })
    expect(describeFormat(f)).toBe('6-pack')
  })

  it('parses a combined non-standard bundle "6 x 375ml"', () => {
    const f = extractPackFormat('Domaine Rousseau Gevrey-Chambertin 2019 6 x 375ml')
    expect(f).toEqual({ pack_quantity: 6, bottle_size_ml: 375 })
    expect(describeFormat(f)).toBe('6 x 375ml')
  })

  it('does not mistake "1er Cru" or "Grand Cru" designations for a size', () => {
    expect(extractPackFormat('Raveneau Chablis 1er Cru 2021').bottle_size_ml).toBeNull()
    expect(extractPackFormat('Domaine Leflaive Bâtard-Montrachet Grand Cru 2023').bottle_size_ml).toBeNull()
  })
})
