---
name: solid-patterns
description: SolidJS conventions for browser-editor main-thread UI. Use when editing src/ui/, wiring worker commands, or implementing reactive timeline/inspector controls.
metadata:
  version: "1.0.0"
---

# SolidJS Patterns — browser-editor

This project uses SolidJS on the **main thread only**. All media work lives in `src/engine/worker.ts`.

## Rules

1. **No media on main** — never import `mediabunny`, hold `VideoFrame`, or touch WebGPU from `src/ui/`.
2. **Clock from SAB** — use `createSharedClock()`; poll in rAF; do not `postMessage` per-frame time updates from worker to UI.
3. **Commands to worker** — use `worker-bridge.ts` typed `send()`; debounce inspector slider changes.
4. **Signals for UI state** — `createSignal` for metadata, import status, errors; worker owns playback truth in SAB.
5. **Canvas transfer once** — `PreviewCanvas` calls `transferControlToOffscreen()` on mount only; main never draws to it again.
6. **Cleanup** — `onCleanup` for rAF loops, workers, window event listeners (`App.tsx` drag/drop).
7. **Show keyed** — use `keyed` on `<Show>` when narrowing nullable object props (see `Inspector.tsx`).
8. **No meta-framework** — plain Solid + Vite; no SolidStart/router unless explicitly specced.

## Worker communication

```typescript
// UI sends intent
bridge.send({ type: 'seek', time: seconds });

// UI receives low-frequency state only
// { type: 'import-complete', metadata }, progress, errors
// NOT per-frame video frames or clock ticks
```

## File placement

| Concern | Location |
|---------|----------|
| Layout, panels | `src/ui/*.tsx` |
| Clock | `src/ui/clock.ts` |
| Protocol types | `src/protocol.ts` |
| Decode, GPU, export | `src/engine/*` |
