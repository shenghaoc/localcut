## 2024-06-05 - Add ARIA attributes to status bar

**Learning:** The application uses a dynamic status bar at the bottom to communicate background process states (like worker initialization, media import, encoding). These changes are visual but were not announced to assistive technologies.

**Action:** Applied `role="status"`, `aria-live="polite"`, and `aria-atomic="true"` to the status text span to ensure screen readers announce these critical non-intrusive updates.

## 2026-06-13 - Add aria-expanded and aria-controls to collapsable panels

**Learning:** The application uses buttons to collapse and expand structural side panels (like the inspector). Without `aria-expanded` and `aria-controls` attributes, screen reader users cannot tell if the panel is currently open or what content the button controls.

**Action:** Applied `aria-expanded` with accurate boolean state and `aria-controls` pointing to the outer `side-rail` container (which remains in the DOM regardless of collapsed state) to the collapse and expand toggle buttons in the side rail.

## 2026-06-19 - Adding ARIA labels to SolidJS Index-keyed lists

**Learning:** In SolidJS, the `<For>` component keys by item reference — replacing an object (e.g. `{ ...p, status: 'applied' }`) destroys and recreates the DOM node, causing focus to reset to `<body>` for keyboard and screen reader users. The `<Index>` component keys by position instead, preserving DOM nodes across reference changes. Inside `<Index>`, each item is an `Accessor<T>` (call it as `proposal()`) and the index is a static `number` (use `index + 1`, not `index() + 1`).

**Action:** Switched the proposal list in `AutoZoomPanel.tsx` from `<For>` to `<Index>` so button DOM nodes are preserved when status changes. Added `aria-label` attributes that reflect the current button state (e.g. `"Applied proposal 1"` vs `"Apply proposal 1"`) so screen readers announce the correct action.

## 2024-05-24 - Icon-Only Button Tooltips
**Learning:** Found that while icon-only buttons in Kiro frequently have `aria-label` attributes for screen readers, they often lack the native `title` attribute, depriving mouse users of visual tooltips. Note: native `title` has accessibility limitations — it does not display on keyboard focus, does not work on touch devices, and some screen readers may redundantly announce both `aria-label` and `title`. A custom CSS-based tooltip (hover + focus) would be more accessible long-term.
**Action:** When adding or reviewing icon-only buttons, always ensure both `aria-label` and `title` attributes are present. Use `title` as the standard tooltip approach to match the existing codebase pattern (Toolbar, RenderQueuePanel, BeatPanel). Consider a reusable custom Tooltip component for broader adoption later.
