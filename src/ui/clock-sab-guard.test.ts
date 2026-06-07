import { describe, expect, it } from 'vitest';
import appSource from './App.tsx?raw';
import clockSource from './clock.ts?raw';

/**
 * Regression guard for B4: the UI shell must never write the transport-clock
 * SharedArrayBuffer. The worker is the sole transport-clock writer; `clock.ts`
 * owns the read-side view. The crash/recovery path used to zero the SAB directly
 * (`new Float64Array(sab); view[0]=0...`) — that must not come back.
 */
describe('transport-clock SAB ownership (UI)', () => {
  it('App.tsx does not construct a Float64Array over the clock SAB', () => {
    expect(appSource).not.toMatch(/new Float64Array\(\s*sab\s*\)/);
  });

  it('clock.ts is the only UI module that views the transport-clock SAB', () => {
    // The read-side view lives here and is never assigned to (writes go through the worker).
    expect(clockSource).toMatch(/new Float64Array\(sab\)/);
    expect(clockSource).not.toMatch(/view\[\d+\]\s*=/);
  });
});
