/**
 * Caption transcript windowing (B5).
 *
 * Large SRT/WebVTT imports can hold thousands of segments. Rendering every row at
 * once floods the DOM and the main thread. This pure helper computes a bounded
 * window of row indices around the active segment so the panel renders at most
 * `2 * radius + 1` rows regardless of how many segments the track holds.
 */

export const TRANSCRIPT_WINDOW_RADIUS = 120;

export interface SegmentWindow {
  /** First rendered index (inclusive). */
  readonly start: number;
  /** One past the last rendered index (exclusive). */
  readonly end: number;
  /** Count of segments hidden before the window. */
  readonly before: number;
  /** Count of segments hidden after the window. */
  readonly after: number;
}

/**
 * Compute the visible window of `[start, end)` indices for a transcript list.
 * The window is centered on `activeIndex`, clamped to `[0, total)`, and always
 * contains the active index when one exists.
 */
export function computeSegmentWindow(
  total: number,
  activeIndex: number,
  radius: number = TRANSCRIPT_WINDOW_RADIUS,
): SegmentWindow {
  if (total <= 0) return { start: 0, end: 0, before: 0, after: 0 };
  const safeRadius = Math.max(0, Math.floor(radius));
  const windowSize = safeRadius * 2 + 1;
  if (total <= windowSize) {
    return { start: 0, end: total, before: 0, after: 0 };
  }
  const center = Number.isFinite(activeIndex)
    ? Math.min(Math.max(0, Math.floor(activeIndex)), total - 1)
    : 0;
  let start = center - safeRadius;
  let end = center + safeRadius + 1;
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > total) {
    start -= end - total;
    end = total;
  }
  start = Math.max(0, start);
  return { start, end, before: start, after: total - end };
}
