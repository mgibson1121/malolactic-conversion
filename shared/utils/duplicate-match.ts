import type { WineEntry } from '../types'
import { bottlingNameWords, identityOf, normalize, scoreMatch } from './wine-match'

/** The identity fields a label scan (or any would-be new wine) supplies.
 * The bottling fields are optional so older callers keep working. */
export interface DuplicateCheckInput {
  producer: string | null
  denomination: string | null
  vintage: number | null
  cuvee?: string | null
  vineyard?: string | null
  quality_classification?: string | null
}

/** When exactly one side names a bottling ("Magistra", a vineyard, a
 * classification), what each side says — so the confirm prompt can show the
 * one difference that decides "same wine or not". Absent when both agree. */
export interface BottlingDifference {
  existing: string | null
  scanned: string | null
}

export type DuplicateOutcome =
  | { kind: 'none' }
  | { kind: 'duplicate'; wine: WineEntry; bottling?: BottlingDifference }
  | { kind: 'vintage_mismatch'; wine: WineEntry }

function bottlingText(w: { cuvee?: string | null; vineyard?: string | null; quality_classification?: string | null }): string | null {
  const parts = [w.cuvee, w.vineyard, w.quality_classification]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .filter((p, i, all) => all.findIndex(q => q.toLowerCase() === p.toLowerCase()) === i)
  return parts.length ? parts.join(' · ') : null
}

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
 *
 * Phase 12 — moved here from web/src/utils/duplicateMatch.ts so the iOS app
 * can run the same check through POST /api/wines/duplicate-check rather than
 * carrying a second, Swift implementation of wine identity (CLAUDE.md §5).
 * The web app still calls this directly against the wines it already holds.
 *
 * Bottling (2026-09-30, Phase 12 QA): a scan of Sesta di Sopra's regular
 * Brunello 2018 was offered as a duplicate of the Magistra 2018 — same
 * producer, appellation and vintage, different wine. Two rules now:
 *   - both sides name a bottling and they share no naming word → a
 *     different wine, not a duplicate at all;
 *   - otherwise, unless the two read the same → still a *possible*
 *     duplicate, returned with `bottling` so the prompt shows what differs
 *     and the developer decides.
 * Naming words exclude descriptors (2026-10-01, bottlingNameWords): "Gran
 * Reserva · Selección Especial" against "Gran Reserva · 904" used to share
 * "gran" and pass silently as the same bottling.
 * Never auto-merges: a duplicate is always a question, never a silent reuse.
 */
export function findDuplicate(scan: DuplicateCheckInput, existingWines: WineEntry[]): DuplicateOutcome {
  if (!scan.producer && !scan.denomination) return { kind: 'none' }

  const candidate = {
    title: [scan.producer, scan.denomination].filter(Boolean).join(' '),
    statedVintage: scan.vintage,
  }

  let possible: DuplicateOutcome | undefined
  for (const wine of existingWines) {
    const verdict = scoreMatch(candidate, identityOf(wine))
    if (verdict.producer !== 'match' || verdict.denomination !== 'match') continue

    const scanned = bottlingText(scan)
    const existing = bottlingText(wine)
    // Judged on the words that name a bottling, not descriptors: "Gran
    // Reserva" on both sides says nothing about whether one is the 904.
    const scannedNames = bottlingNameWords(scanned ?? '')
    const existingNames = bottlingNameWords(existing ?? '')
    let sameBottling: boolean
    if (scannedNames.length > 0 && existingNames.length > 0) {
      const a = new Set(scannedNames)
      if (!existingNames.some(w => a.has(w))) continue // "Magistra" vs "Vigna X" — different bottlings
      sameBottling = true
    } else {
      sameBottling = normalize(scanned ?? '').trim() === normalize(existing ?? '').trim()
    }

    if (verdict.vintage === 'match') {
      if (sameBottling) return { kind: 'duplicate', wine }
      // Keep looking: an exact bottling match elsewhere beats this one.
      possible ??= { kind: 'duplicate', wine, bottling: { existing, scanned } }
      continue
    }
    if (verdict.vintage === 'mismatch' && !possible) return { kind: 'vintage_mismatch', wine }
  }

  return possible ?? { kind: 'none' }
}
