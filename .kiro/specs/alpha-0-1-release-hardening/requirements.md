# Requirements: Alpha 0.1 Release Hardening

## Problem

LocalCut Studio has merged phases 1–22 plus several bugfix specs, but documentation, UI labels, and verification checklists have not kept pace. The README shows Phase 8 as active. The architecture phase table marks completed phases as "Planned." There is no alpha support boundary document, no deployment smoke checklist, no media fixture validation guide, and no release gate script. Experimental features (scopes, render queue, project bundles, compatibility tiers, advanced trim modes, color/LUT pipeline) are presented identically to stable features. A tester cannot tell what is supported, what is experimental, and what to expect when something fails.

## Goals

1. Sync project truth across README, `.kiro/steering/architecture.md`, `docs/`, and in-app Help.
2. Define v0.1 alpha supported vs experimental features with a clear boundary document.
3. Create a browser verification matrix for the deployed app.
4. Create a media fixture checklist for manual/local validation.
5. Add an alpha release checklist and optional `verify` script.
6. Ensure UI labels mark experimental or incomplete features honestly.
7. Ensure diagnostics include build identity and explain failures clearly.
8. Ensure the core import → play → edit → export → reload/restore loop is not blocked by experimental features.
9. Keep `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` green.

## Non-goals

- No new media features, effects, or editing tools.
- No AI features, AI copy, AI docs, AI placeholders, AI dependencies, or AI roadmap items.
- No server-side processing, accounts, telemetry, or cloud sync.
- No new heavy dependencies.

## Product invariant

- Local-first browser-native NLE.
- Client compute only; Cloudflare serves static assets and COOP/COEP headers.
- SolidJS UI on main thread; pipeline worker owns media/timeline/playback/export.
- Mediabunny remains primary media I/O.
- Compatibility paths must be clearly labeled.
- No main-thread sustained media work.
- No CPU pixel readback in accelerated preview/export hot path.

## Acceptance criteria

1. README, `.kiro/steering/architecture.md`, docs, and in-app Help agree about current status.
2. No AI product references exist (AI agent instructions in AGENTS.md/README are fine).
3. Alpha-supported vs experimental features are clearly separated in `docs/ALPHA.md`.
4. A tester can open `docs/VERIFY_DEPLOYMENT.md` and manually verify the deployed app.
5. A tester can use `docs/MEDIA_FIXTURES.md` to validate real media behavior.
6. `docs/RELEASE_CHECKLIST.md` covers build/test/lint/format/smoke gates.
7. Core import → play → edit → export path is not blocked by experimental features.
8. Diagnostics include app version and build SHA when available.
9. `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` pass.
