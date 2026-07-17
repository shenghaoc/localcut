---
inclusion: fileMatch
fileMatchPattern: ["**/*.test.ts", "src/engine/**"]
---

# Testing Standards

## Framework & Environment

- **Runner**: Vitest in Node environment (see `vitest.config.ts` / `package.json`).
- **Location**: co-located with source — `src/engine/foo.test.ts` alongside `src/engine/foo.ts`.
- **Scope**: engine modules and UI logic. SolidJS component behaviour is validated via Vitest Browser Mode (`src/**/*.browser.test.tsx`, `vp run test:browser`), which renders components in a real Chromium browser.

## What to Test

| Target | Requirement |
|--------|-------------|
| Timeline model (`timeline.ts`) | Every mutation: insert, split, trim, delete, reorder. Edge cases: empty track, single-frame clip, overlapping trim. |
| Seek / playback logic | Nearest keyframe lookup, LRU cache eviction, out-of-bounds seek. |
| Export plan & backpressure | `buildExportPlan`, ETA estimation, `encodeQueueSize` guard. |
| Effect chain parameters | Default values, clamping, identity pass-through. |
| Protocol types | `assertCrossOriginIsolated`, message discriminants — any non-trivial type guard. |
| Audio utilities | Ring-buffer arithmetic, sample-window mixing. |

Any non-trivial logic change **must** come with tests; the test count must not decrease from the previous green run.

## Mocking Strategy

- Mock **WebGPU**, **WebCodecs** (`VideoFrame`, `VideoEncoder`, `VideoDecoder`), and **Mediabunny** at the boundary — do not let mock fidelity replace the invariant under test.
- Use `vi.fn()` for callbacks; use real data structures (`Timeline`, `Clip`, `MediaInputHandle`) populated via factory helpers.
- Do not mock the module under test or the data types its logic operates on.

## What Not to Test

- Worker message dispatch (tested by integration).
- Shader correctness (GPU required; validate visually or with GPU conformance tools).
- SolidJS reactivity internals — test observable behaviour, not signal wiring.

## Integration Smoke Test

Manual only — no automated headless runner for GPU work:

1. `vp dev` → open Chromium → status bar shows accelerated tier.
2. Import a local MP4/MOV/WebM clip.
3. Cut, trim, reorder on the timeline.
4. Export → confirm valid, timed MP4 plays back correctly.
5. Verify limited mode displays when cross-origin isolation is absent (serve without COOP/COEP headers to test).

## Verification Gates

- **Static verification**: `vp run typecheck` runs stable `tsc --noEmit` as the canonical compatibility check. `vp run typecheck:native` runs native `tsgo --noEmit` over the same `tsconfig.json`; both results are required.
- **Unit tests**: `vp test run` must stay green with no test count regression before merging any non-trivial logic change.
- **Browser Mode tests**: `vp run test:browser` validates component and integration behaviour in real Chromium.
- **E2E tests**: `vp run test:e2e` validates full user flows when the changed scope requires it.
- **Full repository gate**: `vp run check` runs formatting, lint, both static type checks, unit tests, and the production build. CI uses this same entry point.
