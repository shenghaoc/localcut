# UI/UX Standards

Canonical visual tokens and component rules live in [`DESIGN.md`](../../DESIGN.md);
product personality and platform positioning live in
[`PRODUCT.md`](../../PRODUCT.md). This steering file translates those contracts
into repository implementation guidance.

## Aesthetic

Dark, professional-tool look — not a consumer social app.

- **Backgrounds**: `#0a090f` (ink) → `#0f0e15` (plate) → `#16151c` (panel) → `#1d1c24` (elevated); `#0c0b11` is the recessed preview well.
- **Borders**: subtle 1px `#222230`; `#33334a` only where stronger separation is needed.
- **Primary interaction accent**: film-stock amber `#d4a853` for the scrubhead, selected controls, primary actions, and keyboard focus.
- **Signal colours**: sage `#6ee7b7` for success/audio, vermillion `#ef4f4f` for destructive/error, signal amber `#f5b942` for warnings.
- **Text**: `#f4f6fa` primary, `#c7c9d6` secondary, `#8e90a3` muted.

## Layout

- Preview canvas is dominant in the workspace grid.
- Timeline sits below preview; inspector is a fixed-width right rail.
- Ark UI supplies accessible menu/tab/popover primitives; timeline, clips, scrubhead, and waveforms remain bespoke.

## Typography

- UI: DM Sans with Noto/system fallbacks.
- Technical values: JetBrains Mono with Noto/system monospace fallbacks and tabular lining numerals (`font-variant-numeric: tabular-nums lining-nums`).
- Timecodes, frame counts, codec strings, rates, and percentages use the technical-value treatment.

## Theming

- CSS custom properties in `src/global.css` (`:root` variables).
- No light mode in v1.

## Interaction

- Scrubhead position driven by SAB clock poll in the accelerated tier. Limited tiers may use visibly lower-frequency clock updates when SAB is unavailable.
- Import: File System Access API primary; file input + drag-and-drop fallback.
- Transport controls disabled when no media is loaded or when the active capability tier cannot support playback yet.
- Preview resolution indicator when adaptive proxy is active (Phase 2+): e.g. "Preview: 720p".
- Capability tier indicators belong in the persistent chrome. Users should always know whether they are in accelerated, limited, or blocked mode.
- The right rail has four primary job destinations: Inspector, Text, Audio, and Capture. Replay Buffer is a discoverable section within Capture → Record, not a separate primary or secondary destination.
- At narrower desktop widths, lower-frequency toolbar controls collapse before transport or export actions may overflow. At ≤900px the workspace reflows to one column.
- Coarse-pointer and safe-area rules are progressive compatibility. They do not redefine the product as phone-first.

## Accessibility

- Preview canvas: `aria-label="Video preview"`.
- Timeline scrub track: `role="slider"` with `aria-label`.
- Capability warnings: use persistent visible text plus `role="alert"` only when a required user action blocks the current workflow.
