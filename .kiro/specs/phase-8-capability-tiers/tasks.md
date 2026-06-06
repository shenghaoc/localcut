# Tasks: Phase 8 — Capability Tiers + Compatibility Engine

> Status: **Active**. Protect the accelerated path while making the app more useful on real browsers.

## Capability model

- [x] **T0.1** Document client-compute-first deployment: Cloudflare hosts the PWA; the user's browser CPU/GPU runs media work.
- [x] **T1.1** Replace fatal missing-isolation startup with a limited shell state.
- [x] **T1.2** Show accelerated/limited/COOP-COEP state in the toolbar.
- [ ] **T1.3** Extract capability derivation into a tested helper.
- [ ] **T1.4** Detect WebGPU/WebCodecs/File System Access/AudioWorklet independently before import.

## Limited UX

- [x] **T2.1** Show a persistent limited-mode explanation in the preview empty state.
- [ ] **T2.2** Add a capability drawer/panel with missing features and suggested actions.
- [ ] **T2.3** Make Import explain why it is unavailable in limited mode.

## Compatibility engine

- [ ] **T3.1** Design a reduced-resolution preview fallback that does not touch the accelerated path.
- [ ] **T3.2** Decide whether WebGL2, Canvas, or decode-only thumbnails are the right first fallback.
- [ ] **T3.3** Add tests proving fallback code cannot regress accelerated `queue.submit`/readback invariants.

## Verification

- [ ] **T4.1** Accelerated Chromium: import/play/seek/export smoke test.
- [ ] **T4.2** Non-isolated origin: limited shell renders, no fatal screen.
- [ ] **T4.3** `npm run build` and `npm test` green.
