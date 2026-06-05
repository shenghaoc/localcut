# AI Agent Quickstart (Kiro Workflow)

Use this file as a **thin router**. Read steering before coding; specs live under `.kiro/specs/`.

## Read steering first

- [**Product vision**](.kiro/steering/product.md) — fully local NLE for mid-tier creators; performance is the product.
- [**Architecture**](.kiro/steering/architecture.md) — threading model, zero-copy GPU path, development phases (non-negotiable).
- [**Technical constraints**](.kiro/steering/tech.md) — SolidJS + Vite, Mediabunny, WebGPU/WebCodecs, Cloudflare Pages PWA.
- [**Repository structure**](.kiro/steering/structure.md) — `src/ui/` vs `src/engine/`, naming, layout.
- [**UI standards**](.kiro/steering/ui-standards.md) — dark professional-tool aesthetic, bespoke timeline.
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

- [**Phase 2: Zero-copy preview**](.kiro/specs/phase-2-zero-copy-preview/tasks.md) — decode → `importExternalTexture` → OffscreenCanvas; playback loop; adaptive preview resolution; throughput probe.

**Planned:**

- [**Phase 3: Timeline + editing**](.kiro/specs/phase-3-timeline-editing/tasks.md) — authoritative timeline model + mirror; split/delete/reorder/trim; seamless playback; frame cache.
- [**Phase 4: Effect chain**](.kiro/specs/phase-4-effect-chain/tasks.md) — WGSL compute effects; single-submission chain; per-clip params; f16/f32 variants.
- [**Phase 5: Audio**](.kiro/specs/phase-5-audio/tasks.md) — AudioWorklet graph; audio as master clock; per-track gain/mute/solo; waveforms.
- [**Phase 6: Export**](.kiro/specs/phase-6-export/tasks.md) — pipelined decode → effects → encode → mux; backpressure; quality/speed presets; ETA.
- [**Phase 7: PWA + deployment**](.kiro/specs/phase-7-pwa-deployment/tasks.md) — installable offline PWA; Cloudflare Pages; production `crossOriginIsolated`.

**Completed:**

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

1. **Main thread does NO media work** — SolidJS UI only; all decode/GPU/encode/mux in `src/engine/worker.ts`.
2. **Zero CPU round-trips on the hot path** — `VideoFrame` → `importExternalTexture` → compute chain → encoder; never `getImageData` or Canvas2D readback in preview/export.
3. **`SharedArrayBuffer` clock** — high-frequency `currentTime` via shared memory, not `postMessage` at 60fps. Requires `crossOriginIsolated === true`.
4. **Single WebGPU command submission per frame** for the effect chain (Phase 4+).
5. **No server runtime** — static PWA on Cloudflare Pages; no accounts, telemetry, or cloud sync in v1.
6. **npm only** — `package-lock.json` is the lockfile; no `yarn.lock`, `pnpm-lock.yaml`, or `bun.lock`.

## Quality gate

1. `npm run build` → succeeds (strict TypeScript).
2. `npm test` → green; test count must not decrease for non-trivial logic changes.
3. `crossOriginIsolated` must remain `true` in dev and production (COOP/COEP).
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

- Media decode/encode/GPU work on the main thread (must live in `src/engine/worker.ts`).
- `getImageData`, Canvas2D readback, or any CPU pixel round-trip on the preview/export hot path.
- Per-frame `postMessage` for the playback clock instead of the `SharedArrayBuffer` clock.
- Missing COOP/COEP headers or `crossOriginIsolated` check.
- Server runtime, external API calls, telemetry, or cloud dependencies (v1 non-goal).
- `yarn.lock`, `pnpm-lock.yaml`, or `bun.lock` added (npm only).
- A `VideoFrame` not `.close()`d, or closed twice.
- Logic bugs, crashes, data loss, race conditions, or security issues introduced by the change.

**P1 — should fix this cycle:**

- Multiple `queue.submit` per frame for the effect chain (Phase 4+).
- `importExternalTexture` cached across frames.
- Unbounded frame queues without `encodeQueueSize` backpressure; frame cache without LRU + `.close()` on eviction.
- Effect chain run twice for preview vs export instead of sharing one processed texture.
- Media objects or WebGPU handles leaking into `src/ui/`; missing `onCleanup` for rAF/listeners.
- Unstable references causing unnecessary re-renders in the rAF clock loop.
- Silent failures: swallowed errors, empty catch blocks, missing handling on critical paths.
- Missing tests for timeline model, seek logic, or protocol types on non-trivial changes; tests that mock away the invariant under test.
- Inaccurate/outdated comments, weak types that fail to encode invariants, and dead code.

Be thorough but not noisy: surface every P0/P1 you can substantiate, and skip pedantic nits, pre-existing issues the PR didn't touch, and anything a linter already catches.

## Cursor Cloud specific instructions

- **COOP/COEP** are load-bearing: `public/_headers` and `vite.config.ts` `server.headers` / `preview.headers`.
- **WebGPU + WebCodecs** require a modern Chromium browser; engine code runs in the pipeline worker, not on main.
- **Phase 1** proves threading + import only; do not add Canvas2D preview or main-thread decode as a shortcut.
- **Single dev process** — no backend, database, Docker, or `.env` secrets. Only `npm run dev` (port **5173**) is required for interactive work; the pipeline worker is spawned automatically by the UI.
- **Remote browser access** — when testing via the Desktop pane, start Vite with `npm run dev -- --host 0.0.0.0` so Chrome can reach the server.
- **Quality gate in CI-like runs** — there is no separate lint script; use `npm run build` (strict `tsc` + Vite) and `npm test` (Vitest, Node environment).
- **Manual E2E smoke test** — open Chromium to `http://localhost:5173`, confirm the status bar shows the `crossOriginIsolated` badge, click **Import**, and load a local MP4/MOV/WebM. A tiny test clip can be generated with `ffmpeg` if none is checked in.
- **WebGPU in cloud VMs** — headless or software-rendered environments may report “No WebGPU adapter”; metadata import and the SAB clock still work. Full zero-copy preview requires hardware WebGPU.
