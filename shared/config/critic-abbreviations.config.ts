/**
 * Short labels for the canonical publications in
 * backend/modules/reviews/critic-keywords.ts, used for the list-card score
 * badge (`96 WA`). Data, not logic. The iOS app keeps a mirror of this table
 * in `CriticScores.abbreviations` — change both.
 */
export const CRITIC_ABBREVIATIONS: Readonly<Record<string, string>> = {
  'Wine Advocate': 'WA',
  Vinous: 'VN',
  Burghound: 'BH',
  'Wine Spectator': 'WS',
  'Wine Enthusiast': 'WE',
  Decanter: 'DC',
  'James Suckling': 'JS',
  'Jeb Dunnuck': 'JD',
  'Tim Atkin': 'TA',
  'Gambero Rosso': 'GR',
  'Guía Peñín': 'GP',
}
