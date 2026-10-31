/**
 * Ground truth for the 14-wine batch loaded 2026-08-04 (Phase 9.1, WI-10).
 *
 * The batch is the reason Phase 9's data-quality review failed, and it is a
 * useful fixture precisely because it is not a clean set: all 14 wines are
 * vintage 2022, all French, all entered with cuvee / vineyard /
 * quality_classification null, and several with an identity the label scan
 * got materially wrong (`producer: "Montus"` for Château Montus,
 * `denomination: "Vin de France"` for a Bordeaux Supérieur). Fixing the scan
 * is a separate phase; the point here is that the modules must *tolerate*
 * that imprecision rather than reject it.
 *
 * Two kinds of case are recorded:
 *
 * - KNOWN_GOOD — pages that were right and must keep being accepted. These
 *   guard against a fix over-tightening: it is easy to make the Lafleur case
 *   impossible by rejecting everything.
 * - KNOWN_BAD — pages that were accepted and stored, wrongly, and must never
 *   come back. Each records which dimension should disqualify it, so a
 *   regression tells you what broke rather than only that something did.
 *
 * Every entry is a real stored result from that run, not an invented example.
 * Sources: docs/sessions/2026-08-04-core-functionality-defect-taxonomy.md §1,
 * and the price_data / review_data JSON in backend/db/wine.db.
 *
 * Consumed by backend/tests/unit/ground-truth.test.ts (offline, runs in CI)
 * and by backend/scripts/validate-reviews.ts (live, costs API usage).
 */
import type { WineIdentity, MatchCandidate } from '@shared/utils/wine-match'

export interface GroundTruthWine extends WineIdentity {
  /** Short label for reports — how the wine reads on the entry card. */
  label: string
}

/** The batch as entered, including the label-scan errors. Do not "correct"
 * these: the wrong strings are the input the pipeline has to cope with. */
export const BATCH_WINES: GroundTruthWine[] = [
  { label: 'Bessin-Tremblay · Chablis 2022', producer: 'Domaine Bessin-Tremblay', denomination: 'Chablis', vintage: 2022 },
  { label: 'Maxime Cottenceau · Montagny 2022', producer: 'Domaine Maxime Cottenceau', denomination: 'Montagny', vintage: 2022 },
  { label: 'Dureuil-Janthial · Rully 2022', producer: 'Domaine Vincent Dureuil-Janthial', denomination: 'Rully', vintage: 2022 },
  { label: 'Jean-Marc Vincent · Santenay 2022', producer: 'Domaine Jean-Marc Vincent', denomination: 'Santenay', vintage: 2022 },
  { label: 'Charles Audoin · Marsannay 2022', producer: 'Domaine Charles Audoin', denomination: 'Marsannay', vintage: 2022 },
  { label: 'Bretadeau · Muscadet 2022', producer: 'Bretadeau', denomination: 'Muscadet', vintage: 2022 },
  { label: 'Gour de Chaulé · Gigondas 2022', producer: 'Gour de Chaulé', denomination: 'Gigondas', vintage: 2022 },
  // Entered as "Montus" — the estate is Château Montus.
  { label: 'Montus · Madiran 2022', producer: 'Montus', denomination: 'Madiran', vintage: 2022 },
  // Entered as "Mangot" — the estate is Château Mangot.
  { label: 'Mangot · Saint-Émilion 2022', producer: 'Mangot', denomination: 'Saint-Émilion', vintage: 2022 },
  { label: 'Clos Manou · Médoc 2022', producer: 'Clos Manou', denomination: 'Médoc', vintage: 2022 },
  // Entered as "Vin de France" — the wine is a Bordeaux Supérieur. That wrong
  // string then becomes a required quoted phrase in the reviews query.
  { label: 'Grand Village · Vin de France 2022', producer: 'Grand Village', denomination: 'Vin de France', vintage: 2022 },
  { label: 'Clos Venturi · Corsica 2022', producer: 'Clos Venturi', denomination: 'Corsica', vintage: 2022 },
  { label: 'Ardoisières · Savoie 2022', producer: 'Domaine des Ardoisières', denomination: 'Savoie', vintage: 2022 },
  { label: 'Deleuze-Rochetin · Côtes du Rhône 2022', producer: 'Domaine Deleuze-Rochetin', denomination: 'Côtes du Rhône', vintage: 2022 },
]

export function wineByLabel(label: string): GroundTruthWine {
  const wine = BATCH_WINES.find(w => w.label === label)
  if (!wine) throw new Error(`No ground-truth wine labelled "${label}"`)
  return wine
}

