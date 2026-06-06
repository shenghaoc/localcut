# Design: Phase 8 — Capability Tiers + Compatibility Engine

> Status: **Active** — align the product with browser-native editing across real hardware.

## Goal

Make LocalCut useful even when the premium browser APIs are not all available. The accelerated WebGPU/WebCodecs/SAB engine remains the target experience, but missing capabilities should produce clear tiering and reduced client-side workflows instead of a fatal screen. Cloudflare hosts the PWA; the user's browser does the media compute.

## Capability tiers

| Tier | Requirements | Experience |
|------|--------------|------------|
| Accelerated | WebCodecs, WebGPU, OffscreenCanvas, `SharedArrayBuffer`, COOP/COEP | Full preview, effects, audio sync, timeline editing, export |
- First fallback: **decode-only thumbnail** via `HTMLVideoElement` + one-shot Canvas2D in `src/compatibility/` (not WebGL2; keeps the path clearly separate from WebGPU preview).
| Blocked | Browser lacks core file/media APIs or unsupported security context | Show exact blocker and next action |

## Architecture

- Keep `src/engine/worker.ts` as the accelerated engine.
- Add compatibility modules only when they are client-side and separate from the accelerated path.
- Feature-detect each browser API independently; do not infer support from user agent.
- Surface the active tier in the toolbar and status bar.
- Never claim desktop-like performance in a reduced tier.
- Do not introduce server media processing, cloud storage, or upload requirements for core editing.

## UX

- First screen should say what the current browser can do.
- Import/transport/export controls disable only when the active tier cannot support them yet.
- Capability errors should be persistent, plain-language, and specific.
- Users should know whether installing, enabling hardware acceleration, changing browser, or serving with COOP/COEP will improve the tier.

## Validation

- Chromium isolated origin: accelerated tier.
- Same app without COOP/COEP: limited tier, no fatal shell crash.
- No WebGPU: limited tier with WebGPU-specific message.
- Build and test remain green.
