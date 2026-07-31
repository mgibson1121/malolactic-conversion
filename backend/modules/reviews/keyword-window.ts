// <template> blocks are a real, confirmed false-positive source, found
// 2026-07-30 investigating why vintage_character/deal almost never
// populate: a real captured product page embeds two <template> elements
// (a widget library's declarative-Shadow-DOM CSS, not wrapped in a nested
// <style> tag) totaling ~40,000 characters of raw CSS custom-property
// declarations like `--shadow-font-scale: calc(100 / 100);`. That literal
// "100 / 100" matches the score-citation pattern (ORDER_A's
// `\d{2,3}\s*\/\s*100`) exactly as well as a real "100/100" score would,
// anchoring a ~1,200-character garbage window with zero review content —
// eating into the fixed MAX_TOTAL_WINDOW_CHARS budget before the real
// critic-testimonial content further down the page. <template> content is
// never directly rendered page prose (it's inert until cloned by JS), so
// stripping it entirely is safe and general, not a per-site patch.
const STRIP_RE = /<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<svg\b[^>]*>[\s\S]*?<\/svg>|<template\b[^>]*>[\s\S]*?<\/template>|<!--[\s\S]*?-->/gi

const FALLBACK_CAP = 280_000
const WINDOW_RADIUS = 600
const MERGE_GAP = 200
const MAX_TOTAL_WINDOW_CHARS = 8_000
const MIN_SCORE = 50
const MAX_SCORE = 100
// Bare-number badge form (ORDER_C) has no scoring word to anchor on, so it's
// a weaker signal than A/B — restrict it to the range real wine critic
// scores actually cluster in, to cut down on incidental-number noise.
const MIN_BADGE_SCORE = 85

// Ordering A: "96 points", "94-96 pts", "92/100", "96+ Score" — a number
// (optionally a range or plus form) followed by a scoring word. Always ends
// on the scoring word, so a trailing \b is safe even when the number ends
// in "+" (a non-word character that would otherwise break a boundary
// assertion placed right after it).
//
// Excludes a trailing "Wine(s)" (e.g. "100 Point Wines", "90+ Points Wines")
// — confirmed false positive, found 2026-07-30: this is a navigation
// category link ("90+ Point Wines" collection), not a citation, and the
// exact "N+ Points" phrasing was independently observed as nav text on two
// different real retailer sites (Zachys, Wine Library) during the same
// investigation, not a one-site quirk. Anchors a garbage window with zero
// review content, same failure shape as the CSS-in-<template> issue above.
const ORDER_A = String.raw`\b(\d{2,3})(?:\s*[-–]\s*\d{2,3})?\+?\s*(?:points?|pts?\.?|\/\s*100|score)\b(?!\s*wines?\b)`
// Ordering B: "Points: 96", "Score 94+" — a scoring word followed by a
// number. "/100" excluded here; it only reads naturally after a number.
// No trailing \b — the number may end in "+".
const ORDER_B = String.raw`\b(?:points?|pts?\.?|score)\s*:?\s*(\d{2,3})(?:\s*[-–]\s*\d{2,3})?\+?`
// Ordering C: compact badge/pill UI, no scoring word at all — e.g.
// `title="Vinous"><span>V</span><span>96</span>`, where the publication
// name lives in an HTML `title` attribute (a tooltip) rather than visible
// text, and the score is a bare number a short distance later. Common on
// sites that show a row of critic-score badges rather than prose. The
// negative lookarounds reject numbers that are part of a hyphenated CSS
// class token (Tailwind-style "gray-500", "px-2" etc. are virtually always
// hyphen-adjacent) — without them this pattern drowns in class-name noise
// on any Tailwind-based site, matching the class number instead of the
// score two spans later.
const ORDER_C = String.raw`title="[^"]{2,60}"[\s\S]{0,150}?(?<!-)\b(\d{2,3})\b(?!["-])`

const SCORE_PATTERN = new RegExp(`${ORDER_A}|${ORDER_B}|${ORDER_C}`, 'gi')

interface Span {
  start: number
  end: number
}

function stripBoilerplate(html: string): string {
  return html.replace(STRIP_RE, ' ')
}

/**
 * Finds every plausible score-citation match in `text` and returns the
 * character spans of the matches themselves (not yet windowed/merged).
 * Publication-agnostic by design — this only looks for the shape of a
 * citation (number + scoring word), never for a specific known publication
 * name, so an attribution the app has never seen still gets found. Filters
 * out numbers outside a plausible critic-score range so incidental digits
 * (prices, loyalty points, star ratings) don't trigger a window.
 */
function findScoreCitationSpans(text: string): Span[] {
  const spans: Span[] = []
  SCORE_PATTERN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SCORE_PATTERN.exec(text))) {
    // Group 3 (ORDER_C, the badge form) is a weaker, scoring-word-less
    // signal — held to a tighter minimum than groups 1/2 (ORDER_A/B, which
    // are anchored by an explicit "points"/"pts"/"score" word).
    const isBadgeForm = m[3] !== undefined
    const numStr = m[1] ?? m[2] ?? m[3]
    const num = numStr ? parseInt(numStr, 10) : NaN
    const min = isBadgeForm ? MIN_BADGE_SCORE : MIN_SCORE
    if (num >= min && num <= MAX_SCORE) {
      spans.push({ start: m.index, end: m.index + m[0].length })
    }
  }
  return spans
}

/** Expands each span by WINDOW_RADIUS, then merges spans that overlap or sit within MERGE_GAP of each other. */
function windowAndMerge(spans: Span[], textLength: number): Span[] {
  const expanded = spans
    .map((s) => ({
      start: Math.max(0, s.start - WINDOW_RADIUS),
      end: Math.min(textLength, s.end + WINDOW_RADIUS),
    }))
    .sort((a, b) => a.start - b.start)

  const merged: Span[] = []
  for (const span of expanded) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end + MERGE_GAP) {
      last.end = Math.max(last.end, span.end)
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

/**
 * Strips the largest sources of page bloat (script/style/svg/template/comments),
 * then locates generic score-citation patterns and returns bounded windows
 * of text around each — publication-agnostic, so a citation from a
 * publication not in CRITIC_KEYWORDS is still captured (that list only
 * canonicalizes/tags after the fact — see gpt-extract.ts and
 * critic-keywords.ts). Falls back to the stripped text, capped at
 * FALLBACK_CAP, when no citation pattern is found at all, so an unusual
 * format still gets a real extraction attempt instead of nothing.
 */
export function extractCandidateText(html: string): string {
  const stripped = stripBoilerplate(html)
  const spans = findScoreCitationSpans(stripped)

  if (spans.length === 0) {
    return stripped.slice(0, FALLBACK_CAP)
  }

  const windows = windowAndMerge(spans, stripped.length)
  const pieces: string[] = []
  let total = 0
  for (const w of windows) {
    if (total >= MAX_TOTAL_WINDOW_CHARS) break
    const piece = stripped.slice(w.start, w.end)
    pieces.push(piece)
    total += piece.length
  }
  return pieces.join('\n...\n')
}
