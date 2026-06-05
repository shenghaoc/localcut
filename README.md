> **Note for AI Agents:** Please read [`AGENTS.md`](AGENTS.md) before proposing or making changes. Architecture invariants (off-main-thread media, zero-copy GPU, SAB clock) are non-negotiable.

# Browser Video Editor

Fully client-side, open-source, browser-based non-linear video editor. Performance-first: WebCodecs, WebGPU, Mediabunny, all local.

## Stack

- SolidJS + Vite + TypeScript (strict)
- Mediabunny — lazy `BlobSource` demux/mux
- WebGPU + WebCodecs (pipeline worker)
- Static PWA on Cloudflare Pages

## Kiro workflow and repository docs

This repo uses Kiro steering, specs, and skills. Canonical project intelligence lives in `.kiro/`:

- [`.kiro/steering/`](.kiro/steering/) — product, architecture, tech constraints, UI standards, review policy
- [`.kiro/specs/`](.kiro/specs/) — Design → Requirements → Tasks workflow per phase/feature
- [`.kiro/skills/`](.kiro/skills/) — reusable agent skill packs
- [`.kiro/settings/mcp.json`](.kiro/settings/mcp.json) — workspace MCP configuration

Top-level Markdown: [`AGENTS.md`](AGENTS.md) is canonical; [`CLAUDE.md`](CLAUDE.md) and [`GEMINI.md`](GEMINI.md) redirect to it.

## Status

**Phase 1 (done):** scaffolding, COOP/COEP, pipeline worker, SAB clock, Mediabunny metadata import.

**Phase 2 (done):** zero-copy decode → WebGPU preview, playback loop, adaptive resolution — see [`.kiro/specs/phase-2-zero-copy-preview/`](.kiro/specs/phase-2-zero-copy-preview/tasks.md) (manual GPU browser verify pending).

**Phase 3 (done):** [timeline + editing](.kiro/specs/phase-3-timeline-editing/tasks.md).

**Phases 4–6 (done):** [effect chain](.kiro/specs/phase-4-effect-chain/tasks.md), [audio](.kiro/specs/phase-5-audio/tasks.md), [export](.kiro/specs/phase-6-export/tasks.md).

**Phase 7 (done):** [PWA + deployment](.kiro/specs/phase-7-pwa-deployment/tasks.md).

## Requirements

- Modern Chromium desktop browser (WebCodecs + WebGPU for full functionality)
- `crossOriginIsolated === true` (COOP/COEP in `public/_headers` and Vite config)

## Development

```bash
npm install
npm run dev      # http://localhost:5173 — check status bar for crossOriginIsolated
npm run build
npm run preview
npm test
```

## PWA & Deployment

This project is configured as an installable Progressive Web App (PWA) and is designed to be deployed to **Cloudflare Pages**.

1. **Build**: `npm run build` generates static files in `dist/`.
2. **Service Worker**: `vite-plugin-pwa` auto-generates a service worker that precaches the app shell, allowing full offline use after the first load.
3. **COOP/COEP**: Cross-Origin Isolation headers are enforced via `public/_headers`, ensuring the `SharedArrayBuffer` clock works in production.
4. **Deploy**:
   ```bash
   npm run deploy
   ```
   *This uses Wrangler to deploy the `dist/` folder to Cloudflare Pages based on `wrangler.jsonc`.*

## License

MIT