export interface GroundTruthCase {
  /** What this case is guarding, in one line. */
  what: string
  wine: GroundTruthWine
  candidate: MatchCandidate
  /** For KNOWN_BAD only: the dimension that must disqualify this candidate.
   * Recorded so a regression says which rule broke, not just that one did. */
  disqualifiedBy?: 'producer' | 'denomination' | 'bottling' | 'url_shape'
  /** For KNOWN_GOOD: the expected vintage gap, if the page is a near miss
   * that must still be accepted and labelled. */
  expectedVintageGap?: number
}

/** Pages that were right. A fix that makes these stop matching has
 * over-corrected — the Lafleur case is trivially "fixable" by rejecting
 * everything. */
export const KNOWN_GOOD: GroundTruthCase[] = [
  {
    what: 'Flatiron carried the exact wine and vintage — the batch\'s cleanest result',
    wine: wineByLabel('Gour de Chaulé · Gigondas 2022'),
    candidate: {
      title: 'Gour de Chaulé Gigondas Cuvée Tradition 2022',
      url: 'https://nyc.flatiron-wines.com/products/gour-de-chaule-gigondas-cuvee-tradition-2022',
    },
    expectedVintageGap: 0,
  },
  {
    what: 'Woodland Hills had Mangot 2022 with 7 critic scores, correct vintage',
    wine: wineByLabel('Mangot · Saint-Émilion 2022'),
    candidate: {
      title: 'Chateau Mangot Saint-Emilion Grand Cru 2022',
      url: 'https://whwc.com/mangot-st-emilion-2022/',
    },
    expectedVintageGap: 0,
  },
  {
    what: 'JJ Buckley had Mangot 2022 — a retailer added only on 2026-08-02',
    wine: wineByLabel('Mangot · Saint-Émilion 2022'),
    candidate: {
      title: '2022 Chateau Mangot Saint-Emilion Grand Cru',
      url: 'https://www.jjbuckley.com/wine/2022-chateau-mangot-saint-emilion-grand-cru/123456',
    },
    expectedVintageGap: 0,
  },
  {
    what: 'Benchmark\'s only Charles Audoin page is the 2020 — kept and labelled, never dropped',
    wine: wineByLabel('Charles Audoin · Marsannay 2022'),
    candidate: {
      title: 'Charles Audoin Marsannay Clos du Roy 2020',
      url: 'https://www.benchmarkwine.com/products/154340-charles-audoin-marsannay-clos-du-roy-2020',
    },
    expectedVintageGap: 2,
  },
  {
    what: 'Morrell lists Jean-Marc Vincent without the "Domaine" honorific',
    wine: wineByLabel('Jean-Marc Vincent · Santenay 2022'),
    candidate: {
      title: 'Jean-Marc Vincent Santenay Rouge 1er Cru Gravieres 2022',
      url: 'https://www.morrellwine.com/products/jean-marc-vincent-santenay-gravieres-2022',
    },
    expectedVintageGap: 0,
  },
]

