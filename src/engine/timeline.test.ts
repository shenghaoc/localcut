import { describe, expect, it } from 'vitest';
import { createEmptyTimeline } from './timeline';

describe('timeline', () => {
  it('starts empty', () => {
    expect(createEmptyTimeline()).toEqual([]);
  });
});
