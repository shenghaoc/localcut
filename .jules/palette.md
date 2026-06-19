## 2024-06-05 - Add ARIA attributes to status bar

**Learning:** The application uses a dynamic status bar at the bottom to communicate background process states (like worker initialization, media import, encoding). These changes are visual but were not announced to assistive technologies.

**Action:** Applied `role="status"`, `aria-live="polite"`, and `aria-atomic="true"` to the status text span to ensure screen readers announce these critical non-intrusive updates.

## 2026-06-13 - Add aria-expanded and aria-controls to collapsable panels

**Learning:** The application uses buttons to collapse and expand structural side panels (like the inspector). Without `aria-expanded` and `aria-controls` attributes, screen reader users cannot tell if the panel is currently open or what content the button controls.

**Action:** Applied `aria-expanded` with accurate boolean state and `aria-controls` pointing to the outer `side-rail` container (which remains in the DOM regardless of collapsed state) to the collapse and expand toggle buttons in the side rail.
## 2024-06-19 - Adding ARIA labels to SolidJS For-loops
**Learning:** In SolidJS, the `<For>` component callback provides the index as a second argument which is a signal/accessor function (e.g., `index()`), not a static number. Dynamic text in buttons should match the `aria-label` text state (e.g., "Applied proposal X" vs "Apply proposal X").
**Action:** When adding ARIA labels inside `<For>` loops, use the index signal correctly (`index()`). Ensure that if a button's visual text changes state, its `aria-label` state mirrors that change.
