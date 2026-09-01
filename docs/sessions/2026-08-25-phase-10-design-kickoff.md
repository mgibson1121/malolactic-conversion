# 2026-08-25 — Phase 10: design canvas kickoff, toolchain correction

**Branch:** none — this session did planning and documentation only, no code changes.
**Spec:** none written; see `docs/build-phases.md` Phase 10 for the updated plan.
**Status:** Design canvas published, first round of developer feedback received (not yet
addressed). Continues in a later session.

## What was done

1. **Reviewed Phase 9 status.** Confirmed via `docs/build-phases.md` that Phase 9 and its
   sub-phases (9.1–9.4) are all closed, and that Phase 10 (UX design) is next per the
   documented sequence.
2. **Built a six-hotspot design canvas** (Capture, Research, Evaluate, Cellar, Wishlist +
   Purchasing, Learn) using Claude's Design skill, published as a Claude.ai Artifact.
   Desktop/web-first per the developer's request (easier to design the whole picture and
   shrink to mobile than the reverse), clean/functional visual direction ("Robinhood, not
   Provence"), and populated with real rows pulled from the live `backend/db/wine.db`
   (Domaine Rousseau, Georges Roumier, Giacomo Conterno, Raveneau, Clos des Papes, the
   real Roumier tasting note, the real Raveneau $329→$1,650 price spread across
   retailers) rather than placeholder content.
3. **Found a branch/merge gap while orienting on "how the app currently works."**
   `main` is 39 commits behind `feature/discovery-review-ui` and is missing Phase 9.3's
   Discovery Review screen and all of Phase 9.4 — only a docs-sync PR (#25) landed on
   `main` after Phase 9.2. Read `web/src/App.tsx` directly to confirm the real shipped IA:
   four tabs (Discovered / Wishlist / Cellar / Tasting Notes), Scan Label / + Add Wine as
   header actions, and Discovery Review / Evaluate / Wine Detail as modals — not the
   six-item nav the design canvas models. The design canvas is intentionally ahead of
   current navigation (it's designing where the product is going), but the gap is
   recorded so it isn't mistaken for drift.
4. **Corrected a toolchain misunderstanding.** The Cowork project description still says
   "Cursor"; the actual repo docs (`CLAUDE.md`, `wine-app-product-context.md`) already
   said Claude Code, not Cursor, and never mentioned Cursor at all — so no code-facing doc
   was actually wrong on that point. What *was* stale was the Phase 10/11 plan naming
   Magic Patterns as the prototyping tool, written before any UI design had started and
   never actually used. Corrected in `docs/CLAUDE.md` §12, `wine-app-product-context.md`
   §8, and `docs/build-phases.md` Phase 10/11.

## Key decisions

- **The toolchain is deliberately all-Claude** — Claude.ai/Cowork for planning and
  design, Claude Code for execution — recorded as a standing rule in `docs/CLAUDE.md`
  §12, not just a one-off choice. Introducing Magic Patterns, Cursor, Figma, or any other
  external design/build tool needs an explicit decision recorded there first.
- **Part of this project's stated purpose is learning to use Claude well across a full
  build**, not only shipping the wine app. This reframes tool choices going forward:
  prefer a Claude-native path (e.g. the Design skill's canvas) over an external tool even
  when the external tool might be individually more capable.
- **Phase 10 iterates via comments on the published design artifact**, not via a
  round-trip through a separate prototyping tool. The developer leaves comments; a later
  session reads them fresh (this session has no live push notification for new comments)
  and addresses them in place.
- **This design pass is web-first**, reversing Phase 10's original "design mobile-first"
  note — a sequencing choice for how this pass works, not a reversal of iOS-as-primary
  surface as a product decision.

## Feedback received (not yet actioned)

Five comments on the published canvas (2026-08-25), to address in the next design
session:
1. Data presentation needs more visual presence — "looks kind of plain."
2. Add quick add/remove list-tagging directly from the Discovered list, not only from a
   detail panel.
3. Critic-score display needs to pick one prioritized review from a definable preferred
   review source, rather than showing every score found.
4. Cut "each source in its own voice" as UI copy — it doesn't add anything.
5. Need a way to visually distinguish GPT-inferred conclusions (vintage character,
   "Deal" badges) from raw sourced facts.

## PR

None — no code changed this session.

## What's next

- Next session: re-read the design artifact and its comments fresh, address the five
  items above, and iterate the canvas in place.
- Separately (not blocking Phase 10): open a PR for `feature/discovery-review-ui` and
  merge Phase 9.3 + 9.4 into `main`, which is currently missing both.
- Add iOS-shaped screens once the web-first visual language is settled.
