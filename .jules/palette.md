## 2024-06-05 - Add ARIA attributes to status bar

**Learning:** The application uses a dynamic status bar at the bottom to communicate background process states (like worker initialization, media import, encoding). These changes are visual but were not announced to assistive technologies.

**Action:** Applied `role="status"`, `aria-live="polite"`, and `aria-atomic="true"` to the status text span to ensure screen readers announce these critical non-intrusive updates.
