# Design — Codebase audit quality follow-ups

## Constraints

- Keep the SolidJS UI on the main thread and media work in the worker.
- Do not add a new dependency or runtime surface.
- Keep compatibility and unavailable states honest; no hidden cloud fallback.
- Prefer small shared helpers only when they replace duplicated behavior.

## Implementation

### Existing audit fixes

The branch already contains targeted fixes across engine and UI modules:

- engine helpers clamp or reject invalid numeric state,
- worker/capture/interpolation paths guard cleanup and error transitions,
- export and capability UI avoid stale or unavailable fallback state,
- CSS token usage avoids brittle hard-coded assumptions.

These fixes remain narrow and are covered by existing focused unit tests plus
the project quality gate.

### Shared audio insert row

`AudioInsertRow` provides the common structure for expandable audio-processing
rows. It separates the bypass action from the disclosure action:

- `Button` toggles bypass and reports `aria-pressed`.
- A sibling native `button type="button"` toggles expansion and owns
  `aria-expanded`.
- Optional icons are decorative; the visible label and status remain text.

This removes local `InsertRow` copies from Live Audio Chain and Voice Cleanup
without changing their configuration callbacks.

### Native disclosure headers

Replay Buffer, Live Audio Chain, and Voice Cleanup use native disclosure header
buttons. The shared panel CSS resets native button defaults (`width`, border,
background, font, color, and text alignment) so browser defaults do not change
the editor chrome.

### Regression guard

`audio-disclosure-semantics.test.ts` imports the relevant UI modules as raw
source and guards the invariant that these panels no longer implement
disclosure with `role="button"` or event-propagation workarounds. This follows
the repo's existing source-guard pattern for architectural invariants.
