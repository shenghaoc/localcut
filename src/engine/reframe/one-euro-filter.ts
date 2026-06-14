/**
 * One Euro filter — a low-pass filter with adaptive cutoff that eliminates
 * slow jitter while tracking fast motion with minimal lag.
 *
 * Reference: Casiez, Roussel & Vogel (2012), "1€ Filter: A Simple Speed-based
 * Low-pass Filter for Noisy Input in Interactive Systems".
 */

export interface OneEuroFilterConfig {
	/** Minimum cutoff frequency in Hz. Lower values remove more jitter. */
	minCutoff: number;
	/** Speed coefficient. Higher values track fast motion better. */
	beta: number;
	/** Derivative low-pass filter cutoff in Hz. */
	dcutoff: number;
}

export const DEFAULT_ONE_EURO_CONFIG: OneEuroFilterConfig = {
	minCutoff: 1.0,
	beta: 0.007,
	dcutoff: 1.0
};

function smoothingFactor(cutoff: number, dt: number): number {
	const tau = 1.0 / (2.0 * Math.PI * cutoff);
	return 1.0 / (1.0 + tau / dt);
}

/**
 * One Euro filter for a single scalar value.
 */
export class OneEuroScalar {
	private config: OneEuroFilterConfig;
	private first = true;
	private prevValue = 0;
	private prevDx = 0;
	private prevTime = 0;

	constructor(config: OneEuroFilterConfig = DEFAULT_ONE_EURO_CONFIG) {
		this.config = config;
	}

	reset(): void {
		this.first = true;
		this.prevValue = 0;
		this.prevDx = 0;
		this.prevTime = 0;
	}

	/**
	 * Filter a new value at the given time (seconds).
	 * Returns the smoothed value.
	 */
	filter(value: number, time: number): number {
		if (this.first) {
			this.first = false;
			this.prevValue = value;
			this.prevDx = 0;
			this.prevTime = time;
			return value;
		}

		const dt = time - this.prevTime;
		if (dt <= 0) return this.prevValue;

		// Derivative estimation
		const dx = (value - this.prevValue) / dt;
		const edx =
			smoothingFactor(this.config.dcutoff, dt) * dx +
			(1 - smoothingFactor(this.config.dcutoff, dt)) * this.prevDx;

		// Adaptive cutoff based on speed
		const cutoff = this.config.minCutoff + this.config.beta * Math.abs(edx);

		// Filtered value
		const result =
			smoothingFactor(cutoff, dt) * value + (1 - smoothingFactor(cutoff, dt)) * this.prevValue;

		this.prevValue = result;
		this.prevDx = edx;
		this.prevTime = time;
		return result;
	}
}

/**
 * One Euro filter for a 2D point (x, y). Wraps two scalar filters.
 */
export class OneEuro2D {
	private xFilter: OneEuroScalar;
	private yFilter: OneEuroScalar;

	constructor(config: OneEuroFilterConfig = DEFAULT_ONE_EURO_CONFIG) {
		this.xFilter = new OneEuroScalar(config);
		this.yFilter = new OneEuroScalar(config);
	}

	reset(): void {
		this.xFilter.reset();
		this.yFilter.reset();
	}

	filter(x: number, y: number, time: number): { x: number; y: number } {
		return {
			x: this.xFilter.filter(x, time),
			y: this.yFilter.filter(y, time)
		};
	}
}
