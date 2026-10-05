import { extractPackFormat, isNonStandardFormat, describeFormat, pageStatedFormat } from './pack-format'

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

// 2026-10-04 — Franck Balthazar's Cornas came back with every listing
// flagged "12L": the producer's name is also a 12-litre bottle.
describe('extractPackFormat — the wine\'s own name is never a format', () => {
  const balthazar = ['Franck Balthazar', null, 'Chaillot']

  it('does not read a producer named Balthazar as a 12L bottle', () => {
    for (const title of ['Franck Balthazar Cornas Chaillot 2020', 'Balthazar, Franck - Cornas Chaillot 2018']) {
      const f = extractPackFormat(title, balthazar)
      expect(f).toEqual({ pack_quantity: 1, bottle_size_ml: null })
      expect(isNonStandardFormat(f)).toBe(false)
    }
  })

  it('still reads a real size on that wine', () => {
    expect(extractPackFormat('Franck Balthazar Cornas Chaillot 2020 1.5L', balthazar)).toEqual({ pack_quantity: 1, bottle_size_ml: 1500 })
    expect(extractPackFormat('Franck Balthazar Cornas Chaillot 2020 Magnum', balthazar).bottle_size_ml).toBe(1500)
    expect(extractPackFormat('Franck Balthazar Cornas 2020 6 x 750ml', balthazar).pack_quantity).toBe(6)
  })

  it('does not read CVNE "Imperial" as a 6L bottle', () => {
    expect(extractPackFormat('CVNE Imperial Gran Reserva Rioja 2016', ['CVNE', 'Imperial', null]).bottle_size_ml).toBeNull()
  })

  it('still reads a real Balthazar when it is not the wine\'s name', () => {
    expect(extractPackFormat('Bollinger Special Cuvee Brut Balthazar', ['Bollinger', 'Special Cuvée', null]).bottle_size_ml).toBe(12000)
  })

  it('applies to the product-page headline too', () => {
    expect(pageStatedFormat('<h1>Franck Balthazar Cornas Chaillot 2020</h1>', balthazar)).toBeNull()
    expect(pageStatedFormat('<h1>Franck Balthazar Cornas Chaillot 2020 (1.5L)</h1>', balthazar)).toEqual({ pack_quantity: 1, bottle_size_ml: 1500 })
  })
})
