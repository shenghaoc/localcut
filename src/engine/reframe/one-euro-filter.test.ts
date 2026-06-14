import { describe, it, expect } from 'vite-plus/test';
import { OneEuroScalar, OneEuro2D } from './one-euro-filter';

describe('OneEuroScalar', () => {
	it('returns the first value unchanged', () => {
		const filter = new OneEuroScalar();
		expect(filter.filter(5.0, 0)).toBe(5.0);
	});

	it('produces flat output for stationary input', () => {
		const filter = new OneEuroScalar();
		filter.filter(3.0, 0);
		const results = [];
		for (let t = 0.5; t <= 5; t += 0.5) {
			results.push(filter.filter(3.0, t));
		}
		for (const r of results) {
			expect(r).toBeCloseTo(3.0, 5);
		}
	});

	it('tracks a ramp input with bounded lag', () => {
		const filter = new OneEuroScalar({ minCutoff: 1.0, beta: 0.007, dcutoff: 1.0 });
		// Ramp: value = time
		filter.filter(0, 0);
		let maxLag = 0;
		for (let t = 0.5; t <= 10; t += 0.5) {
			const filtered = filter.filter(t, t);
			const lag = Math.abs(filtered - t);
			maxLag = Math.max(maxLag, lag);
		}
		// At 2 fps (0.5s intervals), lag should be within ~2 frames worth
		expect(maxLag).toBeLessThan(2.0);
	});

	it('suppresses high-frequency jitter', () => {
		const filter = new OneEuroScalar({ minCutoff: 1.0, beta: 0.007, dcutoff: 1.0 });
		filter.filter(0, 0);
		const jittered = [];
		for (let t = 0.5; t <= 5; t += 0.5) {
			// Alternating ±1 jitter around 0
			const value = Math.floor(t * 2) % 2 === 0 ? 1 : -1;
			jittered.push(filter.filter(value, t));
		}
		// Filtered output should have smaller amplitude than raw jitter
		const maxAbs = Math.max(...jittered.map(Math.abs));
		expect(maxAbs).toBeLessThan(1.0);
	});

	it('reset clears internal state', () => {
		const filter = new OneEuroScalar();
		filter.filter(5.0, 0);
		filter.filter(5.0, 1);
		filter.reset();
		// After reset, first value should be accepted fresh
		expect(filter.filter(10.0, 2)).toBe(10.0);
	});
});

describe('OneEuro2D', () => {
	it('filters x and y independently', () => {
		const filter = new OneEuro2D();
		const r1 = filter.filter(1, 2, 0);
		expect(r1.x).toBeCloseTo(1, 5);
		expect(r1.y).toBeCloseTo(2, 5);

		const r2 = filter.filter(1, 2, 0.5);
		expect(r2.x).toBeCloseTo(1, 3);
		expect(r2.y).toBeCloseTo(2, 3);
	});

	it('reset clears both filters', () => {
		const filter = new OneEuro2D();
		filter.filter(5, 5, 0);
		filter.filter(5, 5, 1);
		filter.reset();
		const r = filter.filter(0, 0, 2);
		expect(r.x).toBeCloseTo(0, 5);
		expect(r.y).toBeCloseTo(0, 5);
	});
});
