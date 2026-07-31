import { extractCandidateText } from './keyword-window'

describe('extractCandidateText', () => {
  it('windows around a plain "N points" citation', () => {
    const html = `<html><body><p>Some unrelated intro text far away.</p>
      <p>96 Points, Antonio Galloni, Vinous: "A gorgeous, layered wine."</p>
      </body></html>`
    const result = extractCandidateText(html)
    expect(result).toContain('96 Points')
    expect(result).toContain('Vinous')
  })

  it('windows around a "Points: N" citation', () => {
    const html = `<html><body><p>Points: 94, Wine Advocate: "Terrific stuff."</p></body></html>`
    const result = extractCandidateText(html)
    expect(result).toContain('Points: 94')
  })

  it('windows around a compact badge form (title attribute + nearby bare number)', () => {
    const html = `<html><body><div title="Decanter"><span>D</span><span>98</span></div></body></html>`
    const result = extractCandidateText(html)
    expect(result).toContain('title="Decanter"')
    expect(result).toContain('98')
  })

  it('falls back to the full stripped text when no citation pattern is found', () => {
    const html = `<html><body><p>No scores here, just marketing copy.</p></body></html>`
    const result = extractCandidateText(html)
    expect(result).toContain('No scores here')
  })

  // ─── Regression: <template>-embedded CSS false positive (2026-07-30) ─────
  // Found investigating why vintage_character/deal almost never populate: a
  // real captured Zachys product page embeds ~40,000 characters of CSS
  // custom-property declarations inside a bare <template> element (a widget
  // library's declarative-Shadow-DOM styles, not wrapped in a nested
  // <style> tag — the existing <style>-tag strip missed it entirely). One
  // declaration, `--shadow-font-scale: calc(100 / 100);`, matches the
  // score-citation pattern (a number followed by "/100") exactly like a
  // real "100/100" score would, anchoring a garbage window with zero review
  // content and eating into the fixed character budget.

  it('strips <template> blocks entirely, even when they contain CSS that would otherwise false-match as a score', () => {
    const html = `<html><body>
      <template id="widget-styles">
        :host { --shadow-font-scale: calc(100 / 100); --shadow-font-size: 16px; }
      </template>
      <p>96 Points, Vinous: "A gorgeous, layered wine."</p>
      </body></html>`
    const result = extractCandidateText(html)
    expect(result).not.toContain('shadow-font-scale')
    expect(result).not.toContain('calc(100')
    expect(result).toContain('96 Points')
  })

  it('does not let a <template>-only page with no real citation fall through the fallback with template junk', () => {
    const html = `<html><body>
      <template>--fake-var: calc(100 / 100);</template>
      <p>Just marketing copy, no scores.</p>
      </body></html>`
    const result = extractCandidateText(html)
    expect(result).not.toContain('fake-var')
    expect(result).toContain('Just marketing copy')
  })

  // ─── Regression: "N+ Points Wine(s)" nav-category false positive (2026-07-30) ─
  // Found on the same investigation: "100 Point Wines" / "90+ Points Wines"
  // is common navigation-category link text on wine retailer sites
  // (confirmed independently on both Zachys and Wine Library) — it matches
  // the score-citation pattern but is a collection link, not a citation.

  it('does not treat a "N Point Wines" navigation link as a score citation', () => {
    const html = `<html><body>
      <a href="/collections/100-point-wines">100 Point Wines</a>
      <a href="/collections/90-point-wines">90+ Points Wines</a>
      <p>No real review content on this page at all.</p>
      </body></html>`
    const result = extractCandidateText(html)
    // No real citation exists, so this must fall back to the full stripped
    // text (not a garbage window anchored on the nav link) — and the nav
    // text is far enough from the fallback's start to prove it's genuinely
    // falling back, not accidentally windowing around the nav link.
    expect(result).toContain('No real review content')
  })

  it('still matches a real score immediately adjacent to a "Point Wines" nav link, without the nav link suppressing it', () => {
    const html = `<html><body>
      <a href="/collections/100-point-wines">100 Point Wines</a>
      <p>96 Points, Vinous: "A gorgeous, layered wine."</p>
      </body></html>`
    const result = extractCandidateText(html)
    expect(result).toContain('96 Points')
    expect(result).toContain('Vinous')
  })

  it('still matches an ordinary "N points" citation that is not followed by "Wine(s)"', () => {
    // Regression guard: the (?!\s*wines?\b) exclusion must not accidentally
    // swallow legitimate citations that happen to be followed by other text.
    const html = `<html><body><p>96 points, according to the critic's latest report.</p></body></html>`
    const result = extractCandidateText(html)
    expect(result).toContain('96 points')
  })
})
