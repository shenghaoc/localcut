# Repository Structure

## Directory Layout

- **`.kiro/`** — Kiro steering, specs, skills, and workspace MCP config.
  - **`steering/`** — persistent rules loaded on every agent interaction.
  - **`specs/`** — feature specs (Design → Requirements → Tasks) or bugfix specs (Bugfix → Design → Tasks).
  - **`skills/`** — reusable agent skill packs with `SKILL.md` frontmatter.
  - **`settings/mcp.json`** — workspace MCP server configuration.
- **`src/ui/`** — Main-thread SolidJS. **No media objects.** Reads SAB clock; sends commands to worker.
- **`src/engine/`** — Pipeline worker modules. Pure TypeScript; no DOM; no SolidJS.
- **`src/compatibility/`** — Client-side limited-tier helpers (decode-only thumbnails, metadata probes). Must not import accelerated engine GPU/playback paths.
- **`src/protocol.ts`** — Shared message types and `assertCrossOriginIsolated`.
- **`public/_headers`** — COOP/COEP for Cloudflare Pages.
- **`public/icons/`** — PWA manifest icons.

## Engine Modules (`src/engine/`)

| Module | Responsibility |
|--------|----------------|
| `worker.ts` | Worker entry; WebGPU + OffscreenCanvas; command dispatch; SAB clock writes |
| `media-io.ts` | Mediabunny demux/decode/encode/mux |
| `gpu.ts` | Device, features, storage textures, timestamp queries |
| `effects.ts` | WGSL compute effect registry; single-submission chain |
| `timeline.ts` | Authoritative timeline model |
| `playback.ts` | Preview loop |
| `export.ts` | Pipelined export with backpressure |
| `audio.ts` | Web Audio + AudioWorklet |
| `frame-cache.ts` | LRU decoded-frame cache |
| `hardware-probe.ts` | Startup throughput probe |
| `shaders/*.wgsl` | Compute shader sources |

## Compatibility Modules (`src/compatibility/`)

| Module | Responsibility |
|--------|----------------|
| `video-events.ts` | Timed media element event helpers |
| `thumbnail.ts` | Decode-only reduced-resolution compatibility preview |

## UI Components (`src/ui/`)

| Component | Role |
|-----------|------|
| `App.tsx` | Worker, SAB, command/state wiring |
| `clock.ts` | SAB → Solid signals via rAF |
| `worker-bridge.ts` | Typed `postMessage` channel |
| `PreviewCanvas.tsx` | `transferControlToOffscreen()` once |
| `Timeline.tsx` / `TimelineTrack.tsx` / `TimelineClip.tsx` | Timeline UI |
| `Inspector.tsx` | Effect parameters |
| `Toolbar.tsx` | Import, transport, export |
| `capabilities.ts` | Feature detection and tier derivation |
| `CapabilityPanel.tsx` | Capability drawer with recovery actions |
| `LimitedPreview.tsx` | Labeled compatibility thumbnail preview |
| `ExportDialog.tsx` | Export progress |
| `Waveform.tsx` | Audio lane waveforms |

## Naming Conventions

- **Components**: `PascalCase.tsx` in `src/ui/`.
- **Engine modules**: `kebab-case.ts` in `src/engine/`.
- **Steering files**: `kebab-case.md`.
- **Spec directories**: `kebab-case/` under `.kiro/specs/`.
- **Skill directories**: `kebab-case/` under `.kiro/skills/`, each with `SKILL.md`.
- **Shaders**: `kebab-case.wgsl`; f16 variants: `*.f16.wgsl`.

## Tooling Policy

- Use workspace MCP config (`.kiro/settings/mcp.json`) for repo-relevant integrations.
- Agent-local config (`.agents/`) is untracked and out of repository history.
- Do not vendor generic framework skill bundles wholesale; reference project-specific skills in `.kiro/skills/`.
