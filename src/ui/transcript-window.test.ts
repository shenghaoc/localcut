import { describe, expect, it } from 'vitest';
import { TRANSCRIPT_WINDOW_RADIUS, computeSegmentWindow } from './transcript-window';

describe('computeSegmentWindow', () => {
  it('renders everything when the list fits the window', () => {
    const w = computeSegmentWindow(10, 3, 120);
    expect(w).toEqual({ start: 0, end: 10, before: 0, after: 0 });
  });

  it('bounds rendering for very large caption files', () => {
    const total = 5_000;
    const w = computeSegmentWindow(total, 2_500);
    const rendered = w.end - w.start;
    // At most 2*radius+1 rows are ever materialized, regardless of total size.
    expect(rendered).toBeLessThanOrEqual(2 * TRANSCRIPT_WINDOW_RADIUS + 1);
    expect(rendered).toBeLessThan(total);
    // The active index is always inside the window.
    expect(2_500).toBeGreaterThanOrEqual(w.start);
    expect(2_500).toBeLessThan(w.end);
    // Hidden counts add up to the remainder.
    expect(w.before + rendered + w.after).toBe(total);
  });

  it('clamps the window at the start', () => {
    const w = computeSegmentWindow(5_000, 0, 50);
    expect(w.start).toBe(0);
    expect(w.end).toBe(101);
    expect(w.before).toBe(0);
  });

  it('clamps the window at the end', () => {
    const total = 5_000;
    const w = computeSegmentWindow(total, total - 1, 50);
    expect(w.end).toBe(total);
    expect(w.end - w.start).toBe(101);
    expect(w.after).toBe(0);
  });

  it('handles empty and out-of-range active indices', () => {
    expect(computeSegmentWindow(0, 0)).toEqual({ start: 0, end: 0, before: 0, after: 0 });
    const w = computeSegmentWindow(5_000, -10, 50);
    expect(w.start).toBe(0);
    expect(w.end).toBe(101);
  });
});
