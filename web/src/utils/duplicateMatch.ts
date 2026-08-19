import type { WineEntry } from '@shared/types'
import { scoreMatch } from '@shared/utils/wine-match'
import type { LabelScanResult } from '../api'

export type DuplicateOutcome =
  | { kind: 'none' }
  | { kind: 'duplicate'; wine: WineEntry }
  | { kind: 'vintage_mismatch'; wine: WineEntry }

/**
 * Phase 9.4, WI-4 — the free duplicate check: run against the wines already
 * promoted into the collection, before any draft row is created or any
 * enrichment call fired. Reuses scoreMatch (shared/utils/wine-match.ts,
 * built for judging a retailer candidate against a wine) by treating the
 * scanned label as the "candidate" and each existing wine as the identity
 * being judged — the same trick backend/scripts/snapshot-enrichment.ts uses.
 *
 * A confident match requires producer AND denomination to both verify, same
 * as isAcceptableMatch's bar for accepting a retailer page. Vintage is then
 * read separately: 'match' is a true duplicate, 'mismatch' is a distinct
 * bottling worth flagging rather than silently treating as new, and
 * 'unknown' (vintage absent on one side) isn't enough to say either way, so
 * the scan proceeds as a new wine with no notice.
 */
export function findDuplicate(scan: LabelScanResult, existingWines: WineEntry[]): DuplicateOutcome {
  if (!scan.producer && !scan.denomination) return { kind: 'none' }

  const candidate = {
    title: [scan.producer, scan.denomination].filter(Boolean).join(' '),
    statedVintage: scan.vintage,
  }

  for (const wine of existingWines) {
    const verdict = scoreMatch(candidate, {
      producer: wine.producer ?? '',
      denomination: wine.denomination ?? '',
      vintage: wine.vintage,
      cuvee: wine.cuvee,
      vineyard: wine.vineyard,
      quality_classification: wine.quality_classification,
    })
    if (verdict.producer !== 'match' || verdict.denomination !== 'match') continue
    if (verdict.vintage === 'match') return { kind: 'duplicate', wine }
    if (verdict.vintage === 'mismatch') return { kind: 'vintage_mismatch', wine }
  }

  return { kind: 'none' }
}
