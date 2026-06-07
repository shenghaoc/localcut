# Bugfix — UI polish, accessibility, and crash recovery

> Status: **Active**. Bugfix spec for UI-level issues: accessibility gaps, crash resilience,
> resource leaks, and UX dead-ends. No engine or protocol changes.

## Summary

The UI layer has accumulated several issues that degrade accessibility, crash recovery,
and basic UX polish. This spec fixes them without changing the architecture or protocol.
No new features; no engine changes.

The architecture remains:
- SolidJS UI on the main thread; the pipeline worker owns media, timeline, playback, WebGPU,
  export, and authoritative transport-clock writes.
- No sustained decode/encode/GPU/media work on the main thread.
- No server-side media compute.

## Bugs

### B1 — AudioEngine `init()` caches a rejected promise permanently (P0)

`audio-engine.ts`: `init()` sets `this.ready = this.setup(...)` on first call and always
returns `this.ready` thereafter. When audio setup fails, recovery actions ("retry-audio")
call `init()` again, which immediately returns the same rejected promise. Audio is
permanently dead until page reload.

**Expected:** `init()` checks whether the cached promise rejected; if so, nulls it and
re-initializes.

### B2 — rAF loop spins at 60fps after worker crash (P0)

`clock.ts`: `setActive(false)` sets `active = false` so the rAF callback skips signal
updates, but the rAF loop **keeps running** at full frame rate doing nothing. The
`cancelAnimationFrame(rafId)` cleanup only fires on component unmount. This violates
"main thread stays interactive" by burning CPU during recovery.

**Expected:** `setActive(false)` cancels the rAF handle. `setActive(true)` restarts it.

### B3 — `SharedArrayBuffer` constructor can crash the app at startup (P0)

`App.tsx`: `new SharedArrayBuffer(CLOCK_BUFFER_BYTES)` is called unconditionally if the
constructor exists. Firefox without COOP/COEP exposes the constructor but throws on
construction, crashing `App()` before any error boundary.

**Expected:** Wrap SAB construction in try/catch; fall back to `null` on failure.

### B4 — `AudioEngine.play()` swallows `context.resume()` rejection (P0)

`audio-engine.ts`: `play()` calls `await this.context.resume()` without try/catch. All
callers use `void audioEngine.play(t)`, swallowing the rejection. Playback fails with
zero feedback.

**Expected:** Wrap `resume()` in try/catch; log the error and return early so callers
don't proceed into a broken state.

### B5 — Worker bridge message listener never removed (P1)

`worker-bridge.ts`: `createWorkerBridge` adds a `message` listener but returns no
`dispose()`. On worker restart, the old listener holds a reference to the `onState`
closure. While the terminated worker is eventually GC'd, the listener leak compounds
during rapid restarts.

**Expected:** Return a `dispose()` method that removes the listener. Call it during
`restartWorker()`.

### B6 — CapabilityPanel and DiagnosticsPanel lack focus trapping (P1)

Both dialogs use `aria-modal="true"` but don't trap focus. Tab/Shift+Tab can escape
to background elements. WCAG 2.1 requires modal dialogs to constrain focus.

**Expected:** Implement a simple focus-trap: on Tab at last focusable element → wrap
to first; on Shift+Tab at first → wrap to last. Use `onKeyDown` with a query selector
for focusable elements.

### B7 — CapabilityPanel doesn't auto-focus when opened (P1)

`DiagnosticsPanel.tsx` uses `requestAnimationFrame(() => panelRef?.focus())` when
`props.open` becomes true. `CapabilityPanel.tsx` does not. Keyboard users must tab
through the entire app to reach the panel.

**Expected:** Add the same auto-focus pattern to `CapabilityPanel`.

### B8 — Status bar has no `aria-live` region (P1)

The status bar shows critical state changes ("Export complete", "Worker crashed") but
isn't announced to screen readers. Users relying on assistive tech miss important
notifications.

**Expected:** Add `role="status"` and `aria-live="polite"` to the status bar element.

