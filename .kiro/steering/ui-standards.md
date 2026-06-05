# UI/UX Standards

## Aesthetic

Dark, professional-tool look — not a consumer social app.

- **Backgrounds**: `#16161a` (app) → `#1e1e24` (panels) → `#26262c` (elevated controls)
- **Borders**: subtle 1px `#33333a`
- **Accent**: `#5b8def` (scrubhead, focus states)
- **Text**: `#e8e8ed` primary, `#9898a4` muted

## Layout

- Preview canvas is dominant in the workspace grid.
- Timeline sits below preview; inspector is a fixed-width right rail.
- No component library — timeline, clips, scrubhead, and waveforms are bespoke.

## Typography

- UI: system font stack.
- Timecodes: tabular lining numerals (`font-variant-numeric: tabular-nums lining-nums`).
- Monospace for timecode display in timeline header.

## Theming

- CSS custom properties in `src/global.css` (`:root` variables).
- No light mode in v1.

## Interaction

- Scrubhead position driven by SAB clock poll — not per-frame worker messages.
- Import: File System Access API primary; file input + drag-and-drop fallback.
- Transport controls disabled when no media loaded.
- Preview resolution indicator when adaptive proxy is active (Phase 2+): e.g. "Preview: 720p".

## Accessibility

- Preview canvas: `aria-label="Video preview"`.
- Timeline scrub track: `role="slider"` with `aria-label`.
- Fatal environment errors: `role="alert"`.
