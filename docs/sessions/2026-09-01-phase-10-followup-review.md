# 2026-09-01 — Phase 10 follow-up review (Claude.ai/Cowork session)

**Context:** Continuation of the 2026-08-25 Phase 10 design-kickoff session. The developer
asked this session to (a) build context on how docs and the PR trail had moved since
Phase 10's plan was originally written, (b) update Phase 10 if anything would have been
done differently with that context, (c) retain the 5 comments already left on the
published design canvas (still mid-review, to be continued), and (d) scrub stale
"Cursor" references now that the toolchain is deliberately all-Claude.

**Finding: (b) and (d) were already done.** A prior session on 2026-08-24 (commit
`df61503`, "Matt Gibson", co-authored by Claude Sonnet 5) had already made this exact
pass — rewrote `docs/CLAUDE.md` §12, updated `docs/build-phases.md`'s Phase 10 entry with
a status line, "what changed and why," the 5-comment record, and the "`main` is 39 commits
behind" finding, and updated `docs/wine-app-product-context.md`'s toolchain line. All three
docs were confirmed already synced into the Claude.ai Project's copies (matching
`created_at` timestamps and a direct diff-vs-fresh-read comparison). No stray "Cursor"
mentions were found in `docs/specs/2026-08-16-phase-9.3-discovery-review-ui.md`,
`docs/specs/2026-08-19-phase-9.4-scan-first-enrichment.md`, or the original `Wine
Project.docx` brainstorm doc (all three predate or are unrelated to the toolchain
decision).

**Independent verification of `df61503`'s one factual claim:** read `web/src/App.tsx` in
full. Confirmed accurate — `type TabId = 'discovered' | 'wishlist' | 'cellar' |
'tasting_notes'`, with `LabelScanFlow` / `AddWineForm` / `DiscoveryReview` / `EvaluateForm`
/ `TastingNoteHistory` / `WineDetailModal` all rendered as conditional overlays inside
`App.tsx`, not routes. The design canvas's six-hotspot sidebar-nav structure is a
forward-looking reimagining, not a description of the shipped app — worth keeping in mind
for Phase 11 as a bigger structural jump than an incremental evolution of the current
4-tab/modal shape, not a decision to make now.

**Branch gap — correction (2026-09-03):** the "`main` is 42 commits behind" claim below was
wrong. This session didn't have `gh` installed and inferred branch state from local commit
graph shape rather than querying GitHub directly, which is unreliable across a squash merge.
[PR #28](https://github.com/mgibson1121/malolactic-conversion/pull/28) squash-merged all of
`feature/discovery-review-ui` (including Phase 9.3 and 9.4) into `main` on 2026-08-31 —
confirmed via `gh pr list` and `main`'s HEAD commit. `main` is content-current; the
"42 commits ahead" `git log` reads is squash-merge history divergence (one squashed commit
on `main` vs. the original 42 on the feature branch), not real unmerged work. Original
(incorrect) note preserved below for the record:

> **Branch gap, re-confirmed:** `main` is now **42** commits behind
> `feature/discovery-review-ui` (was 39 on 2026-08-25) — still missing Phase 9.3 and all of
> Phase 9.4. `gh` is not installed on this device, so PR numbers are inferred from commit
> message `(#N)` suffixes only, not queried directly. This remains a decision point for the
> developer, not something to merge unilaterally.

**Comments, re-read directly from the published Artifact (still all open, none activated
for Claude — left untouched):**

1. "I like the data presentation here, but needs to pop a little more, looks kind of plain."
2. "I should be able to quick add or remove from the discovered queue."
3. "Note that for this UI to work, we will need to prioritize which review is shown. Given
   if it has one, it is likely to have many. We should use one from a preferred review
   source, which we can define separately."
4. "'Each source in its own voice' doesn't add anything."
5. "Need to figure out how to handle inferred conclusions made by the GPT model, like
   'good vintage' or 'value'."

These match `build-phases.md`'s recorded summary exactly. Two are worth flagging beyond
the verbatim record:

- **Comment 3 is a bigger decision than it reads as.** `wine-app-product-context.md` §5
  and §6 currently describe the additive layer model as showing *every* configured
  source distinctly ("each speaks in its own voice"; "a user with more sources configured
  gets a more complete picture, not a different one") — a principle that has held since
  early phases and is the reason `review_data` stores every retailer's score rather than
  one blended number. Comment 3 asks to surface one prioritized score by default. That's
  smaller than blending scores together — nothing about the *stored* data needs to
  change, and every score can presumably still be reached on drill-down — but it is a
  real reversal of the *display* half of that principle, not a copy tweak. Comment 4
  ("each source in its own voice doesn't add anything") on the same canvas reads as
  consistent with this: the developer's intent may be that the additive-layer principle
  should keep governing the data model but not dictate the default display. Worth
  confirming that reading explicitly before the next design iteration builds around it,
  rather than treating the UI-copy comment and the prioritization comment as two
  unrelated notes.
- **Comment 2 is underspecified as recorded.** Unclear whether "quick add or remove from
  the discovered queue" means faster tagging during the Discovery Review draft/promote
  decision (Phase 9.4's Save-to-Collection flow), or a lighter way to toggle
  `tag_discovered` on a wine already in the collection (already possible today via the
  existing tag-toggle row, just not "quick"). Worth a clarifying question in the next
  round rather than guessing at the interaction before building it.

**No changes made to `build-phases.md`, `CLAUDE.md`, or `wine-app-product-context.md`
this session** — the 2026-08-24 pass already covered the toolchain and Phase 10 record
correctly, and the two items above are additions to think about next, not corrections to
what's already written. This file exists so that record isn't lost before the next
session picks the design review back up.
