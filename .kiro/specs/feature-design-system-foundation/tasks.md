# Tasks: Design-system foundation and editor-chrome hardening

> Status: **Implemented and verified.** Tasks map to
> [`requirements.md`](./requirements.md) and [`design.md`](./design.md).

## T1 — Canonical context and artifact policy

- [x] **T1.1** Add and reconcile `PRODUCT.md`, `DESIGN.md`, generated design
  metadata, and live design config.
- [x] **T1.2** Link the root context from Kiro UI steering and document the
  desktop-first/narrow-compatibility boundary.
- [x] **T1.3** Ignore and remove machine-local hook cache and per-run critique
  output; retain product-owned design metadata.
- [x] **T1.4** Refresh `.impeccable/design.json` from the final `DESIGN.md` values.

## T2 — Token and chrome reconciliation

- [x] **T2.1** Align runtime palette, typography, spacing, radius, focus, and
  semantic signal usage with the design context.
- [x] **T2.2** Restore engine-owned callout and padded-background defaults so the
  chrome restyle cannot alter project/render output.
- [x] **T2.3** Keep converter/guide titles and fixed/full-page surfaces coherent
  with the final chrome.

## T3 — Responsive and safe-area hardening

- [x] **T3.1** Consolidate compact toolbar tiers while preserving Import,
  transport, master gain, Project, and Export.
- [x] **T3.2** Put phone rules after tablet rules and coarse-pointer sizing after
  final desktop row declarations.
- [x] **T3.3** Remove layout containment from containers that host fixed surfaces.
- [x] **T3.4** Make the shell and all fixed/full-page surfaces safe-area aware
  without double-counting viewport height.

## T4 — User-flow and accessibility repairs

- [x] **T4.1** Keep a resolvable accessible label for solo secondary panels.
- [x] **T4.2** Place Replay first inside Capture → Record and make Replay/Record
  panels content-sized and scroll-reachable.
- [x] **T4.3** Replace caption pseudo-modals with one native-dialog helper;
  snapshot name/base/draft state and implement blank, Escape, focus return, and
  conflict-action behaviour.
- [x] **T4.4** Replace false Diagnostics and Live Audio success/monitor claims
  with runtime-accurate copy.
- [x] **T4.5** Update the user guide and existing feature specs to match the final
  Capture and caption flows.

## T5 — Verification and merge gate

- [x] **T5.1** Add focused unit and browser regressions for the repaired flows.
- [x] **T5.2** Complete and inspect a live-browser screenshot/measurement sweep.
- [x] **T5.3** Run focused tests, the full browser suite, E2E, `git diff --check`,
  and `vp run check` on the final head.
- [x] **T5.4** Update PR metadata with the actual diff, exact commands, and honest
  gaps; push and verify required checks on that SHA.
