import { bottlingDifference, bottlingBadge, isExactBottling, modifierName, type BottlingWine } from '@shared/utils/bottling-difference'

const base = { cuvee: null, vineyard: null, quality_classification: null }
const vietti: BottlingWine = { producer: 'Vietti', denomination: 'Barolo', vintage: 2021, ...base }
const marcoux: BottlingWine = { producer: 'Domaine de Marcoux', denomination: 'Châteauneuf-du-Pape', vintage: 2019, ...base }

// Real stored URLs from the 2026-10 database (Phase 12.2 §2).
const URLS = {
  viettiCastiglione: 'https://whwc.com/vietti-barolo-castiglione-2021/?srsltid=AU7gw4VrkfJKD',
  viettiPlain: 'https://winelibrary.com/wines/nebbiolo/2021-vietti-barolo-147735?srsltid=AU7gw4Wc0VObTmR9',
  viettiMonvigliero: 'https://www.jjbuckley.com/wine/2021-vietti-barolo-monvigliero/2021-1879291-1500/?srsltid=AU7gw4UAL6RQx8STqX',
  marcouxVV: 'https://nyc.flatiron-wines.com/products/domaine-de-marcoux-chateauneuf-du-pape-vieilles-vignes-2010-ack083125-wk35-a',
  marcouxPlain: 'https://winelibrary.com/wines/syrah/2019-domaine-de-marcoux-chateauneuf-du-pape-125984',
  marcouxJJ: 'https://www.jjbuckley.com/wine/2017-domaine-de-marcoux-chateauneuf-du-pape/2017-12386-750/',
}

describe('bottlingDifference — modifiers count in both directions (Phase 12.2 D8)', () => {
  it('Vietti plain Barolo: the plain Wine Library page is exact', () => {
    expect(isExactBottling(bottlingDifference({ url: URLS.viettiPlain }, vietti))).toBe(true)
  })

  it('Vietti plain Barolo: Castiglione and Monvigliero pages add a name the wine never claimed', () => {
    const c = bottlingDifference({ url: URLS.viettiCastiglione }, vietti)
    const m = bottlingDifference({ url: URLS.viettiMonvigliero }, vietti)
    expect(c.extra).toEqual(['castiglione'])
    expect(m.extra).toEqual(['monvigliero'])
    expect(bottlingBadge(c)).toBe("Names Castiglione — yours doesn't")
  })

  it('answering Castiglione flips the verdict with no new data: yours names it, the Monvigliero page does not', () => {
    const yours: BottlingWine = { ...vietti, vineyard: 'Castiglione' }
    expect(isExactBottling(bottlingDifference({ url: URLS.viettiCastiglione }, yours))).toBe(true)
    const m = bottlingDifference({ url: URLS.viettiMonvigliero }, yours)
    expect(m.extra).toEqual(['monvigliero'])
    expect(m.missing).toEqual(['castiglione'])
    // The plain page now omits the name the wine records.
    const plain = bottlingDifference({ url: URLS.viettiPlain }, yours)
    expect(plain.extra).toEqual([])
    expect(plain.missing).toEqual(['castiglione'])
    expect(bottlingBadge(plain)).toBe("Doesn't name Castiglione — yours does")
  })

  it('Marcoux with no cuvée: the Flatiron Vieilles Vignes page is a different bottling', () => {
    const d = bottlingDifference({ url: URLS.marcouxVV }, marcoux)
    expect([...d.extra].sort()).toEqual(['vieilles', 'vignes'])
    expect(isExactBottling(d)).toBe(false)
    expect(isExactBottling(bottlingDifference({ url: URLS.marcouxPlain }, marcoux))).toBe(true)
    expect(isExactBottling(bottlingDifference({ url: URLS.marcouxJJ }, marcoux))).toBe(true)
  })

  it('a wine that records Vieilles Vignes: the plain page omits it', () => {
    const vv: BottlingWine = { ...marcoux, cuvee: 'Vieilles Vignes' }
    expect(isExactBottling(bottlingDifference({ url: URLS.marcouxVV }, vv))).toBe(true)
    expect([...bottlingDifference({ url: URLS.marcouxPlain }, vv).missing].sort()).toEqual(['vieilles', 'vignes'])
  })

  it("uses the model-reported page bottling as a fact: it can supply a name the slug lacks, or confirm the wine's own", () => {
    const slugOnly = 'https://shop.example/products/vietti-barolo-2021'
    expect(bottlingDifference({ url: slugOnly, pageBottling: 'Rocche' }, vietti).extra).toEqual(['rocche'])
    const yours: BottlingWine = { ...vietti, vineyard: 'Rocche' }
    expect(bottlingDifference({ url: slugOnly }, yours).missing).toEqual(['rocche'])
    expect(bottlingDifference({ url: slugOnly, pageBottling: 'Rocche' }, yours).missing).toEqual([])
  })

  it('"plain": absent words count against nothing, and added words stay a different bottling', () => {
    const plain: BottlingWine = { ...vietti, bottling_plain: true }
    expect(bottlingDifference({ url: URLS.viettiMonvigliero }, plain).extra).toEqual(['monvigliero'])
    expect(bottlingDifference({ url: URLS.viettiPlain }, plain).missing).toEqual([])
  })

  it('plural vineyard names are one word in both directions', () => {
    const girardin: BottlingWine = {
      producer: 'Vincent Girardin',
      denomination: 'Chassagne-Montrachet 1er Cru',
      vintage: 2017,
      cuvee: null,
      vineyard: 'Les Cailleret',
      quality_classification: 'Premier Cru',
    }
    const d = bottlingDifference({ title: 'Vincent Girardin Chassagne-Montrachet 1er Cru Les Caillerets 2017' }, girardin)
    expect(isExactBottling(d)).toBe(true)
  })
})

describe('bottlingDifference — false positives are costly, so ordinary shop words are not names', () => {
  it.each([
    ['Domaine de Marcoux Chateauneuf-du-Pape Rouge 2019 750ml', marcoux],
    ['Vietti Barolo DOCG Nebbiolo Piedmont Italy Red Wine 2021', vietti],
    ['2021 Vietti Barolo - Buy Online | Fine Wine Store', vietti],
    ['Vietti Barolo 2021 1.5L Magnum', vietti],
  ])('%s is exact', (title, wine) => {
    expect(isExactBottling(bottlingDifference({ title }, wine))).toBe(true)
  })

  it('ignores the host, the query string and numeric ids', () => {
    const d = bottlingDifference({ url: 'https://www.zachys.com/products/vietti-barolo-2021-750ml?srsltid=Abcdef123&utm=zzz' }, vietti)
    expect(isExactBottling(d)).toBe(true)
  })

  it('notes a tier word omitted or added, without calling it a different bottling', () => {
    const rioja: BottlingWine = {
      producer: 'La Rioja Alta',
      denomination: 'Rioja',
      vintage: 2015,
      cuvee: 'Gran Reserva 904',
      vineyard: null,
      quality_classification: null,
    }
    const d = bottlingDifference({ title: 'La Rioja Alta Rioja 904 2015' }, rioja)
    expect(d.tierNote).toBe("Doesn't say Gran Reserva")
    const added = bottlingDifference({ title: 'La Rioja Alta Rioja Gran Reserva 2015' }, { ...rioja, cuvee: null })
    expect(added.tierNote).toBe('Says Gran Reserva')
    expect(isExactBottling(added)).toBe(true)
  })

  it('names a modifier from its words', () => {
    expect(modifierName(['vieilles', 'vignes'])).toBe('Vieilles Vignes')
  })
})
