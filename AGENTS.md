# AI Agent Quickstart (Kiro Workflow)

Use this file as a **thin router**. Read steering before coding; specs live under `.kiro/specs/`.

## Read steering first

- [**Product vision**](.kiro/steering/product.md) — fully local NLE for mid-tier creators; performance is the product.
- [**Architecture**](.kiro/steering/architecture.md) — threading model, zero-copy GPU path, development phases (non-negotiable).
- [**Technical constraints**](.kiro/steering/tech.md) — SolidJS + Vite, Mediabunny, WebGPU/WebCodecs, Cloudflare Pages PWA.
- [**Repository structure**](.kiro/steering/structure.md) — `src/ui/` vs `src/engine/`, naming, layout.
- [**UI standards**](.kiro/steering/ui-standards.md) — dark professional-tool aesthetic, bespoke timeline.
- [**Review policy**](.kiro/steering/review.md) — PR review workflow and hard architectural gates.

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

## Cursor Cloud specific instructions

- **COOP/COEP** are load-bearing: `public/_headers` and `vite.config.ts` `server.headers` / `preview.headers`.
- **WebGPU + WebCodecs** require a modern Chromium browser; engine code runs in the pipeline worker, not on main.
- **Phase 1** proves threading + import only; do not add Canvas2D preview or main-thread decode as a shortcut.
