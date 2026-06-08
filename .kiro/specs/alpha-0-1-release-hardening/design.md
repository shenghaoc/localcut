# Design: Alpha 0.1 Release Hardening

## Approach

Documentation-first hardening pass. No new features, no architectural changes, no new dependencies. The work is: update docs to reflect reality, label experimental features honestly, expose build identity in diagnostics, and give testers verification checklists.

## T1 — Documentation truth sync

**README.md**: Update the Status section to list all completed phases (1–22) accurately, mark active work (phases 23, 24, 26, bugfixes), and remove the "Phase 8 (active)" claim. Keep the AI agent note (it's about coding agents, not product AI).

**architecture.md**: Update the phase table so completed phases show "Done," active phases show "Active," and planned phases show "Planned." Add missing phases 18–25.

**No new docs files for T1** — the truth sync is about correcting existing files.

## T2 — Alpha support boundary

Create `docs/ALPHA.md` defining:
- **Supported** (alpha happy path): import MP4/MOV/WebM → play → seek → split/trim/move → add title/caption → apply effects → export H.264 MP4 → reload → restore.
- **Experimental**: compatibility preview/export, scopes, render queue, project bundles, advanced trim modes (roll/slip/slide), color/LUT pipeline, cross-browser reduced tiers.
- **Not supported**: collaboration, cloud sync, accounts, mobile, AI anything.

## T3 — Public deployment smoke checklist

Create `docs/VERIFY_DEPLOYMENT.md` with a step-by-step checklist a tester can follow on the deployed app. Includes COOP/COEP verification, capability tier check, import/play/seek, audio, export, diagnostics copy, reload/restore, PWA install. Browser matrix table for Chrome/Edge full tier and reduced-tier browsers.

## T4 — Media fixture checklist

Create `docs/MEDIA_FIXTURES.md` defining local fixture categories (H.264 MP4, iPhone MOV, WebM VP9, VFR recording, audio-only, SRT, WebVTT, long file, corrupt file) with expected behavior for each stage (import, diagnostics, preview, timeline, export). No media files committed.

## T5 — Release gate script

Create `docs/RELEASE_CHECKLIST.md` with the full gate sequence. Add a `"verify"` script to package.json that chains `lint && format:check && test && build`.

## T6 — UI honesty pass

Audit UI labels. This is a code review pass — if features like scopes, render queue, project bundles, or compatibility tiers lack "Experimental" labels, add them. If incomplete features are prominent, add "(Experimental)" suffixes to button/panel titles. Minimal code changes.

## T7 — Diagnostics alpha pass

The diagnostics infrastructure from Phase 25 is comprehensive. This task ensures the snapshot includes `buildId` (commit SHA via Vite define) and that the version is visible. Add `__BUILD_SHA__` define to `vite.config.ts` and expose it in the diagnostic snapshot.

## T8 — Deployment metadata

Wire `__BUILD_SHA__` into `diagnostic-snapshot.ts` and the diagnostics report. The SHA comes from `git rev-parse --short HEAD` at build time via Vite's `define` config.

## T9 — Regression check

Run `npm run verify` (the new script) and confirm green. No merge unless all gates pass.

## File change summary

| File | Change |
|------|--------|
| `README.md` | Update Status section |
| `.kiro/steering/architecture.md` | Update phase table |
| `docs/ALPHA.md` | New — alpha support boundary |
| `docs/VERIFY_DEPLOYMENT.md` | New — deployment smoke checklist |
| `docs/MEDIA_FIXTURES.md` | New — media fixture validation |
| `docs/RELEASE_CHECKLIST.md` | New — release gate checklist |
| `package.json` | Add `"verify"` script |
| `vite.config.ts` | Add `__BUILD_SHA__` define |
| `src/ui/diagnostic-snapshot.ts` | Add `buildId` to snapshot |
| `src/ui/RenderQueuePanel.tsx` | Add "(Experimental)" label |
| `src/ui/BundleDialog.tsx` | Add "(Experimental)" label |
| `src/ui/ScopePanel.tsx` | Add "(Experimental)" label |
| `AGENTS.md` | Update spec listing |
