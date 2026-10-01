import {
  scoreMatch,
  isAcceptableMatch,
  compareByMatchQuality,
  extractVintage,
  normalize,
  significantWords,
  isRelevantMatch,
  stripHonorifics,
  stripLegalForm,
  buildDistinguishingQuery,
  bottlingNameWords,
  identityOf,
  mentionsProducer,
  type WineIdentity,
  type MatchCandidate,
} from '@shared/utils/wine-match'

// Every fixture below is drawn from a real result stored in backend/db/wine.db
// during the 2026-08-04 test batch — see
// docs/sessions/2026-08-04-core-functionality-defect-taxonomy.md. These are
// regression cases, not invented examples.

const grandVillage: WineIdentity = {
  producer: 'Grand Village',
  denomination: 'Vin de France',
  vintage: 2022,
}

const jeanMarcVincent: WineIdentity = {
  producer: 'Domaine Jean-Marc Vincent',
  denomination: 'Santenay',
  vintage: 2022,
}

const charlesAudoin: WineIdentity = {
  producer: 'Domaine Charles Audoin',
  denomination: 'Marsannay',
  vintage: 2022,
}

const drappier: WineIdentity = {
  producer: 'Drappier',
  denomination: 'Champagne',
  vintage: 2012,
  cuvee: 'Grande Sendrée',
}

describe('extractVintage', () => {
  it('reads a 4-digit year from a title', () => {
    expect(extractVintage('Gour de Chaule Gigondas Cuvee Tradition 2010')).toBe(2010)
  })

  it('reads a year from a URL slug', () => {
    expect(extractVintage('https://whwc.com/lafleur-pomerol-2016/')).toBe(2016)
  })

  it('ignores numbers that are not plausible vintages', () => {
    expect(extractVintage('750ml bottle, 14.5% abv, item 1303460')).toBeNull()
  })

  it('returns null when no year is present', () => {
    expect(extractVintage('Domaine Bessin-Tremblay Chablis')).toBeNull()
  })
})

describe('scoreMatch — producer', () => {
  // THE regression case: nine Chateau Lafleur scores were stored against
  // Grand Village because the old matcher accepted any one producer word
  // found anywhere in title + snippet, and the Lafleur page mentions
  // "Grand Village" in its body copy (same family owns both estates).
  it('rejects the Chateau Lafleur page for Grand Village', () => {
    const candidate: MatchCandidate = {
      title: 'Chateau Lafleur Pomerol 2016',
      url: 'https://whwc.com/lafleur-pomerol-2016/',
      snippet:
        'The Guinaudeau family, also behind Chateau Grand Village, produce this Pomerol...',
    }
    const v = scoreMatch(candidate, grandVillage)
    expect(v.producer).toBe('mismatch')
    expect(isAcceptableMatch(v)).toBe(false)
  })

  it('ignores the snippet when judging the producer', () => {
    // Producer appears ONLY in the snippet — not enough. This is the rule
    // that closes the Lafleur class of false positive.
    const v = scoreMatch(
      { title: 'Some Other Wine 2022', snippet: 'Domaine Charles Audoin also makes...' },
      charlesAudoin
    )
    expect(v.producer).toBe('mismatch')
  })

  it('matches when every significant producer word is in the title', () => {
    const v = scoreMatch(
      { title: 'Jean-Marc Vincent Santenay Rouge 1er Cru Gravieres 2022' },
      jeanMarcVincent
    )
    expect(v.producer).toBe('match')
  })

  it('ignores the Domaine honorific when matching the producer', () => {
    // Morrell lists this wine without "Domaine" — the old quoted query and
    // the old matcher both required it.
    const v = scoreMatch({ title: 'Jean-Marc Vincent Santenay 2022' }, jeanMarcVincent)
    expect(v.producer).toBe('match')
  })

  it('reads the producer out of a URL slug when the title is unhelpful', () => {
    const v = scoreMatch(
      {
        title: 'Product Detail',
        url: 'https://www.benchmarkwine.com/products/154340-charles-audoin-marsannay-clos-du-roy-2020',
      },
      charlesAudoin
    )
    expect(v.producer).toBe('match')
  })

  it('returns unknown when only some producer words are present', () => {
    const v = scoreMatch({ title: 'Vincent Rully 2022' }, jeanMarcVincent)
    expect(v.producer).toBe('unknown')
    expect(isAcceptableMatch(v)).toBe(false)
  })

  it('rejects a different producer at the same appellation', () => {
    // Sokolin returned this for Gour de Chaule.
    const gourDeChaule: WineIdentity = {
      producer: 'Gour de Chaule',
      denomination: 'Gigondas',
      vintage: 2022,
    }
    const v = scoreMatch(
      {
        title: '2016 Famille Perrin Gigondas Domaine du Clos des Tourelles',
        url: 'https://www.sokolin.com/2016-famille-perrin-gigondas-domaine-du-clos-des-tourelles',
      },
      gourDeChaule
    )
    expect(v.producer).toBe('mismatch')
    expect(isAcceptableMatch(v)).toBe(false)
  })
})

