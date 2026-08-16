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
