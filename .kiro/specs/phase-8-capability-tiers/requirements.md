# Requirements: Phase 8 — Capability Tiers + Compatibility Engine

## R0 — Client Compute

- **R0.1** Core editing and export must run in the user's browser CPU/GPU.
- **R0.2** Cloudflare deployment may serve static assets and headers only; no required server media pipeline.
- **R0.3** Limited modes must remain client-side; do not solve browser limitations by uploading user media.

## R1 — Capability Detection

- **R1.1** Detect `crossOriginIsolated`, `SharedArrayBuffer`, WebGPU, WebCodecs, OffscreenCanvas, File System Access, and AudioWorklet independently.
- **R1.2** Store the active capability tier in UI state and expose it in persistent chrome.
- **R1.3** Missing one premium feature must not blank or crash the app shell.

## R2 — Accelerated Tier

- **R2.1** Preserve the existing worker-owned WebGPU/WebCodecs/SAB pipeline.
- **R2.2** Preserve zero CPU pixel round-trips on the accelerated preview/export path.
- **R2.3** Preserve bounded export queues and `VideoFrame.close()` ownership.

## R3 — Limited Tier

- **R3.1** Show a plain-language explanation of the missing capability and next action.
- **R3.2** Disable only the controls that the current tier cannot run.
- **R3.3** Future limited preview/export paths must be separate from the accelerated engine and visibly labeled.

## R4 — Tests

- **R4.1** Unit-test capability tier derivation.
- **R4.2** Component-test limited-mode rendering.
- **R4.3** Smoke-test accelerated mode in Chromium with COOP/COEP.