describe('scoreMatch — denomination', () => {
  it('matches on a significant appellation word', () => {
    const v = scoreMatch({ title: 'Jean-Marc Vincent Santenay 2022' }, jeanMarcVincent)
    expect(v.denomination).toBe('match')
  })

  it('accepts corroboration from the snippet', () => {
    const v = scoreMatch(
      { title: 'Jean-Marc Vincent Rouge 2022', snippet: 'A village Santenay from...' },
      jeanMarcVincent
    )
    expect(v.denomination).toBe('match')
  })

  it('is unknown, not a match, when the appellation is absent', () => {
    const v = scoreMatch({ title: 'Charles Audoin Rouge 2022' }, charlesAudoin)
    expect(v.denomination).toBe('unknown')
  })

  it('does not match a short word inside a longer one', () => {
    // "Vin de France" reduces to ["vin", "france"], and the old substring
    // check let "vin" match inside "vintage".
    const v = scoreMatch({ title: 'Grand Village 2022 vintage release' }, grandVillage)
    expect(v.denomination).toBe('unknown')
  })
})

describe('scoreMatch — bottling', () => {
  it('is unknown when the wine records no cuvee, vineyard or classification', () => {
    // All 14 wines in the 2026-08-04 batch are in this state. The honest
    // answer is "can't tell", not "fine".
    const v = scoreMatch({ title: 'Charles Audoin Marsannay Clos du Roy 2020' }, charlesAudoin)
    expect(v.bottling).toBe('unknown')
  })

  it('matches when the cuvee is present', () => {
    const v = scoreMatch({ title: 'Drappier Champagne Grande Sendree 2012' }, drappier)
    expect(v.bottling).toBe('match')
  })

  it('mismatches when the wine has a cuvee the page does not', () => {
    const v = scoreMatch({ title: 'Drappier Carte d\'Or Brut Champagne' }, drappier)
    expect(v.bottling).toBe('mismatch')
    expect(isAcceptableMatch(v)).toBe(false)
  })

  it('folds diacritics before comparing the cuvee', () => {
    const v = scoreMatch({ title: 'Drappier Champagne Grande Sendrée 2012' }, drappier)
    expect(v.bottling).toBe('match')
  })
})

