# Tasks: Bugfix — codebase audit quality follow-ups

> Status: **In review** (PR #155). Tasks map to `bugfix.md` and `design.md`.

## T1 — Verify review state and PR scope

- [x] Confirm PR #155 head branch and merge base against `origin/main`.
- [x] Fetch live review threads through GitHub; no unresolved threads were
  present.
- [x] Check flat PR comments for actionable feedback; only stale summary
  metadata remained.

## T2 — Preserve existing audit fixes

- [x] Keep the existing export fallback, app init, interpolation cleanup,
  capture-session cleanup, engine-helper, and CSS fixes in this branch.
- [x] Run focused engine tests for the existing helper fixes.

## T3 — Fix disclosure semantics and shared UI code

- [x] Add `src/ui/AudioInsertRow.tsx` as the shared audio insert-row helper.
- [x] Replace duplicated Live Audio Chain and Voice Cleanup `InsertRow`
  helpers with `AudioInsertRow`.
- [x] Convert Replay Buffer and Live Audio Chain panel headers from
  `div role="button"` to native `button type="button"` controls.
- [x] Reset native disclosure-button styling in `src/global.css`.
- [x] Add `src/ui/audio-disclosure-semantics.test.ts` to guard the invariant.

## T4 — Validation

- [x] `./node_modules/.bin/vp test run src/ui/audio-disclosure-semantics.test.ts`
- [x] `./node_modules/.bin/vp run typecheck`
- [x] `./node_modules/.bin/vp run check`

## T5 — PR metadata

- [x] Update PR #155 body so the summary matches the actual diff and review
  state.
