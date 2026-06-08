import { describe, expect, it } from 'vitest';
import appSource from './App.tsx?raw';
import clockSource from './clock.ts?raw';
import audioEngineSource from './audio-engine.ts?raw';

/**
 * Regression guard for B4 + Codex P1-4: the UI shell must never write the
 * transport-clock SharedArrayBuffer (currentTime/duration/playState). The worker
 * is the sole transport-clock writer; `clock.ts` owns the read-side view. The
 * audio engine may prime only the AUDIO_CLOCK anchor (index 3), never the
 * transport field.
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

	it('audio-engine.ts primes only AUDIO_CLOCK, never the transport CURRENT_TIME', () => {
		expect(audioEngineSource).toMatch(/ClockIndex\.AUDIO_CLOCK\]\s*=/);
		expect(audioEngineSource).not.toMatch(/ClockIndex\.CURRENT_TIME\]\s*=/);
	});
});
