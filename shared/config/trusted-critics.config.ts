/**
 * The developer's trusted critic publications (Phase 12.1 D13, decided
 * 2026-10-05). Data, not logic — the same principle as RETAILER_CONFIG:
 * adding or removing a publication is a one-line change here.
 *
 * Names are the canonical publication strings `CRITIC_KEYWORDS`
 * (backend/modules/reviews/critic-keywords.ts) emits. Trust is by
 * *publication*, because review_data stores the publication, not the
 * person: William Kelley, Allen Meadows, Neal Martin and Galloni already
 * resolve to Wine Advocate, Burghound and Vinous.
 *
 * Deliberately absent: James Suckling and Jeb Dunnuck (documented as
 * inflated), and any attribution with `known_publication: false`.
 *
 * This reverses Phase 11's decision not to prioritise sources. It changes
 * the *order* of scores and which one is the card badge. Scores are still
 * never averaged or blended (CLAUDE.md §15).
 */
export const TRUSTED_CRITICS: readonly string[] = [
  'Burghound',
  'Vinous',
  'Wine Advocate',
  'Decanter',
  'Wine Enthusiast',
  'Wine Spectator',
  'Tim Atkin',
  'Guía Peñín',
  'Gambero Rosso',
]