describe('scoreMatch — vintage', () => {
  it('matches an identical year and reports a zero gap', () => {
    const v = scoreMatch({ title: 'Jean-Marc Vincent Santenay 2022' }, jeanMarcVincent)
    expect(v.vintage).toBe('match')
    expect(v.vintageGap).toBe(0)
  })

  it('reports a mismatch with the gap rather than rejecting', () => {
    // Benchmark's only Charles Audoin page is the 2020. Two years off is
    // still informative — it must be kept and labelled, not binned.
    const v = scoreMatch(
      { title: 'Charles Audoin Marsannay Clos du Roy 2020' },
      charlesAudoin
    )
    expect(v.vintage).toBe('mismatch')
    expect(v.vintageGap).toBe(2)
    expect(v.candidateVintage).toBe(2020)
    expect(isAcceptableMatch(v)).toBe(true) // vintage NEVER gates acceptance
  })

  it('prefers a page-stated vintage over one parsed from the title', () => {
    const v = scoreMatch(
      { title: 'Charles Audoin Marsannay 2020 vintage report', statedVintage: 2022 },
      charlesAudoin
    )
    expect(v.candidateVintage).toBe(2022)
    expect(v.vintage).toBe('match')
  })

  it('is unknown when neither side states a year', () => {
    const v = scoreMatch(
      { title: 'Charles Audoin Marsannay' },
      { ...charlesAudoin, vintage: null }
    )
    expect(v.vintage).toBe('unknown')
    expect(v.vintageGap).toBeNull()
  })

  it('is unknown for a non-vintage wine even when the page states a year', () => {
    // NV Champagne: a disgorgement or base year on the page is not our
    // vintage, and must not be treated as one.
    const v = scoreMatch(
      { title: 'Drappier Carte d\'Or Brut NV, base 2019' },
      { producer: 'Drappier', denomination: 'Champagne', vintage: null }
    )
    expect(v.vintage).toBe('unknown')
    expect(v.vintageGap).toBeNull()
  })
})

describe('compareByMatchQuality', () => {
  const wine = charlesAudoin

  it('prefers the exact vintage over a near one', () => {
    const exact = scoreMatch({ title: 'Charles Audoin Marsannay 2022' }, wine)
    const near = scoreMatch({ title: 'Charles Audoin Marsannay 2020' }, wine)
    expect(compareByMatchQuality(exact, near)).toBeLessThan(0)
    expect([near, exact].sort(compareByMatchQuality)[0]).toBe(exact)
  })

  it('prefers a nearer vintage over a distant one', () => {
    const near = scoreMatch({ title: 'Charles Audoin Marsannay 2021' }, wine)
    const distant = scoreMatch({ title: 'Charles Audoin Marsannay 2003' }, wine)
    expect(compareByMatchQuality(near, distant)).toBeLessThan(0)
  })

  it('prefers a known vintage over an unknown one', () => {
    const known = scoreMatch({ title: 'Charles Audoin Marsannay 2020' }, wine)
    const unknown = scoreMatch({ title: 'Charles Audoin Marsannay' }, wine)
    expect(compareByMatchQuality(known, unknown)).toBeLessThan(0)
  })

  it('prefers a confirmed bottling over a contradicted one, vintage held equal', () => {
    const confirmed = scoreMatch({ title: 'Drappier Champagne Grande Sendree 2012' }, drappier)
    const contradicted = scoreMatch({ title: 'Drappier Champagne Brut 2012' }, drappier)
    expect(confirmed.bottling).toBe('match')
    expect(contradicted.bottling).toBe('mismatch')
    expect(confirmed.vintage).toBe(contradicted.vintage)
    expect(compareByMatchQuality(confirmed, contradicted)).toBeLessThan(0)
  })
})

describe('isRelevantMatch — backward-compatible wrapper', () => {
  it('still accepts a genuine match', () => {
    expect(
      isRelevantMatch('Jean-Marc Vincent Santenay Rouge 1er Cru Gravieres 2022', jeanMarcVincent)
    ).toBe(true)
  })

  it('no longer accepts the Lafleur page for Grand Village', () => {
    expect(
      isRelevantMatch(
        'Chateau Lafleur Pomerol 2016 - the Guinaudeau family also make Grand Village',
        grandVillage
      )
    ).toBe(false)
  })
})

