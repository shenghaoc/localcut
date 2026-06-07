import { describe, expect, it } from 'vitest';
import {
  addRecentError,
  createEmptyRecentErrorLog,
  createRecentError,
  logRecentError,
} from './recent-errors';

describe('recent errors', () => {
  it('redacts details when creating errors', () => {
    const error = createRecentError({
      code: 'import.failed',
      subsystem: 'import',
      severity: 'error',
      message: 'Could not open /Users/alice/private.mov',
      detail: 'full digest abcdef1234567890abcdef1234567890',
      occurredAt: '2026-06-07T00:00:00.000Z',
      affectedSourceAlias: 'raw-source-id',
    });
    expect(error.message).not.toContain('/Users/alice');
    expect(error.message).not.toContain('private.mov');
    expect(error.redactedDetail).not.toContain('abcdef1234567890abcdef1234567890');
    expect(error.affectedSourceAlias).toBeUndefined();
  });

  it('keeps only the configured capacity and counts drops', () => {
    let log = createEmptyRecentErrorLog(2);
    log = logRecentError(log, {
      code: 'one',
      subsystem: 'worker',
      severity: 'warning',
      message: 'one',
      occurredAt: '2026-06-07T00:00:00.000Z',
    });
    log = logRecentError(log, {
      code: 'two',
      subsystem: 'worker',
      severity: 'warning',
      message: 'two',
      occurredAt: '2026-06-07T00:00:01.000Z',
    });
    log = logRecentError(log, {
      code: 'three',
      subsystem: 'worker',
      severity: 'warning',
      message: 'three',
      occurredAt: '2026-06-07T00:00:02.000Z',
    });
    expect(log.entries.map((entry) => entry.code)).toEqual(['three', 'two']);
    expect(log.droppedCount).toBe(1);
  });

  it('folds repeated subsystem/code pairs while preserving recurrence', () => {
    let log = createEmptyRecentErrorLog(5);
    log = addRecentError(log, createRecentError({
      code: 'webgpu.unavailable',
      subsystem: 'gpu',
      severity: 'warning',
      message: 'old',
      occurredAt: '2026-06-07T00:00:00.000Z',
    }));
    log = addRecentError(log, createRecentError({
      code: 'webgpu.unavailable',
      subsystem: 'gpu',
      severity: 'warning',
      message: 'new',
      occurredAt: '2026-06-07T00:00:01.000Z',
    }));
    expect(log.entries).toHaveLength(1);
    // Latest message wins, but the recurrence is not silently dropped.
    expect(log.entries[0]?.message).toBe('new');
    expect(log.entries[0]?.occurrenceCount).toBe(2);
    expect(log.entries[0]?.firstOccurredAt).toBe('2026-06-07T00:00:00.000Z');
    expect(log.entries[0]?.occurredAt).toBe('2026-06-07T00:00:01.000Z');
    // Folding a duplicate is not a capacity drop.
    expect(log.droppedCount).toBe(0);
  });

  it('keeps distinct subsystem/code pairs separate', () => {
    let log = createEmptyRecentErrorLog(5);
    log = logRecentError(log, { code: 'a', subsystem: 'gpu', severity: 'warning', message: 'a' });
    log = logRecentError(log, { code: 'b', subsystem: 'gpu', severity: 'warning', message: 'b' });
    expect(log.entries).toHaveLength(2);
    expect(log.entries.every((entry) => entry.occurrenceCount === 1)).toBe(true);
  });
});
