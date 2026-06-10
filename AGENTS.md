# AI Agent Quickstart (Kiro Workflow)

Use this file as a **thin router**. Read steering before coding; specs live under `.kiro/specs/`.

## Read steering first

- [**Product vision**](.kiro/steering/product.md) — client-compute NLE for mid-tier creators; performance is the product.
- [**Architecture**](.kiro/steering/architecture.md) — accelerated pipeline, capability tiers, compatibility paths, development phases.
- [**Technical constraints**](.kiro/steering/tech.md) — SolidJS + Vite, Mediabunny, WebGPU/WebCodecs, Cloudflare static PWA.
- [**Repository structure**](.kiro/steering/structure.md) — `src/ui/` vs `src/engine/`, naming, layout.
- [**UI standards**](.kiro/steering/ui-standards.md) — dark professional-tool aesthetic, bespoke timeline.
- [**Code style**](.kiro/steering/style.md) — TypeScript strict conventions, SolidJS patterns, naming, CSS.
- [**Testing standards**](.kiro/steering/testing.md) — Vitest scope, mocking strategy, quality gate.
- [**Accessibility**](.kiro/steering/accessibility.md) — ARIA patterns, keyboard nav, contrast, focus management.
- [**Security**](.kiro/steering/security.md) — COOP/COEP, file handling, no secrets, user data policy.
- [**Review policy**](.kiro/steering/review.md) — Kiro/Claude review process + output format (`#review`); priorities live in [Review guidelines](#review-guidelines) below.

## Workspace MCP config

[`.kiro/settings/mcp.json`](.kiro/settings/mcp.json) — workspace MCP server configuration.

## Skills

Reusable packs in [`.kiro/skills/`](.kiro/skills/):

- **web-design-guidelines** — Web Interface Guidelines compliance checker.
- **solid-patterns** — SolidJS reactivity and main-thread UI conventions for this project.

## Specs (`.kiro/specs/`)

Each spec has `design.md`, `requirements.md`, and `tasks.md` (bugfix specs use `bugfix.md` instead of `requirements.md`).

**Active:**

- [**Phase 48: OpenTimelineIO export**](.kiro/specs/phase-48-otio-export/tasks.md) — TypeScript `ProjectDoc` → `.otio` serialiser (tracks, gaps, clips with P23 fingerprints, markers, transitions); `metadata.localcut` round-trip namespace; `project.otio` in the bundle root beside authoritative `project.json`; cuts-only CMX3600 EDL; documented `otioconvert` path for AAF/FCPXML.

- [**Bugfix: IMG_6213.mov media handling**](.kiro/specs/bugfix-img-6213-media-issues/tasks.md) — apply rotation metadata on placement, rotation-aware fit rect, VFR-aware frame cadence, codec-named warnings, Media Bin details popover, user-guide updates.

- [**Bugfix: Mixed-rate audio resampling**](.kiro/specs/bugfix-mixed-rate-audio/tasks.md) — streaming polyphase sinc resampler complementing Mediabunny; per-call target-rate `pcmWindowAt`/`pcmAt`; canonical playback ring rate; anti-aliased downsample; source-health + docs.

- [**Phase 26: Cross-browser compatibility engine**](.kiro/specs/phase-26-cross-browser-compatibility-engine/tasks.md) — CapabilityTierV2 probes, reduced-tier diagnostics, optional-SAB worker init, codec/export constraints, compatibility resource-lifetime helpers.

- [**Phase 23: Project packaging + portability**](.kiro/specs/phase-23-project-packaging/tasks.md) — directory bundles, fingerprint dedup, integrity validation, collect media, import/export.

**Completed:**

- [**Phase 27: WebCodecs decode bridge**](.kiro/specs/phase-27-webcodecs-decode-bridge/tasks.md) — direct `VideoDecoder`/`AudioDecoder` over Mediabunny demux; bounded backpressure; key-packet seek; `getDecoderConfig` extradata; codec support matrix; worker integration; DualStreamFrameSource; diagnostics surface.
- [**Phase 13: Transitions**](.kiro/specs/phase-13-transitions/tasks.md) — cut-point transition model; dual-stream readahead; 2-input mix pass in the single submission; export parity.
- [**WASM SIMD Audio Resampler**](.kiro/specs/wasm-simd-resampler/tasks.md) — hand-written WAT with wasm-simd128; Kaiser-windowed polyphase sinc; transparent JS fallback; build:wasm script; ≥2x throughput.

- [**Alpha 0.1 Release Hardening**](.kiro/specs/alpha-0-1-release-hardening/tasks.md) — documentation truth sync, alpha support boundary, deployment verification checklist, media fixture checklist, release gates, UI honesty labels, build metadata in diagnostics.
- [**Phase 25: Release hardening**](.kiro/specs/phase-25-release-hardening/tasks.md) — diagnostics, recovery, performance budgets, fixture matrix, accessibility, release gates.
- [**Phase 24: Render Queue + Export Presets**](.kiro/specs/phase-24-render-queue-presets/tasks.md) — saved export presets; multi-job render queue with sequential execution; full/range/marker-bounded jobs; output filename templates; queue persistence.
- [**Phase 22: Captions + subtitles**](.kiro/specs/phase-22-captions-subtitles/tasks.md) — SRT/VTT import, inline editing, timing, split/merge, style presets, burn-in, export.
- [**Phase 21: Colour management + scopes**](.kiro/specs/phase-21-colour-management-scopes/tasks.md) — waveform, vectorscope, histogram; BT.601/BT.709/Rec.2020/Display P3 conversions.
- [**Phase 20: Editing Tools V2**](.kiro/specs/phase-20-editing-tools-v2/tasks.md) — linked A/V clips; insert/overwrite edits; ripple delete/trim; roll/slip/slide; lift/extract; track lock/visibility/sync lock/edit targeting.
- [**Phase 19: Proxy/render cache**](.kiro/specs/phase-19-proxy-render-cache/tasks.md) — LRU frame cache, proxy generation, cache budgets, OPFS storage.
- [**Phase 18: Media conformance**](.kiro/specs/phase-18-media-conformance/tasks.md) — source health warnings, VFR detection, rotation metadata, codec validation.
- [**Phase 17: Export expansion**](.kiro/specs/phase-17-export-expansion/tasks.md) — probed codec/container choice (H.264/VP9/AV1); resolution/fps/bitrate overrides; in/out range export; persisted settings.
- [**Phase 16: Audio mixing polish**](.kiro/specs/phase-16-audio-mixing/tasks.md) — shared mix stage; master bus; per-track pan; clip fades + transition crossfades; AudioWorklet meters over SAB.
- [**Phase 15: Keyframes + advanced colour**](.kiro/specs/phase-15-keyframes-colour/tasks.md) — keyframe tracks with shared preview/export interpolation; Inspector keyframe UI; `.cube` LUT import as a 3D-texture pass.
- [**Phase 14: Titles + text**](.kiro/specs/phase-14-titles-text/tasks.md) — source-less title clips; edit-time OffscreenCanvas raster cached as a GPU texture keyed by content hash; bundled offline fonts (Inter/Lora OFL); transform-driven layout; toggleable safe-area guides.
- [**Phase 12: Multi-track compositing + transforms**](.kiro/specs/phase-12-compositing-transform/tasks.md) — layered resolve; N-layer single-submission composite; per-clip position/scale/rotation/opacity; preview gizmo; fit/letterbox.
- [**Phase 11: Media library + stills + tracks**](.kiro/specs/phase-11-media-library/tasks.md) — batch import; media bin with budgeted worker thumbnails; image-still + audio-only sources; explicit track management; filmstrips.
- [**Phase 10: Timeline UX + gap model**](.kiro/specs/phase-10-timeline-ux/tasks.md) — px-per-second zoom/scroll; gap-tolerant time-based moves; snapping; multi-select; copy/paste/duplicate; markers; keyboard map.
- [**Phase 9: Project persistence + undo/redo**](.kiro/specs/phase-9-persistence-undo/tasks.md) — versioned timeline serialization; worker-owned snapshot undo/redo; IndexedDB autosave + restore-on-launch; layered media re-linking.
- [**Phase 8: Capability-tier UX + compatibility engine**](.kiro/specs/phase-8-capability-tiers/tasks.md) — preserve the accelerated path while making missing browser capabilities understandable and recoverable.
- [**Phase 7: PWA + deployment**](.kiro/specs/phase-7-pwa-deployment/tasks.md) — installable offline PWA; Cloudflare Pages; production `crossOriginIsolated`.
- [**Phase 6: Export**](.kiro/specs/phase-6-export/tasks.md) — pipelined decode → effects → encode → mux; backpressure; quality/speed presets; ETA.
- [**Phase 5: Audio**](.kiro/specs/phase-5-audio/tasks.md) — AudioWorklet graph; audio as master clock; per-track gain/mute/solo; waveforms.
- [**Phase 4: Effect chain**](.kiro/specs/phase-4-effect-chain/tasks.md) — WGSL compute effects; single-submission chain; per-clip params; f16/f32 variants.
- [**Phase 3: Timeline + editing**](.kiro/specs/phase-3-timeline-editing/tasks.md) — authoritative timeline model + mirror; split/delete/reorder/trim; seamless playback; frame cache.
- [**Phase 2: Zero-copy preview**](.kiro/specs/phase-2-zero-copy-preview/tasks.md) — decode → `importExternalTexture` → OffscreenCanvas; playback loop; adaptive preview resolution; throughput probe.
- [**Phase 1: Scaffolding**](.kiro/specs/phase-1-scaffolding/tasks.md) — Vite + Solid, COOP/COEP, worker skeleton, SAB clock, Mediabunny metadata import.

## Useful commands

```bash
npm install    # Install dependencies
npm run dev    # Vite dev server (COOP/COEP headers enabled)
npm run build  # Typecheck + production build
npm run preview
npm test       # Vitest
```

## Architectural boundaries (hard gates)

1. **Main thread stays interactive** — no sustained decode/GPU/encode/mux/pixel loops on main. Bounded probes and labeled compatibility helpers are allowed when measured.
2. **Accelerated path has no CPU pixel round-trips** — `VideoFrame` → `importExternalTexture` → compute chain → encoder stays zero-copy. Compatibility paths may be slower only when separate, explicit, and visibly labeled.
3. **`SharedArrayBuffer` is the premium clock** — high-frequency accelerated playback uses SAB. If `crossOriginIsolated !== true`, keep the shell alive and show a limited capability tier instead of a dead-end fatal screen.
4. **Single WebGPU command submission per frame** for the accelerated effect chain (Phase 4+).
5. **Client-compute core editing** — import/edit/preview/effects/audio/export must run in the user's browser. Cloudflare is for static hosting and COOP/COEP headers, not server-side media processing.
6. **npm only** — `package-lock.json` is the lockfile; no `yarn.lock`, `pnpm-lock.yaml`, or `bun.lock`.

## Quality gate

1. `npm run build` → succeeds (strict TypeScript).
2. `npm test` → green; test count must not decrease for non-trivial logic changes.
3. Full-performance dev and production must keep COOP/COEP so `crossOriginIsolated === true`; missing isolation must show the limited capability tier rather than crashing the shell.
4. Every `VideoFrame` `.close()`d exactly once in engine code paths.

## Review guidelines

These guidelines drive **Codex** PR reviews (`@codex review`, or automatic reviews) and apply to every other review agent too. Codex reads this section per the [GitHub integration docs](https://developers.openai.com/codex/integrations/github), applying the closest `AGENTS.md` to each changed file. **This section is the single source of truth for review priorities** — the Kiro/Claude review process and output format live in [`.kiro/steering/review.md`](.kiro/steering/review.md), which extends (never restates) this checklist.

**Match the depth of Claude's [code-review](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md) and [pr-review-toolkit](https://github.com/anthropics/claude-code/blob/main/plugins/pr-review-toolkit/README.md) plugins.** Do **not** stop after one or two findings: review every changed file in full and run all the lenses below before concluding.

### Method (mirror Claude's multi-agent review)

1. Read **all** changed files end to end — never just the diff hunks.
2. Run each lens as an independent pass: guideline compliance, bug detection, resource/lifetime, error handling, tests, type design, comment accuracy, simplification.
3. Trace consumers when a `postMessage` protocol or `SharedArrayBuffer` layout changes; verify CSS selectors match the actual SolidJS DOM.
4. Report one finding per concrete issue with `file:line`, the impact, and a concrete fix — not a vague summary.

### Priorities (GitHub surfaces only P0 and P1 — classify accordingly)

**P0 — blocks merge (architectural hard-gate violations):**

- Sustained media decode/encode/GPU/pixel processing on the main thread without an explicit measured compatibility-tier design.
- `getImageData`, Canvas2D readback, or CPU pixel round-trip in the accelerated preview/export hot path.
- Per-frame `postMessage` for the accelerated playback clock when `SharedArrayBuffer` is available.
- Missing COOP/COEP headers for the full-performance build, or missing user-facing capability handling when `crossOriginIsolated` is false.
- Server runtime, external API calls, telemetry, cloud storage, or paid server compute required for core editing/export.
- `yarn.lock`, `pnpm-lock.yaml`, or `bun.lock` added (npm only).
- A `VideoFrame` not `.close()`d, or closed twice.
- Logic bugs, crashes, data loss, race conditions, or security issues introduced by the change.

**P1 — should fix this cycle:**

- Multiple `queue.submit` per frame for the accelerated effect chain (Phase 4+).
- `importExternalTexture` cached across frames.
- Unbounded frame queues without `encodeQueueSize` backpressure; frame cache without LRU + `.close()` on eviction.
- Accelerated effect chain run twice for preview vs export instead of sharing one processed texture.
- Media objects or WebGPU handles leaking into `src/ui/`; missing `onCleanup` for rAF/listeners.
- Unstable references causing unnecessary re-renders in the rAF clock loop.
- Silent failures: swallowed errors, empty catch blocks, missing handling on critical paths.
- Missing tests for timeline model, seek logic, or protocol types on non-trivial changes; tests that mock away the invariant under test.
- Inaccurate/outdated comments, weak types that fail to encode invariants, and dead code.
- Missing or outdated user-facing documentation in `docs/` for user-visible changes. Docs live in the repo as the single source of truth and are rendered both on GitHub and in the in-app Help panel.

Be thorough but not noisy: surface every P0/P1 you can substantiate, and skip pedantic nits, pre-existing issues the PR didn't touch, and anything a linter already catches.

## Cursor Cloud specific instructions

- **COOP/COEP** are load-bearing: `public/_headers` and `vite.config.ts` `server.headers` / `preview.headers`.
- **WebGPU + WebCodecs** require a modern Chromium browser for full performance; engine code runs in the pipeline worker, not on main.
- **Preview shortcuts must be capability-tiered** — do not regress the worker WebGPU path. If adding Canvas/WebGL/CPU fallback preview, keep it separate, reduced capability, and visibly labeled.
- **Single dev process** — no backend, media server, database, Docker, or `.env` secrets. Only `npm run dev` (port **5173**) is required for interactive work; the pipeline worker is spawned automatically by the UI.
- **Remote browser access** — when testing via the Desktop pane, start Vite with `npm run dev -- --host 0.0.0.0` so Chrome can reach the server.
- **Quality gate in CI-like runs** — there is no separate lint script; use `npm run build` (strict `tsc` + Vite) and `npm test` (Vitest, Node environment).
- **Manual E2E smoke test** — open Chromium to `http://localhost:5173` (or the server's remote URL when using `--host 0.0.0.0`), confirm the status bar shows the accelerated/COOP-COEP OK tier, click **Import**, and load a local MP4/MOV/WebM. Also verify a non-isolated/missing-capability run shows limited mode instead of a blank app. A tiny test clip can be generated with `ffmpeg` if none is checked in.
- **WebGPU in cloud VMs** — headless or software-rendered environments may report “No WebGPU adapter”; metadata import and the SAB clock still work. Full zero-copy preview requires hardware WebGPU.
