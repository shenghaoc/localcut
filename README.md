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

**Phase 2 (active):** zero-copy decode → WebGPU preview — see [`.kiro/specs/phase-2-zero-copy-preview/`](.kiro/specs/phase-2-zero-copy-preview/tasks.md).

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

## License

MIT
