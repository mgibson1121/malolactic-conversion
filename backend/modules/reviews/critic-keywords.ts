export interface CriticKeyword {
  term: string        // exact text to match against extracted attribution (case-insensitive)
  publication: string // canonical publication name to normalize to
}

/**
 * Canonicalization and known/unknown tagging only — never a gate on whether
 * a score gets captured (see keyword-window.ts, whose generic score-citation
 * pattern is what decides that). Consulted after GPT-4o has already returned
 * a { publication, score } pair: on a match, the raw attribution is
 * normalized to `publication` here and known_publication is set true; on no
 * match, the raw text is kept as-is and known_publication is false. A stale
 * or missing entry therefore only costs normalization, not the score itself.
 *
 * Living data — expected to need periodic updates as critics change
 * publications (e.g. William Kelley became The Wine Advocate's
 * Editor-in-Chief in April 2024, succeeding Joe Czerwinski, who'd held the
 * role only since December 2021; Neal Martin moved from Wine Advocate to
 * Vinous in 2022) or as new regions/publications the developer tracks come
 * up. See build-phases.md Phase 7, "Open questions affecting phases."
 */
export const CRITIC_KEYWORDS: CriticKeyword[] = [
  // Publications — Burgundy/Bordeaux/Rhône-sourced (original research)
  { term: 'Wine Advocate', publication: 'Wine Advocate' },
  { term: 'Vinous', publication: 'Vinous' },
  { term: 'Burghound', publication: 'Burghound' },
  { term: 'Wine Spectator', publication: 'Wine Spectator' },
  { term: 'James Suckling', publication: 'James Suckling' },
  { term: 'Decanter', publication: 'Decanter' },
  { term: 'Wine Enthusiast', publication: 'Wine Enthusiast' },
  { term: 'Jeb Dunnuck', publication: 'Jeb Dunnuck' },
  { term: 'International Wine Cellar', publication: 'Vinous' }, // legacy, folded into Vinous

  // Critic surnames
  { term: 'Kelley', publication: 'Wine Advocate' },
  { term: 'Galloni', publication: 'Vinous' },
  { term: 'Neal Martin', publication: 'Vinous' },
  { term: 'Dunnuck', publication: 'Jeb Dunnuck' },
  { term: 'Allen Meadows', publication: 'Burghound' },
  { term: 'Parker', publication: 'Wine Advocate' },
  { term: 'Suckling', publication: 'James Suckling' },
  { term: 'Tanzer', publication: 'Vinous' }, // International Wine Cellar founder, folded into Vinous
  { term: 'Czerwinski', publication: 'Wine Advocate' },
  { term: 'Perrotti-Brown', publication: 'Wine Advocate' },

  // Abbreviations
  { term: 'WA', publication: 'Wine Advocate' },
  { term: 'JS', publication: 'James Suckling' },
  { term: 'RP', publication: 'Wine Advocate' },
  { term: 'BH', publication: 'Burghound' },
  { term: 'JD', publication: 'Jeb Dunnuck' },
  { term: 'WS', publication: 'Wine Spectator' },
  { term: 'WE', publication: 'Wine Enthusiast' },

  // Added 2026-07-24 for regional coverage already known to be needed
  // (Barolo, Rioja — both in the test collection)
  { term: 'Tim Atkin', publication: 'Tim Atkin' }, // independent, Rioja/Spain's defining critic
  { term: 'Guía Peñín', publication: 'Guía Peñín' },
  { term: 'Peñín Guide', publication: 'Guía Peñín' },
  { term: "Kerin O'Keefe", publication: 'Wine Enthusiast' },
  { term: 'Luis Gutiérrez', publication: 'Wine Advocate' },
  { term: 'Gambero Rosso', publication: 'Gambero Rosso' },
  { term: 'GR', publication: 'Gambero Rosso' },
]
