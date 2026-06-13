## 2024-06-05 - Add ARIA attributes to status bar

**Learning:** The application uses a dynamic status bar at the bottom to communicate background process states (like worker initialization, media import, encoding). These changes are visual but were not announced to assistive technologies.

**Action:** Applied `role="status"`, `aria-live="polite"`, and `aria-atomic="true"` to the status text span to ensure screen readers announce these critical non-intrusive updates.

## 2026-06-13 - Add aria-expanded and aria-controls to collapsable panels

**Learning:** The application uses buttons to collapse and expand structural side panels (like the inspector). Without `aria-expanded` and `aria-controls` attributes, screen reader users cannot tell if the panel is currently open or what content the button controls.

**Action:** Applied `aria-expanded` with accurate boolean state and `aria-controls` pointing to the outer `side-rail` container (which remains in the DOM regardless of collapsed state) to the collapse and expand toggle buttons in the side rail.
