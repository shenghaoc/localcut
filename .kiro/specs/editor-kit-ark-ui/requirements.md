# Requirements: Editor Kit Ark UI Refresh

## R1 — PPTX-Grounded Editor Chrome

- **R1.1** The visible editor shell follows `editor-kit-demo.pptx`: top application menu, command search, import/source strip, transport/timecode cluster, pipeline capability strip, left section rail + media library, dominant program monitor, right inspector rail, timeline, and status footer.
- **R1.2** The workspace outer grid remains three children when preview is available: `.dock-left`, `.preview.panel`, `.side-rail`. The left rail and media library live inside `.dock-left`, preserving the post-merge grid invariant.
- **R1.3** The preview remains the dominant surface at desktop sizes. Library and inspector widths are fixed; the preview column owns remaining space.
- **R1.4** The dark precision-tool aesthetic is retained: no light mode, no marketing layout, no decorative cards, no gradient-orb backgrounds.

## R2 — Ark UI Adoption

- **R2.1** Interactive headless primitives that previously used Solid UI/Kobalte move to `@ark-ui/solid`.
- **R2.2** Popovers use Ark `Popover.Root`, `Popover.Trigger`, `Popover.Positioner`, and `Popover.Content` with controlled state where needed.
- **R2.3** The side rail uses Ark `Tabs.Root`, `Tabs.List`, `Tabs.Trigger`, and `Tabs.Content` while the app still owns the selected-tab signal.
- **R2.4** Ark is used as an unstyled primitive layer only. Styling remains in `src/global.css` via project tokens and local classes.

## R3 — Retire Solid UI Dependencies

- **R3.1** Remove direct dependencies on `@kobalte/core`, `class-variance-authority`, `clsx`, and `tailwind-merge`.
- **R3.2** Replace the shared Solid UI button wrapper with a native `<button>` wrapper that preserves the existing `variant` and `size` API for local call sites.
- **R3.3** Replace `cn()` with a dependency-free local class joiner; no engine/shared module may import UI-only helper libraries.
- **R3.4** Remove stale Solid UI/shadcn wording from token comments so future work does not reintroduce the old dependency model.

## R4 — Interaction and Accessibility

- **R4.1** The command search in the top bar is functional. It opens an Ark popover with working actions for import, transport, publish, captions, smart reframe, capabilities, and help.
- **R4.2** Menu labels are implemented as native buttons with real actions, not inert text.
- **R4.3** Toolbar icon-only buttons keep `aria-label`/`title`; tab and popover semantics come from Ark primitives.
- **R4.4** Focus rings remain visible and cyan; no global focus suppression is introduced.

## R5 — Main-Thread Boundary

- **R5.1** All changes stay in `src/ui/`, `src/lib/`, `src/global.css`, package metadata, and Kiro docs.
- **R5.2** No media decode, encode, WebGPU, WebCodecs, muxing, or pixel-processing work moves to the main thread.
- **R5.3** `PreviewCanvas` still transfers to OffscreenCanvas once; the main thread does not draw preview frames.
- **R5.4** No `VideoFrame` lifecycle sites are touched.

## R6 — Verification

- **R6.1** `vp run typecheck` must pass.
- **R6.2** `vp run check` is the full gate before merge when runtime allows it.
- **R6.3** Dependency verification confirms no source imports remain for the retired Solid UI packages.
- **R6.4** Manual browser QA should verify: header rows fit without overlap, command popover opens, Ark popovers open/close, side-rail tabs switch by pointer and keyboard, preview remains dominant, and limited/accelerated status chips remain readable.