/** Pages that were accepted and stored, wrongly. These must never come back. */
export const KNOWN_BAD: GroundTruthCase[] = [
  {
    // The most severe defect in the batch: nine scores (Decanter 100, Wine
    // Advocate 99, Vinous 99, Jeb Dunnuck 99…) stored against a ~$30 wine,
    // because the two estates share an owning family and the Lafleur page
    // mentions Grand Village in its body copy.
    what: 'Château Lafleur\'s page must never be accepted for Château Grand Village',
    wine: wineByLabel('Grand Village · Vin de France 2022'),
    candidate: {
      title: 'Chateau Lafleur Pomerol 2016',
      url: 'https://whwc.com/lafleur-pomerol-2016/',
      snippet: 'The Guinaudeau family, also behind Chateau Grand Village, produce this Pomerol...',
    },
    disqualifiedBy: 'producer',
  },
  {
    what: 'A different producer at the same appellation must not match',
    wine: wineByLabel('Gour de Chaulé · Gigondas 2022'),
    candidate: {
      title: '2016 Famille Perrin Gigondas Domaine du Clos des Tourelles',
      url: 'https://www.sokolin.com/2016-famille-perrin-gigondas-domaine-du-clos-des-tourelles',
    },
    disqualifiedBy: 'producer',
  },
  {
    what: 'A different Brumont wine must not match Château Montus',
    wine: wineByLabel('Montus · Madiran 2022'),
    candidate: {
      title: '2024 Brumont Cotes du Gascogne Rouge',
      url: 'https://www.winelibrary.com/2024-brumont-cotes-du-gascogne-rouge',
    },
    disqualifiedBy: 'producer',
  },
  {
    what: 'A PDF vintage report is not a product page',
    wine: wineByLabel('Clos Manou · Médoc 2022'),
    candidate: {
      title: '2011 Bordeaux Report',
      url: 'https://images.jjbuckley.com/reports/2011_BORDEAUX_REPORT.pdf',
    },
    disqualifiedBy: 'url_shape',
  },
  {
    what: 'An auction bidding-history page is not a product page',
    wine: wineByLabel('Gour de Chaulé · Gigondas 2022'),
    candidate: {
      title: 'Bidding History',
      url: 'https://bid.zachys.com/auctions/bidding-history/98765',
    },
    disqualifiedBy: 'url_shape',
  },
  {
    // Phase 9.2 calibration (2026-08-15): Zachys's product search returns
    // this redirect/proxy shape for auction lots, which the old
    // `/(^|\.)bid\./` pattern silently missed — it never matches "bid." when
    // preceded by "//" instead of "." or the string start, i.e. on every
    // real https:// URL. Caught a wasted Puppeteer render + GPT-4o call, not
    // a wrong-data bug (the page has no score citation), but it's exactly
    // the class of defect the url_shape guard exists to prevent.
    what: 'A Zachys auction redirect URL is not a product page',
    wine: wineByLabel('Gour de Chaulé · Gigondas 2022'),
    candidate: {
      title: 'Gigondas Tradition Gour de Chaule 2015',
      url: 'https://bid.zachys.com/language?url=%2Flot-details%2Findex%2Fcatalog%2F101%2Flot%2F54812%2FGigondas-Tradition-Gour-de-Chaule-2015&ln=3',
    },
    disqualifiedBy: 'url_shape',
  },
  {
    what: 'A retailer offers blog post is not a product page',
    wine: wineByLabel('Clos Manou · Médoc 2022'),
    candidate: {
      title: 'Bordeaux offers — Clos Manou and friends',
      url: 'https://crushwineco.com/blogs/offers/bordeaux-2022',
    },
    disqualifiedBy: 'url_shape',
  },
  {
    what: '"vin" (of Vin de France) must not match inside "vintage"',
    wine: wineByLabel('Grand Village · Vin de France 2022'),
    candidate: { title: 'Some Other Estate 2022 vintage release notes' },
    disqualifiedBy: 'producer',
  },
]

// ─── Field-test round 2 (Phase 12.4 WI-0, 2026-10-31) ────────────────────────
//
// The cases from the developer's 2026-10-31 device test, as stored in the live
// database that day (read with backend/scripts/explain-wine.ts, zero calls).
// Unlike the batch above, each is a whole wine with the stored pages or
// listings that show the defect. Consumed by
// backend/tests/unit/field-test-round-2.test.ts; a case still open is an
// `it.failing` there, and turns green when its 12.4 work item lands.
// Spec: docs/specs/2026-10-31-phase-12.3-to-12.5-field-test-round-2.md.

export interface RoundTwoWine {
  label: string
  producer: string
  denomination: string
  vintage: number | null
  cuvee: string | null
  vineyard: string | null
  quality_classification: null
}

const wine = (label: string, w: Omit<RoundTwoWine, 'label' | 'quality_classification'>): RoundTwoWine =>
  ({ label, quality_classification: null, ...w })

/** WI-1: a 2005 page with two scores, stored against the 2017 (12 years away). */
export const SANSONNET = {
  wine: wine('Château Sansonnet · Saint-Émilion 2017', { producer: 'Château Sansonnet', denomination: 'Saint-Émilion', vintage: 2017, cuvee: null, vineyard: null }),
  page: {
    slug: 'winelibrary', name: 'Wine Library', page_vintage: 2005,
    product_url: 'https://winelibrary.com/wines/cabernet-franc/2005-chateau-sansonnet-7252',
    scores: [{ publication: 'Wine Spectator', score: 92 }, { publication: 'Vinous', score: 89 }],
  },
}

/**
 * WI-1: the blanc, 2012, holds a single page — Woodland's 2023 La Crau
 * (11 years away, five scores). Also worth knowing: the wine is recorded as
 * white and the page is almost certainly the rouge; colour is not a matching
 * dimension today.
 */
