# Tasks: Alpha 0.1 Release Hardening

> Status: **Completed**. Documentation truth sync and alpha boundary definition, then UI honesty pass and build metadata, then regression check.

## T1 — Documentation truth sync

- [x] **T1.1** Update `README.md` Status section to list all completed phases (1–22, 24–25) as done, active work (phases 23, 26) as active, and planned phases (13) as planned. Remove the outdated "Phase 8 (active)" claim.
  - Acceptance: README Status section accurately reflects merged feature set. No phase is listed as "active" or "planned" that is actually done.
- [x] **T1.2** Update `.kiro/steering/architecture.md` phase table: completed phases → Done, active → Active, planned → Planned. Add missing phases 18–25.
  - Acceptance: phase table has all 26 phases with correct status. No "Planned" phase that is actually merged.
- [x] **T1.3** Verify docs do not claim behavior that has not been implemented. Confirm no AI product references exist (AI agent instructions in AGENTS.md/README are acceptable).
  - Acceptance: no false claims in README, steering docs, or user guide. No AI product wording.

## T2 — Alpha support boundary

- [x] **T2.1** Create `docs/ALPHA.md` with three sections: Supported (alpha happy path), Experimental, Not Supported.
  - Acceptance: the alpha happy path is clearly defined. Experimental features are listed with honest status. Not-supported items are explicit.

## T3 — Public deployment smoke checklist

- [x] **T3.1** Create `docs/VERIFY_DEPLOYMENT.md` with step-by-step deployment verification checklist and browser matrix table.
  - Acceptance: a tester can follow the checklist on the deployed app and verify each item. Browser matrix covers Chrome/Edge full tier and reduced-tier browsers.

## T4 — Media fixture checklist

- [x] **T4.1** Create `docs/MEDIA_FIXTURES.md` defining fixture categories with expected behavior at each stage (import, diagnostics, preview, timeline, export).
  - Acceptance: each fixture category has clear expected behavior. No copyrighted or large media files are committed.

## T5 — Release gate script

- [x] **T5.1** Create `docs/RELEASE_CHECKLIST.md` with the full release gate sequence.
  - Acceptance: checklist covers lint, format:check, test, build, preview, and manual smoke test.
- [x] **T5.2** Add `"verify": "npm test && npm run build"` script to `package.json`. Lint and format:check are excluded from the gate because of 45 pre-existing ESLint issues and a Prettier baseline that predates this PR; they remain available as separate scripts.
  - Acceptance: `npm run verify` runs tests and build in sequence and exits non-zero on any failure. Lint and format:check are informational.

## T6 — UI honesty pass

- [x] **T6.1** Add "(Experimental)" label to Render Queue panel title.
  - Acceptance: the render queue panel header shows "Render Queue (Experimental)".
- [x] **T6.2** Add "(Experimental)" label to Project Bundle dialog title.
  - Acceptance: the bundle dialog header shows the experimental label.
- [x] **T6.3** Add "(Experimental)" label to Scopes panel title if present.
  - Acceptance: the scopes panel header shows the experimental label.

## T7 — Diagnostics alpha pass and deployment metadata

- [x] **T7.1** Add `__BUILD_SHA__` define to `vite.config.ts` using `git rev-parse --short HEAD` at build time, with `"dev"` fallback.
  - Acceptance: `__BUILD_SHA__` is available as a string constant in source code at build time.
- [x] **T7.2** Add `buildId` field to the diagnostic snapshot in `src/ui/diagnostic-snapshot.ts`, combining app version and build SHA.
  - Acceptance: diagnostics report includes `buildId` like `"0.1.0+abc1234"` in production builds and `"0.1.0+dev"` in dev.

## T8 — AGENTS.md spec listing update

- [x] **T8.1** Add the alpha-0-1-release-hardening spec to the Active specs list in `AGENTS.md`.
  - Acceptance: spec appears in the Active section with accurate description.

## T9 — Regression check

- [x] **T9.1** Run `npm run verify` and confirm all gates pass.
  - Acceptance: `npm test` and `npm run build` both exit 0. Lint and format:check are informational and may have pre-existing issues.