### B9 — Missing error boundary (P1)

If any UI component throws during render, the entire app crashes with a white screen.
SolidJS doesn't have built-in error boundaries.

**Expected:** Wrap the main workspace in an `ErrorBoundary` component that catches
errors and shows a fallback UI with a "Reload" button. Use `onError` in a parent
`<ErrorBoundary>` pattern.

### B10 — Throttled worker crash leaves user stranded (P1)

When `crashState === 'throttled'`, `handleWorkerCrash` resets all UI signals but does
NOT call `restartWorker()`. The only path forward is page reload, but nothing tells
the user that.

**Expected:** Update the status message to include "Reload the page to recover."

### B11 — Transport Play/Pause buttons missing `aria-label` (P1)

`Toolbar.tsx`: Play and Pause `<Button>` components lack `aria-label`. Screen readers
announce them based on their visible text content ("Play"/"Pause"), which works but
lacks context (which transport?).

**Expected:** Add `aria-label="Play transport"` and `aria-label="Pause transport"`.

### B12 — TranscriptPanel row checkboxes have no visible label (P1)

The segment-row checkboxes use `aria-label` but have no `<label>` element. Users who
click the row area (not the checkbox square) may miss the toggle. WCAG 1.1.1 requires
non-text content to have a text alternative.

**Expected:** Wrap checkboxes in `<label>` elements, or use a visible text label.

### B13 — Inspector slider flickers on first drag (P1)

`Inspector.tsx`: `setTransformDraft((prev) => (prev ? { ...prev, [key]: value } : prev))`
drops the value when `prev` is `null`. Between user input and the effect that syncs
`transformDraft` from props, there's a 1-frame window where the slider snaps back.

**Expected:** Fall back to the prop value when draft is null.

### B14 — Waveform has empty `onCleanup` dead code (P2)

`Waveform.tsx:44`: `onCleanup(() => {})` registers a no-op cleanup. Remove it.

### B15 — Drag overlay uses fragile `relatedTarget === null` (P2)

`App.tsx`: the `dragleave` handler checks `e.relatedTarget === null` to detect
cursor leaving the window. This can be `null` in other edge cases (element removed
from DOM, iframe/shadow DOM boundary).

**Expected:** Use a drag-depth counter: increment on `dragenter`, decrement on
`dragleave`, show overlay when counter > 0.

### B16 — Toolbar `aria-valuetext` can format `NaN` (P2)

`Toolbar.tsx:177`: `props.masterGain.toFixed(2)` produces `"NaN"` if `masterGain`
is `NaN` or `Infinity`.

**Expected:** Guard with `Number.isFinite()`.

### B17 — Timeline scrubber `role="slider"` doesn't match keyboard behavior (P2)

`Timeline.tsx`: the ruler has `role="slider"` but ArrowLeft/Right step frames and
PageDown/Up step ±1s. Standard ARIA sliders use Arrow keys with step sizes. Screen
readers may misrepresent the widget.

**Expected:** Change to `role="application"` with `aria-roledescription="timeline seek control"`, or adjust keyboard behavior to match slider conventions.

## Non-goals

- No engine/protocol/worker changes.
- No new features.
- No CSS-only refactors.
- No server-side changes.

## Acceptance criteria

- AudioEngine retry works after a failed init.
- rAF loop stops when `setActive(false)` is called.
- SAB construction failure doesn't crash the app.
- Audio resume rejection doesn't silently break playback.
- Worker bridge listeners are properly cleaned up.
- CapabilityPanel and DiagnosticsPanel trap focus.
- CapabilityPanel auto-focuses when opened.
- Status bar is a live region.
- App has an error boundary with fallback UI.
- Throttled crash message suggests page reload.
- Transport buttons have `aria-label`.
- Transcript checkboxes have visible labels.
- Inspector slider doesn't flicker.
- Waveform has no dead code.
- Drag overlay is reliable.
- Toolbar `aria-valuetext` never shows `NaN`.
- `npm run build` and `npm test` pass.