// ─── Query-side honorifics and diacritics (Phase 9.1, WI-5) ────────────────
// STOPWORDS has always known "domaine"/"chateau" are noise — on the matching
// side only. Both query builders emitted them verbatim, and one of them
// emitted raw accents too, so the queries were stricter than the check they
// fed. Same asymmetry, forty lines apart in the same file.
describe('stripHonorifics', () => {
  it('drops a leading Domaine', () => {
    expect(stripHonorifics('Domaine Jean-Marc Vincent')).toBe('Jean-Marc Vincent')
  })

  it('drops a leading Château, accents and all', () => {
    expect(stripHonorifics('Château Grand Village')).toBe('Grand Village')
  })

  it('leaves a producer with no honorific untouched', () => {
    expect(stripHonorifics('Drappier')).toBe('Drappier')
  })

  it('preserves the casing and accents of what remains — the result goes inside a quoted query', () => {
    expect(stripHonorifics('Domaine des Ardoisières')).toBe('des Ardoisières')
  })

  it('never strips a name down to nothing', () => {
    // A producer called simply "Clos Manou" keeps "Manou"; one called only
    // "Domaine" is returned as-is rather than emptied.
    expect(stripHonorifics('Clos Manou')).toBe('Manou')
    expect(stripHonorifics('Domaine')).toBe('Domaine')
  })

  it('only strips from the front — an honorific inside a name is part of it', () => {
    expect(stripHonorifics('Chateau du Clos de Vougeot')).toBe('du Clos de Vougeot')
  })
})

describe('buildDistinguishingQuery', () => {
  it('folds diacritics, so the query is no stricter about accents than the matcher', () => {
    // These went out live as Gour%20de%20Chaul%C3%A9 and
    // Mangot%20Saint-%C3%89milion.
    expect(buildDistinguishingQuery({ producer: 'Gour de Chaulé', denomination: 'Gigondas' }))
      .toBe('Gour de Chaule Gigondas')
    expect(buildDistinguishingQuery({ producer: 'Mangot', denomination: 'Saint-Émilion' }))
      .toBe('Mangot Saint-Emilion')
  })

  it('appends the vintage only when asked', () => {
    const wine = { producer: 'Drappier', denomination: 'Champagne', vintage: 2012 }
    expect(buildDistinguishingQuery(wine)).toBe('Drappier Champagne')
    expect(buildDistinguishingQuery(wine, { includeVintage: true })).toBe('Drappier Champagne 2012')
  })
})

describe('normalize and significantWords are unchanged', () => {
  it('strips diacritics and punctuation', () => {
    expect(normalize('Château Gour de Chaulé')).toBe('chateau gour de chaule')
  })

  it('drops stopwords and short tokens', () => {
    expect(significantWords('Domaine des Ardoisières')).toEqual(['ardoisieres'])
  })
})


// ─── 2026-09-30: found on the first real iPhone scans (Phase 12 QA) ─────────
// Three wines scanned in one evening; real Serper Shopping titles below.

const sestaDiSopra: WineIdentity = {
  producer: 'Sestadisopra', // how GPT-4o read the label — the winery's own styling
  denomination: 'Brunello di Montalcino',
  vintage: 2018,
}

const laRiojaAlta: WineIdentity = {
  producer: 'La Rioja Alta, S.A.', // legal entity, read off the back label
  denomination: 'Rioja',
  vintage: 2015,
  cuvee: 'Selección Especial',
}

describe('stripLegalForm', () => {
  it.each([
    ['La Rioja Alta, S.A.', 'La Rioja Alta'],
    ['Bodegas Muga S.L.', 'Bodegas Muga'],
    ['Marchesi Antinori S.p.A.', 'Marchesi Antinori'],
    ['Biondi-Santi SpA', 'Biondi-Santi'],
    ['Poggio di Sotto S.r.l.', 'Poggio di Sotto'],
    ['Weingut Keller GmbH', 'Weingut Keller'],
    ['Domaine Leflaive SARL', 'Domaine Leflaive'],
    ['Château Rayas SCEA', 'Château Rayas'],
    ['Azienda Agricola Giuseppe Rinaldi', 'Giuseppe Rinaldi'],
    ['Società Agricola Sesta di Sopra', 'Sesta di Sopra'],
    ['Az. Agr. Bartolo Mascarello', 'Bartolo Mascarello'],
  ])('%s → %s', (input, expected) => {
    expect(stripLegalForm(input)).toBe(expected)
  })

  it('leaves names without a legal form alone, including ones that merely end in "sa"', () => {
    expect(stripLegalForm('Domaine Jean-Marc Vincent')).toBe('Domaine Jean-Marc Vincent')
    expect(stripLegalForm('Bodega Chacra Mainqué')).toBe('Bodega Chacra Mainqué')
    expect(stripLegalForm('Quinta do Vesuvio Casa')).toBe('Quinta do Vesuvio Casa')
  })

  it('never empties a name', () => {
    expect(stripLegalForm('S.A.')).toBe('S.A.')
  })
})

