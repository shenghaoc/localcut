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

  it('deduplicates repeated subsystem/code pairs', () => {
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
    expect(log.entries[0]?.message).toBe('new');
  });
});
