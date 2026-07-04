# Bugfix — Codebase audit quality follow-ups

> Status: **In review** (PR #155). This spec tracks a focused audit pass over
> correctness, lifetime, error handling, CSS token safety, and UI accessibility
> regressions found after the merged-phase bugfix work.

## Why this exists

PR #155 is not a feature phase. It is a code-quality fix-up branch for defects
that were small enough to miss in earlier phase reviews but still affect
runtime correctness, user-visible UI, or maintainability.

The live GitHub review state for this PR has no unresolved review threads. The
remaining work is therefore a direct code audit: verify the existing fixes,
remove stale PR claims, and add only high-confidence follow-ups that preserve
the architecture.

## Scope

In scope:

- logic bugs that can produce wrong output, invalid state, or broken fallback
  paths,
- lifetime and cleanup bugs, especially worker/capture/interpolation resource
  handling,
- CSS regressions where a token or native-control default can break the editor
  chrome,
- accessibility bugs in interactive Solid UI controls,
- narrow shared refactors that replace duplicated panel logic without changing
  product behavior,
- tests or source guards for the fixed invariants.

Out of scope:

- new editing features,
- broad visual redesign,
- server-side media processing or telemetry,
- speculative rewrites without a concrete bug or repeated duplication.

## Bugs

### B1 — Export dialog fallback can pick an unavailable codec

The export fallback path must not select a codec/container that the current
capability probe marks unavailable. Unsupported codecs remain visible but
disabled with a reason.

**Expected:** fallback selection is derived from available options only.

### B2 — App init can send worker init before capability state is ready

Worker init must use the latest capability probe and backend-readiness state.
Sending init from a stale closure can leave the shell in a mismatched state
after startup or restart.

**Expected:** init is sent after the relevant capability state has settled.

### B3 — Interpolation dispose path can double-dispose GPU resources

Interpolation engine teardown must tolerate repeated dispose calls and partial
initialization failures.

**Expected:** GPU and ORT-owned resources are released at most once.

### B4 — Capture session error path bypasses state cleanup

Capture session failures must flow through the same cleanup path as explicit
stop, including duplicate `onError` protection and state reset.

**Expected:** one terminal callback, one state transition, no leaked active
session after an error.

### B5 — Engine helpers accepted invalid numeric inputs

Small helpers in auto-zoom, color mapping, frame-source timing, and replay-ring
statistics need finite-value guards so malformed or boundary inputs do not
produce `NaN`, negative sizes, or misleading state.

**Expected:** invalid inputs clamp, fall back, or return an explicit empty
state, matching the helper contract.

### B6 — Panel disclosure headers mixed native and custom button semantics

Replay Buffer and Live Audio Chain still implemented their primary disclosure
headers as `div role="button"` with hand-written key handling, while Voice
Cleanup had moved to a native button. The shared CSS also lacked a native button
reset, so the fixed Voice Cleanup header could inherit browser button chrome or
shrink to content width.

**Expected:** all panel disclosure headers are native `button type="button"`
controls, with CSS reset rules that preserve the existing panel layout.

### B7 — Audio insert rows duplicated nested-interactive disclosure logic

Live Audio Chain and Voice Cleanup each carried a local `InsertRow` helper. The
row used an outer `div role="button"` as the disclosure trigger and placed a
bypass `Button` inside it, creating nested interactive controls and duplicated
keyboard behavior.

**Expected:** one shared Solid component owns the audio insert-row structure;
the bypass button and expand button are sibling native controls, not nested
interactive elements.

## Acceptance criteria

- PR #155 has no unresolved GitHub review threads.
- The PR body matches the actual diff and does not claim reverted fixes.
- The Kiro spec documents the audit scope and the follow-up fixes.
- New UI disclosure code has no `role="button"` fallback for native button
  behavior.
- Focused regression tests, typecheck, and the full `vp run check` gate pass.