describe('scoreMatch — producer legal form', () => {
  it('matches a title that omits the legal suffix the label printed', () => {
    const v = scoreMatch({ title: 'La Rioja Alta Gran Reserva Selección Especial 2015' }, laRiojaAlta)
    expect(v.producer).toBe('match')
  })
})

describe('scoreMatch — producer spacing', () => {
  it('matches "Sesta di Sopra" for a label read as one word', () => {
    const v = scoreMatch({ title: '2019 Sesta di Sopra, Brunello di Montalcino' }, sestaDiSopra)
    expect(v.producer).toBe('match')
  })

  it('matches the one-word styling for a producer stored with spaces', () => {
    const v = scoreMatch(
      { title: 'SESTADISOPRA BRUNELLO DI MONTALCINO 750ml' },
      { ...sestaDiSopra, producer: 'Sesta di Sopra' }
    )
    expect(v.producer).toBe('match')
  })

  it('does not let a short producer match inside a longer word', () => {
    // "Sesti" is a different Montalcino estate; it must not match "Sesta di Sopra".
    const v = scoreMatch({ title: 'Sesta di Sopra Brunello di Montalcino 2018' }, { ...sestaDiSopra, producer: 'Sesti' })
    expect(v.producer).toBe('mismatch')
  })

  it('still rejects a different estate whose name merely shares words', () => {
    const v = scoreMatch({ title: 'Tenuta di Sesta Brunello di Montalcino' }, sestaDiSopra)
    expect(v.producer).not.toBe('match')
  })
})

describe('scoreMatch — sibling appellations', () => {
  it('rejects the Rosso di Montalcino listing for a Brunello di Montalcino (the $42.01 bug)', () => {
    const v = scoreMatch({ title: 'SESTADISOPRA ROSSO DI MONTALCINO 750ml' }, sestaDiSopra)
    expect(v.denomination).toBe('mismatch')
    expect(isAcceptableMatch(v)).toBe(false)
  })

  it('still accepts the Brunello itself', () => {
    const v = scoreMatch({ title: '2019 Sesta di Sopra, Brunello di Montalcino' }, sestaDiSopra)
    expect(v.denomination).toBe('match')
    expect(isAcceptableMatch(v)).toBe(true)
  })

  it('reads the sibling from the URL slug too', () => {
    const v = scoreMatch(
      { title: 'Sesta di Sopra 2020', url: 'https://shop.example/sesta-di-sopra-rosso-di-montalcino-2020' },
      sestaDiSopra
    )
    expect(v.denomination).toBe('mismatch')
  })

  it("handles d' denominations — Nebbiolo d'Alba is not Barbera d'Alba", () => {
    const wine: WineIdentity = { producer: 'Giacomo Conterno', denomination: "Barbera d'Alba", vintage: 2021 }
    expect(scoreMatch({ title: "Giacomo Conterno Nebbiolo d'Alba 2021" }, wine).denomination).toBe('mismatch')
    expect(scoreMatch({ title: "Giacomo Conterno Barbera d'Alba Cerretta 2021" }, wine).denomination).toBe('match')
  })

  it('ignores a sibling named only in the snippet — body copy mentions other wines', () => {
    const v = scoreMatch(
      { title: 'Sesta di Sopra Brunello di Montalcino 2018', snippet: 'Also try their Rosso di Montalcino.' },
      sestaDiSopra
    )
    expect(v.denomination).toBe('match')
  })

  it('does not treat the producer\'s own "di" as a sibling appellation', () => {
    // "Sesta di Sopra" — "di sopra" is the estate name, not "<type> di Montalcino".
    const v = scoreMatch({ title: 'Sesta di Sopra Brunello di Montalcino' }, { ...sestaDiSopra, producer: 'Sesta di Sopra' })
    expect(v.denomination).toBe('match')
  })
})

describe('query builders drop the legal form', () => {
  it('buildDistinguishingQuery', () => {
    expect(buildDistinguishingQuery(laRiojaAlta)).toBe('La Rioja Alta Rioja Seleccion Especial')
  })
})