export const VIEUX_TELEGRAPHE_BLANC = {
  wine: wine('Domaine Vieux Télégraphe · Châteauneuf-du-Pape La Crau 2012 (blanc)', { producer: 'Domaine Vieux Télégraphe', denomination: 'Châteauneuf-du-Pape', vintage: 2012, cuvee: null, vineyard: 'La Crau' }),
  page: {
    slug: 'woodland', name: 'Woodland Hills Wine Co.', page_vintage: 2023,
    product_url: 'https://whwc.com/vieux-telegraphe-chateauneuf-du-pape-la-crau-2023/',
    scores: [
      { publication: 'JamesSuckling.com', score: 98 }, { publication: 'Bettane & Desseauve Guide', score: 96 },
      { publication: 'Jeb Dunnuck', score: 95 }, { publication: 'Wine Spectator', score: 94 }, { publication: 'Vinous', score: 94 },
    ],
  },
}

/**
 * WI-4: answered "Albert Bichot" (the owner's name, offered as a modifier
 * because the Wine Spectator URL and both listing titles carry it). The
 * answer was saved as the vineyard, the leftover words regrouped into new
 * options, and the banner came back with no refresh.
 */
export const PAVILLON = {
  wine: wine('Domaine du Pavillon · Pommard 2019', { producer: 'Domaine du Pavillon', denomination: 'Pommard', vintage: 2019, cuvee: null, vineyard: null }),
  answer: 'Albert Bichot',
  page: {
    slug: 'fallback-winespectator-com', name: 'winespectator.com', page_vintage: 2020,
    product_url: 'https://www.winespectator.com/wine/wine-detail/id/1290660/name/albert-bichot-pommard-les-rugiens-domaine-du-pavillon-2020/guest',
  },
  /** As stored by the fetch, including the bottling difference it recorded then. */
  listings: [
    { title: 'Albert Bichot Domaine Du Pavillon Les Rugiens Pommard Premier Cru 2020 750ml', extra: ['rugiens'] },
    { title: 'Albert Bichot Domaine du Pavillon Pommard Premier cru Les Rugiens', extra: ['rugiens'] },
  ],
}

/**
 * WI-5: every stored listing read "12L" — the producer's name. Fixed in code
 * by #44 (merged 2026-10-05 00:46Z); this wine's price_data was fetched at
 * 00:25Z, 21 minutes earlier, so the stored blob is stale, not the code. The
 * title below is reconstructed from Crush's URL slug
 * (crushwineco.com/products/2022-franck-balthazar-cornas-les-chaillots-1-5-l);
 * the raw Shopping title is not stored.
 */
export const BALTHAZAR = {
  wine: wine('Franck Balthazar · Cornas Chaillot 2020', { producer: 'Franck Balthazar', denomination: 'Cornas', vintage: 2020, cuvee: null, vineyard: 'Chaillot' }),
  crushTitle: '2022 Franck Balthazar Cornas Les Chaillots 1.5 L',
}

/**
 * WI-2: Kermit Lynch sells this exact wine and vintage
 * (https://shop.kermitlynch.com/product/detail/19FVT02 — Puppeteer render
 * 2026-10-31: "2019 Châteauneuf-du-Pape “La Crau” Domaine du Vieux
 * Télégraphe"). The stored price_data (2026-10-13) holds five listings and
 * no Kermit Lynch — exactly TARGET_RETAILER_COUNT, so the top-up cap may have
 * cut it. Only the raw Shopping response can say.
 */
export const LA_CRAU_2019 = {
  wine: wine('Domaine du Vieux Télégraphe · Châteauneuf-du-Pape La Crau 2019', { producer: 'Domaine du Vieux Télégraphe', denomination: 'Châteauneuf-du-Pape', vintage: 2019, cuvee: 'La Crau', vineyard: null }),
  kermitLynch: {
    url: 'https://shop.kermitlynch.com/product/detail/19FVT02',
    title: '2019 Châteauneuf-du-Pape “La Crau” Domaine du Vieux Télégraphe',
  },
  storedListings: 5,
}

/**
 * WI-2: Astor item 31372 is "Littorai Pinot Noir, Sonoma Coast — 2025, 750 mL,
 * $84.99" (Puppeteer render 2026-10-31). The wine in the cellar is recorded as
 * the Hirsch Vineyard 2024: a different bottling and vintage, so the matcher
 * labels it rather than counting it. Whether the record or the expectation is
 * wrong is the developer's call.
 */
export const LITTORAI = {
  wine: wine('Littorai · Sonoma Coast Hirsch Vineyard 2024', { producer: 'Littorai', denomination: 'Sonoma Coast', vintage: 2024, cuvee: null, vineyard: 'Hirsch Vineyard' }),
  astor: {
    url: 'https://www.astorwines.com/SearchResultsSingle.aspx?search=31372&searchtype=Contains',
    title: 'Littorai Pinot Noir, Sonoma Coast 2025',
    price: 84.99,
  },
}
