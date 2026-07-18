# Requirements: Design-system foundation and editor-chrome hardening

> Status: **Implementation complete; final verification pending.** This feature
> is limited to the application shell and user-facing chrome. It must not alter
> media-render output, persisted engine defaults, or the accelerated pipeline.

## R1 — Canonical design context

- **R1.1** [`DESIGN.md`](../../../DESIGN.md) is the canonical token and visual-
  language contract. [`PRODUCT.md`](../../../PRODUCT.md) is the canonical product
  personality and platform-positioning contract. Kiro steering links to both.
- **R1.2** The tracked Impeccable context consists of `DESIGN.md`, `PRODUCT.md`,
  `.impeccable/design.json`, and `.impeccable/live/config.json`.
- **R1.3** Machine-local hook cache and timestamped critique output are ignored
  and untracked. Generated `design.json` metadata is refreshed whenever the
  canonical design context changes.
- **R1.4** The visual foundation uses one interaction accent (film-stock amber),
  warm dark surfaces, DM Sans for UI, JetBrains Mono for technical values, the
  CSS spacing scale, and the documented 1–6px precision radii.
- **R1.5** Signal colours remain semantic: sage for success/audio, vermillion for
  destructive/error, and signal amber for warnings. They are never substitutes
  for the interaction accent or keyboard focus ring.

## R2 — Scope and architecture

- **R2.1** Changes remain in focused UI components, shared tokens, documentation,
  and tests. `App.tsx` may compose the existing surfaces but receives no new
  feature engine, persistence, rendering, or media-processing responsibility.
- **R2.2** Render-domain defaults such as callout and padded-background colours
  remain unchanged unless an engine feature spec explicitly changes them.
- **R2.3** The PR introduces no parallel component system or second token source;
  Ark UI remains the primitive layer and `src/global.css` remains the runtime CSS
  token source.
- **R2.4** Containment may isolate styling and size calculation, but layout
  containment must not establish a containing block that traps fixed recorder,
  scope, document, converter, or modal surfaces.

## R3 — Editor navigation and truthful states

- **R3.1** The right rail retains four primary job destinations: Inspector,
  Text, Audio, and Capture.
- **R3.2** Capture exposes Record, Program, and Go Live as its secondary jobs.
  Replay Buffer is the first discoverable, collapsible section inside Record so
  it is visible before the longer recorder form and remains reachable when
  expanded.
- **R3.3** A solo secondary destination keeps a valid accessible name even when
  the visible segmented tab list is omitted.
- **R3.4** Empty and status messages describe actual runtime state. Diagnostics
  with no recovery action do not claim every diagnostic passed. Live Audio copy
  describes the implemented print-to-recording path and states that monitoring
  remains unprocessed.
- **R3.5** Converter and guide pages retain clear, consistent page titles and
  safe-area-aware full-page layout.

## R4 — Caption preset dialogs

- **R4.1** Saving a caption preset opens a labelled native modal dialog. The
  suggested name and the base/draft preset are snapshotted at invocation time.
- **R4.2** Clearing the name does not dismiss the dialog. Save remains disabled
  until the trimmed name is non-empty.
- **R4.3** Initial focus moves into the dialog, Escape cancels, modal semantics
  prevent background interaction, and focus returns to the invoking control.
- **R4.4** An imported-name conflict opens a labelled alert dialog with Cancel,
  Update existing, and Save as copy. The safe copy action is the trailing
  default; destructive replacement is visually and semantically distinct.
- **R4.5** Enter submits only a valid enabled action. Every path closes cleanly
  without stale prompt state.

## R5 — Responsive, coarse-pointer, and safe-area behaviour

- **R5.1** Desktop Chromium and keyboard input remain the primary product target.
  Narrow-viewport and coarse-pointer support is resilient compatibility, not a
  phone-first editing promise.
- **R5.2** At every desktop width the toolbar keeps Import, transport, master
  gain, Project, and Export reachable without horizontal clipping. Lower-
  frequency Edit, snap, source-detail, or meter UI may collapse because each has
  another truthful home.
- **R5.3** At `<=900px` the workspace reflows to one column. At `<=560px`, the
  smaller equal-specificity sizing rules win the cascade.
- **R5.4** Coarse-pointer targets and their parent rows grow together to at least
  44px where practical; later desktop declarations must not clip them.
- **R5.5** The application shell occupies the usable viewport once. Safe-area
  insets are applied deliberately to fixed/full-page surfaces, without making
  `body` plus `#root` taller than the viewport.

## R6 — Accessibility and desktop interaction quality

- **R6.1** WCAG 2.2 AA remains the target. Focus is visible in the single amber
  focus treatment, colour is not the sole signal, and reduced motion is kept.
- **R6.2** Dialogs, menus, tabs, segmented controls, destructive actions, disabled
  controls, and empty states use familiar desktop patterns and concise labels.
- **R6.3** Error and unavailable-state copy is actionable and never announces a
  success that was not computed.

## R7 — Verification

- **R7.1** Focused unit/browser tests cover solo-panel naming, caption dialog
  blank/focus/Escape/snapshot/conflict behaviour, Replay reachability,
  containment, safe areas, status copy, and toolbar width tiers.
- **R7.2** A live-browser sweep covers representative desktop, compact desktop,
  narrow, and Capture/Replay states, with screenshots inspected for clipping,
  hierarchy, focus, and discoverability.
- **R7.3** `git diff --check`, focused tests, the repository browser and E2E
  suites, and `vp run check` pass on the final head.
