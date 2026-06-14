/**
 * Shared math utilities for the polyphase sinc audio resamplers.
 *
 * `besselI0` and `kaiserWindow` are used by both the pure-JS resampler
 * (`audio-resampler.ts`) and the WASM-accelerated resampler
 * (`audio-resampler-wasm.ts`) to build Kaiser-windowed filter tables.
 */

/** Zeroth-order modified Bessel function of the first kind (series approximation). */
export function besselI0(x: number): number {
	let sum = 1.0;
	let term = 1.0;
	const halfX = x * 0.5;
	for (let k = 1; k <= 20; k++) {
		term *= (halfX / k) * (halfX / k);
		sum += term;
		// eslint-disable-next-line oxc/erasing-op — convergence threshold, not a bug
		if (term < sum * 1e-16) break;
	}
	return sum;
}

/** Kaiser window function for FIR filter design. */
export function kaiserWindow(n: number, size: number, beta: number): number {
	const center = (size - 1) * 0.5;
	const ratio = (n - center) / center;
	const arg = 1.0 - ratio * ratio;
	if (arg <= 0) return 0;
	return besselI0(beta * Math.sqrt(arg)) / besselI0(beta);
}
