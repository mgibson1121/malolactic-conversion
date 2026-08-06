import {
  scoreMatch,
  isAcceptableMatch,
  compareByMatchQuality,
  extractVintage,
  normalize,
  significantWords,
  isRelevantMatch,
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

describe('normalize and significantWords are unchanged', () => {
  it('strips diacritics and punctuation', () => {
    expect(normalize('Château Gour de Chaulé')).toBe('chateau gour de chaule')
  })

  it('drops stopwords and short tokens', () => {
    expect(significantWords('Domaine des Ardoisières')).toEqual(['ardoisieres'])
  })
})