// 2026-10-01 — La Rioja Alta's Gran Reserva 904 2015. The scan stored the
// cuvée as the label's subtitle, "Selección Especial"; shops sell it as
// "Gran Reserva 904". Titles below are real Google Shopping listings.
describe('bottling — descriptors confirm, only names reject', () => {
  const asScanned: WineIdentity = {
    producer: 'La Rioja Alta, S.A.', denomination: 'Rioja', vintage: 2015,
    cuvee: 'Selección Especial', quality_classification: 'Gran Reserva',
  }
  const named: WineIdentity = { ...asScanned, cuvee: '904' }

  it('splits naming words from descriptors', () => {
    expect(bottlingNameWords('Gran Reserva 904 Selección Especial')).toEqual(['904'])
    expect(bottlingNameWords('Viña Ardanza')).toEqual(['ardanza'])
    expect(bottlingNameWords('Vieilles Vignes')).toEqual([])
    expect(bottlingNameWords('Magistra')).toEqual(['magistra'])
  })

  it('a descriptor-only cuvée never rejects a listing that omits it', () => {
    for (const title of ['2015 La Rioja Alta Gran Reserva 904', 'La Rioja Alta Rioja (Gran) Reserva 904 2015 6 pack']) {
      const v = scoreMatch({ title }, asScanned)
      expect(v.bottling).not.toBe('mismatch')
      expect(isAcceptableMatch(v)).toBe(true)
    }
  })

  it('a descriptor-only cuvée still confirms when every word is present', () => {
    const v = scoreMatch({ title: 'La Rioja Alta 904 Gran Reserva Seleccion Especial 2015' }, asScanned)
    expect(v.bottling).toBe('match')
  })

  it('a named cuvée keeps its listings and rejects the producer\'s other wines', () => {
    expect(scoreMatch({ title: 'La Rioja Alta Gran Reserva ‘904’ 2015' }, named).bottling).toBe('match')
    for (const title of [
      'La Rioja Alta Rioja Reserva Vina Ardanza 2015 750ml Spain La Rioja',
      '2015 | La Rioja Alta | Vina Arana Gran Reserva',
      'La Rioja Alta Vina Alberdi Reserva',
    ]) {
      expect(scoreMatch({ title }, named).bottling).toBe('mismatch')
    }
  })

  it('"Viña" alone does not make Arana a match for Ardanza', () => {
    const ardanza: WineIdentity = { producer: 'La Rioja Alta', denomination: 'Rioja', vintage: 2015, cuvee: 'Viña Ardanza' }
    expect(scoreMatch({ title: 'La Rioja Alta Viña Arana Gran Reserva 2015' }, ardanza).bottling).toBe('mismatch')
  })

  it('Magistra still rejects the regular bottling', () => {
    const magistra: WineIdentity = { producer: 'Sesta di Sopra', denomination: 'Brunello di Montalcino', vintage: 2018, cuvee: 'Magistra' }
    expect(scoreMatch({ title: 'Sesta di Sopra Brunello di Montalcino 2018' }, magistra).bottling).toBe('mismatch')
  })
})

describe('identityOf — one way to build the identity', () => {
  it('carries every identity field, classification included, with nulls not undefined', () => {
    expect(identityOf({ producer: 'X', denomination: null, quality_classification: 'Riserva' })).toEqual({
      producer: 'X', denomination: '', vintage: null, cuvee: null, vineyard: null, quality_classification: 'Riserva',
    })
  })
})

describe('mentionsProducer', () => {
  it('is the matcher\'s producer rule over free text', () => {
    expect(mentionsProducer('2015 La Rioja Alta Gran Reserva 904', 'La Rioja Alta, S.A.')).toBe(true)
    expect(mentionsProducer('Sesta di Sopra Brunello', 'Sestadisopra')).toBe(true)
    expect(mentionsProducer('Muga Reserva', 'La Rioja Alta, S.A.')).toBe(false)
    expect(mentionsProducer('anything', 'Domaine')).toBeNull()
  })
})
