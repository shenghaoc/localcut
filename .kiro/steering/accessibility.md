# Accessibility Standards

## Principles

The editor targets desktop Chromium with keyboard + pointer as the primary input. Accessibility work must not regress the accelerated performance path. Screen-reader and keyboard support is required for all chrome (toolbar, dialogs, inspector); bespoke timeline interaction requires at minimum a keyboard-navigable equivalent.

## ARIA Patterns

| Element | Required attributes |
|---------|-------------------|
| Preview canvas | `aria-label="Video preview"` |
| Timeline scrub track | `role="slider"`, `aria-label`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow` |
| Clip items | `role="button"` (or native `<button>`) with descriptive `aria-label` including clip name and position |
| Toggle buttons (play/mute/solo) | `role="button"`, `aria-pressed` reflecting current state |
| Capability warnings | `role="alert"` only when a required user action blocks the current workflow; use persistent visible text for passive status |
| Modal dialogs (export) | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to the dialog heading; focus trap while open |
| Icon-only buttons | `aria-label` describing the action; no decorative text that the label would duplicate |

## Keyboard Navigation

- All interactive controls reachable by `Tab` in logical DOM order.
- `Enter` and `Space` activate buttons and toggle controls; do not intercept these keys on non-interactive elements.
- Timeline clip keyboard actions: `Delete`/`Backspace` on focused clip triggers delete; arrow keys nudge trim handles when in trim mode.
- Export dialog: `Escape` closes (if export is not in progress); `Tab` cycles through action buttons.
- Do not rely solely on mouse events (`mousedown`, `mousemove`, `mouseup`) for interactive features; provide pointer-event + keyboard equivalents.

## Semantic HTML

- Use native elements (`<button>`, `<input>`, `<dialog>`) over `<div role="...">` wherever the native element's built-in behaviour (focus, activation, form association) is useful.
- Avoid nested interactive elements (e.g., a `<button>` inside another `<button>`). When a clip needs both a selection region and a delete affordance, the delete affordance must be a sibling, not a child, of the selection element.
- Headings in dialogs and panels must be in logical order (`h1` → `h2`); do not skip levels.

## Focus Management

- When a dialog opens, move focus to the first interactive element or the dialog container itself.
- When a dialog closes, return focus to the trigger element.
- Do not suppress the focus ring globally; use `:focus-visible` CSS to show rings only for keyboard navigation.

## Colour & Contrast

- Text on panel backgrounds (`#e8e8ed` on `#1e1e24`) must meet WCAG AA (4.5:1 for normal text, 3:1 for large/UI text).
- Muted text (`#9898a4`) is for supplementary labels only, not primary content; verify contrast meets 3:1 against its background at the sizes used.
- Do not rely on colour alone to convey state (e.g., clip selected, muted, solo); add an outline, pattern, or text label.
- The accent colour `#5b8def` used for the scrubhead and focus states: verify contrast against both `#16161a` and `#1e1e24` at use sites.

## Motion & Animation

- Respect `prefers-reduced-motion`; skip or reduce transition animations when the user has requested reduced motion.
- Timeline scrub and playhead animations driven by the SAB clock are considered functional (not decorative) and are exempt, but should avoid abrupt large jumps that could trigger vestibular issues.

## Testing Accessibility

- Use the browser's built-in accessibility inspector (Chrome DevTools → Accessibility pane) to verify the accessibility tree for new interactive components.
- Run Lighthouse accessibility audit in Chrome DevTools before merging significant UI changes.
- Keyboard-navigate the entire editor (import, trim, play, export) without a mouse as part of the manual smoke test.
