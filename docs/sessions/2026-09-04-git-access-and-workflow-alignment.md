# 2026-09-04 — Git access for Claude AI, PR #30 review, Phase 10.6, workflow alignment

**Session:** Claude AI (Cowork), attached to the Wine App Claude.ai Project.
**Status:** Complete.

## What was done

1. **Diagnosed a doc-drift/handoff failure.** Claude Code re-asked questions about Phase
   10.5 scope (route fix, `wine_color`, cellar capacity) that were already answered —
   traced to `CLAUDE.md` §14's own documented gap: the Claude.ai project context copy of
   the planning docs can lag the repo, and at the time it had.

2. **Gave Claude AI direct git write access to this repo**, driven through the developer's
   linked computer (the desktop device bridge) rather than a hosted git integration. Setup:
   a GitHub fine-grained PAT scoped to only this repo with `Contents: Read and write`,
   stored as a repo-local git credential helper file inside `.git/` (not committed, not in
   the sandbox's ephemeral home — persists on the developer's actual disk across sessions).
   Verified with a real push/delete test.

3. **Reviewed merged PR #30 against the planned Phase 10.5.** All four backend deliverables
   (the `include_drafts`/`q` route fix, `wine_color` extraction and schema, the
   `app_settings`/`cellar_capacity` table, search) matched spec. Scope had legitimately
   expanded to include frontend — confirmed via a developer decision made directly inside
   that Claude Code session — not a defect. One cosmetic note: `/api/settings` shipped as
   `PUT`, not the originally-discussed `PATCH`; left as-is.

4. **Found and closed the one real gap:** Phase 10.5's own documentation-correction
   deliverable (edits to `wine-app-product-context.md` and a reasoning fix in the design
   requirements spec) never landed anywhere. Closed as **Phase 10.6** — see
   `docs/build-phases.md` — committed directly to `main` (docs-only, no branch/PR, per
   §13's exception).

5. **Documented the new working arrangement** in `CLAUDE.md` §13 (docs-only direct-to-main
   exception) and §14 (Roles: Claude AI owns planning/strategy and pushes doc updates
   straight to the repo; Claude Code stays execution-focused and reads those docs as
   settled; both tools may commit documentation directly, and neither has to route through
   the other first).

## Key decision

Planning and requirements work happens in Claude AI; documentation changes get pushed
directly to the repo from wherever they're made, instead of accumulating in the Claude.ai
project context and being synced later. The project context copies are now strictly a
mirror of the repo, refreshed after every doc push — never the other way around. This
replaces the "the project context copy may lag behind" tolerance that was previously
written into `CLAUDE.md` §14, which is what allowed the Phase 10.5 divergence (item 4
above, and PR #30) to happen in the first place.

## Note for future sessions

While reconciling the Claude.ai project docs to the repo during this session, one sync
step (`claude/phase-10-v2-web-ui-design-requirements.md`) briefly overwrote a more current
project-context version with an older repo snapshot missing the 2026-09-02 amendments.
Caught and corrected within the same session before it was reported out — worth knowing
this failure mode exists: when reconciling, diff for expected recent content, don't assume
the repo copy is always the more complete one for files also edited independently in
Claude.ai project context in between repo syncs.
