> **Note for AI Agents:** Please read [`AGENTS.md`](AGENTS.md) before proposing or making changes. The current invariant is client-compute-first: Cloudflare serves the static app and headers, while media work runs in the user's browser with accelerated and limited capability tiers.

# LocalCut Studio

Client-compute-first, browser-native non-linear video editor. Performance-first when the browser supports it: WebCodecs, WebGPU, Mediabunny, workers, and `SharedArrayBuffer`; honest capability tiers when it does not.

The deployment assumption is intentionally cheap: Cloudflare serves static assets and COOP/COEP headers, while the user's browser supplies the CPU/GPU for editing and export.

## Stack

- SolidJS + Vite + TypeScript (strict)
- Mediabunny — lazy `BlobSource` demux/mux
- WebGPU + WebCodecs accelerated engine (pipeline worker)
- Static PWA on Cloudflare static hosting; no server media pipeline

## Kiro workflow and repository docs

This repo uses Kiro steering, specs, and skills. Canonical project intelligence lives in `.kiro/`:

- [`.kiro/steering/`](.kiro/steering/) — product, architecture, tech constraints, UI standards, review policy
- [`.kiro/specs/`](.kiro/specs/) — Design → Requirements → Tasks workflow per phase/feature
- [`.kiro/skills/`](.kiro/skills/) — reusable agent skill packs
- [`.kiro/settings/mcp.json`](.kiro/settings/mcp.json) — workspace MCP configuration

Top-level Markdown: [`AGENTS.md`](AGENTS.md) is canonical; [`CLAUDE.md`](CLAUDE.md) and [`GEMINI.md`](GEMINI.md) redirect to it.

## Status — v0.1.0 Alpha

**Completed (phases 1–12, 14–22, 24–25):** scaffolding, COOP/COEP, pipeline worker, SAB clock, zero-copy WebGPU preview, timeline editing, GPU effect chain, audio mixing, pipelined export, PWA deployment, capability tiers, project persistence + undo/redo, timeline UX (zoom/scroll, snapping, multi-select, markers), media library (batch import, thumbnails, stills, audio-only, track management), multi-track compositing + transforms, titles/text, keyframes + LUT grading, audio mixing polish (master bus, pan, fades, meters), export expansion (H.264/VP9/AV1, resolution/fps/bitrate overrides, range export), media conformance, proxy/render cache, editing tools v2, colour management + scopes, captions/subtitles, render queue + export presets, release hardening (diagnostics, recovery, performance budgets, accessibility, release gates).

**Active:** [project packaging](.kiro/specs/phase-23-project-packaging/tasks.md), [cross-browser compatibility](.kiro/specs/phase-26-cross-browser-compatibility-engine/tasks.md).

**Planned:** [transitions](.kiro/specs/phase-13-transitions/tasks.md).

See [docs/ALPHA.md](docs/ALPHA.md) for the alpha support boundary — what is supported, what is experimental, and what is not available.

## Requirements

- Modern Chromium desktop browser with WebCodecs + WebGPU + `crossOriginIsolated === true` for the full-performance tier
- Reduced/limited client-side mode when required browser capabilities are missing
- COOP/COEP in `public/_headers` and Vite config for the accelerated SAB clock

## Development

```bash
pnpm ci            # Clean install from the lockfile (or pnpm install)
pnpm run dev       # http://localhost:5173 — check status bar for COOP/COEP OK
pnpm run check     # Full quality gate: format:check + lint + typecheck + test + build
pnpm run build
pnpm run test
pnpm run lint
pnpm run format
```

## PWA & Deployment

This project is configured as an installable Progressive Web App (PWA) and is designed to be deployed to **Cloudflare Workers with Static Assets**.

1. **Build**: `pnpm build` generates static files in `dist/`.
2. **Service Worker**: `vite-plugin-pwa` auto-generates a service worker that precaches the app shell, allowing full offline use after the first load.
3. **COOP/COEP**: Cross-Origin Isolation headers are enforced via `public/_headers`, ensuring the `SharedArrayBuffer` clock works in production.
4. **Deploy**:
   ```bash
   pnpm deploy
   ```
   _This uses Wrangler to deploy the `dist/` folder to Cloudflare Workers based on `wrangler.jsonc`._

## License

MIT
