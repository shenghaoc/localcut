/**
 * Beat analysis engine -- spectral-flux onset detection, tempo estimation,
 * and beat-grid phase alignment.
 *
 * JS reference implementation with transparent WASM acceleration via
 * WasmBeatAnalyser for the FFT hot path.
 */

import type { SequentialAudioSource } from './audio-source';
import { WasmBeatAnalyser } from './beat-analysis-wasm';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BeatAnalysisResult {
	tempoBpm: number;
	beatTimesMs: number[]; // sorted, non-negative integers (milliseconds)
	analyserVersion: 1;
}

export interface BeatAnalysisOptions {
	onProgress?: (fraction: number) => void;
	signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// DSP constants
// ---------------------------------------------------------------------------

const FFT_N = 1024;
const HALF_N = 512;
const HOP_SAMPLES = 512;
const SAMPLE_RATE = 48_000;
const WINDOW_FRAMES = 938 * HOP_SAMPLES; // 480,256 samples ≈ 10 s; exact multiple of hop so carry buffer is always aligned
const HOP_SECONDS = HOP_SAMPLES / SAMPLE_RATE;

// Onset peak-picking defaults
const ONSET_W = 16; // state window (frames)
const ONSET_ALPHA = 1.3; // multiplier
const ONSET_MIN_GAP_S = 0.25; // minimum inter-onset gap (seconds)

// Tempo range
const TEMPO_MIN_BPM = 60;
const TEMPO_MAX_BPM = 200;

// ---------------------------------------------------------------------------
// DSP helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** Compute exact Hann window coefficients. */
export function hannWindow(N: number): Float32Array {
	const w = new Float32Array(N);
	for (let n = 0; n < N; n++) {
		w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
	}
	return w;
}

/**
 * Half-wave-rectified log-compressed spectral flux between two magnitude frames.
 */
export function spectralFlux(magnitudes: Float32Array, prevMagnitudes: Float32Array): number {
	let sum = 0;
	const len = Math.min(magnitudes.length, prevMagnitudes.length);
	for (let k = 0; k < len; k++) {
		const curLog = Math.log(Math.max(1 + magnitudes[k], 1e-10));
		const prevLog = Math.log(Math.max(1 + prevMagnitudes[k], 1e-10));
		const diff = curLog - prevLog;
		if (diff > 0) sum += diff;
	}
	return sum;
}

/**
 * Pick onset frames from a flux envelope using moving-mean threshold.
 * Returns onset times in seconds.
 */
export function pickOnsets(
	fluxValues: ArrayLike<number>,
	hopSeconds: number,
	W: number = ONSET_W,
	alpha: number = ONSET_ALPHA,
	minGapS: number = ONSET_MIN_GAP_S
): number[] {
	const onsets: number[] = [];
	const G_frames = Math.ceil(minGapS / hopSeconds);
	let lastOnsetFrame = -G_frames;

	for (let t = W; t < fluxValues.length; t++) {
		// moving mean over [t-W, t]
		let mean = 0;
		for (let i = t - W; i <= t; i++) mean += fluxValues[i];
		mean /= W + 1;

		const threshold = Math.max(alpha * mean, 0.01);
		if (fluxValues[t] <= threshold) continue;

		// local maximum check in [t-2, t+2]
		let isLocalMax = true;
		for (let d = -2; d <= 2; d++) {
			if (d === 0) continue;
			const idx = t + d;
			if (idx >= 0 && idx < fluxValues.length && fluxValues[idx] > fluxValues[t]) {
				isLocalMax = false;
				break;
			}
		}
		if (!isLocalMax) continue;

		// minimum gap check
		if (t - lastOnsetFrame < G_frames) continue;

		onsets.push(t * hopSeconds);
		lastOnsetFrame = t;
	}

	return onsets;
}

/**
 * Estimate tempo from onset-strength envelope via autocorrelation.
 * Returns BPM in [TEMPO_MIN_BPM, TEMPO_MAX_BPM].
 */
export function estimateTempo(onsetStrength: ArrayLike<number>, hopSeconds: number): number {
	const T = onsetStrength.length;
	if (T === 0) return 120; // fallback

	// Lag range for 60-200 BPM
	const maxLag = Math.round(60 / (TEMPO_MIN_BPM * hopSeconds)); // ~47 frames
	const minLag = Math.round(60 / (TEMPO_MAX_BPM * hopSeconds)); // ~14 frames

	let bestLag = minLag;
	let bestAcf = -Infinity;
	const acfValues: number[] = [];

	for (let lag = minLag; lag <= Math.min(maxLag, T - 1); lag++) {
		let acf = 0;
		const count = T - lag;
		for (let t = 0; t < count; t++) {
			acf += onsetStrength[t] * onsetStrength[t + lag];
		}
		// Normalize by the geometric mean of the energies (standard ACF normalization)
		// This avoids biasing toward longer lags
		let energyA = 0,
			energyB = 0;
		for (let t = 0; t < count; t++) {
			energyA += onsetStrength[t] * onsetStrength[t];
			energyB += onsetStrength[t + lag] * onsetStrength[t + lag];
		}
		const norm = Math.sqrt(energyA * energyB);
		acf = norm > 0 ? acf / norm : 0;
		acfValues[lag] = acf;

		if (acf > bestAcf) {
			bestAcf = acf;
			bestLag = lag;
		}
	}

	// Parabolic interpolation on ACF values
	let refinedLag = bestLag;
	if (bestLag > minLag && bestLag < Math.min(maxLag, T - 1)) {
		const a = acfValues[bestLag - 1] ?? 0;
		const b = acfValues[bestLag] ?? 0;
		const c = acfValues[bestLag + 1] ?? 0;
		const denom = a - 2 * b + c;
		if (Math.abs(denom) > 1e-10) {
			const delta = (0.5 * (a - c)) / denom;
			// Clamp delta to [-0.5, 0.5] to avoid wild interpolation
			const clampedDelta = Math.max(-0.5, Math.min(0.5, delta));
			refinedLag = bestLag + clampedDelta;
		}
	}
	const tempoBpm = 60 / (refinedLag * hopSeconds);
	return Math.max(TEMPO_MIN_BPM, Math.min(TEMPO_MAX_BPM, tempoBpm));
}

/**
 * Phase-align a beat grid to the onset-strength envelope.
 * Returns beat times in seconds.
 */
export function alignBeatGrid(
	tempoBpm: number,
	onsetStrength: ArrayLike<number>,
	hopSeconds: number,
	durationS: number
): number[] {
	const T_frames = 60 / (tempoBpm * hopSeconds); // period in frames
	if (T_frames <= 0 || !isFinite(T_frames)) return [];

	let bestPhase = 0;
	let bestScore = -Infinity;

	// Scan phi in [0, T_frames) in steps of T_frames / 128
	const steps = 128;
	for (let s = 0; s < steps; s++) {
		const phi = (s * T_frames) / steps;
		let score = 0;
		let n = 0;
		while (true) {
			const frameIdx = Math.round(phi + n * T_frames);
			if (frameIdx >= onsetStrength.length) break;
			if (frameIdx >= 0) score += onsetStrength[frameIdx];
			n++;
		}
		if (score > bestScore) {
			bestScore = score;
			bestPhase = phi;
		}
	}

	// Generate beat times
	const beatTimes: number[] = [];
	let n = 0;
	while (true) {
		const timeS = (bestPhase + n * T_frames) * hopSeconds;
		if (timeS > durationS) break;
		if (timeS >= 0) beatTimes.push(timeS);
		n++;
	}

	return beatTimes;
}

// ---------------------------------------------------------------------------
// Delta encoding for compact cache storage
// ---------------------------------------------------------------------------

/** Encode sorted absolute ms array to delta array. */
export function encodeDeltaBeatTimes(beatTimesMs: readonly number[]): number[] {
	if (beatTimesMs.length === 0) return [];
	const deltas: number[] = [beatTimesMs[0]];
	for (let i = 1; i < beatTimesMs.length; i++) {
		deltas.push(beatTimesMs[i] - beatTimesMs[i - 1]);
	}
	return deltas;
}

/** Decode delta array back to sorted absolute ms array. */
export function decodeDeltaBeatTimes(delta: readonly number[]): number[] {
	if (delta.length === 0) return [];
	const result: number[] = [delta[0]];
	for (let i = 1; i < delta.length; i++) {
		result.push(result[i - 1] + delta[i]);
	}
	return result;
}

/**
 * Silence detector for the full source. The mean |sample| threshold is
 * conservative -- music with a typical commercial master sits well above
 * 0.01, while studio-quality silence + light noise floor stays under.
 */
function isEffectivelySilent(absSampleSum: number, durationS: number): boolean {
	const totalSamples = durationS * SAMPLE_RATE;
	if (totalSamples <= 0) return true;
	const meanAbs = absSampleSum / totalSamples;
	return meanAbs < 0.001;
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

/**
 * Stream PCM from audioSource, run the full beat analysis pipeline.
 * Returns the complete analysis result.
 */
export async function analyseBeatTimes(
	audioSource: SequentialAudioSource,
	durationSeconds: number,
	options?: BeatAnalysisOptions
): Promise<BeatAnalysisResult> {
	const signal = options?.signal;
	const onProgress = options?.onProgress;

	// Initialize WASM analyser (no-op if already initialized)
	await WasmBeatAnalyser.init();
	const wasmAnalyser = new WasmBeatAnalyser();

	// Pre-compute Hann window (JS always applies it; WASM also applies internally)
	const hann = hannWindow(FFT_N);

	// Accumulate flux values across all windows
	const allFlux: number[] = [];
	let carryBuffer = new Float32Array(HOP_SAMPLES); // 512 samples overlap
	let carryFilled = false;
	// prevMagnitudes is carried ACROSS chunk boundaries so the first frame of
	// each chunk is compared against the last frame of the previous chunk
	// (not zeros). Otherwise an artificial spectral-flux spike was injected
	// at every chunk boundary, skewing tempo phase on long sources.
	let prevMagnitudes = new Float32Array(HALF_N + 1);
	let havePrevMagnitudes = false;
	let signalEnergy = 0; // accumulated abs amplitude across all PCM read; silence guard.

	let windowIndex = 0;

	let windowStart = 0;
	while (windowStart < durationSeconds) {
		if (signal?.aborted) {
			throw new DOMException('Beat analysis aborted', 'AbortError');
		}

		// Read 10 seconds of mono PCM at 48 kHz
		const pcm = await audioSource.pcmWindowAt(windowStart, WINDOW_FRAMES, 1, SAMPLE_RATE);

		// Cheap silence detector: sum |sample| across all chunks (used after the loop).
		for (let i = 0; i < pcm.length; i++) signalEnergy += Math.abs(pcm[i]);

		// Prepend carry from previous window
		let fullPcm: Float32Array;
		if (carryFilled) {
			fullPcm = new Float32Array(HOP_SAMPLES + pcm.length);
			fullPcm.set(carryBuffer, 0);
			fullPcm.set(pcm, HOP_SAMPLES);
		} else {
			fullPcm = pcm;
		}

		// Run STFT over this window. prevMagnitudes persists across windows.
		if (!havePrevMagnitudes) {
			prevMagnitudes = new Float32Array(HALF_N + 1);
		}
		const frameCount = Math.floor((fullPcm.length - FFT_N) / HOP_SAMPLES) + 1;

		for (let frame = 0; frame < frameCount; frame++) {
			const offset = frame * HOP_SAMPLES;
			if (offset + FFT_N > fullPcm.length) break;

			// Extract frame and apply Hann window
			const windowed = new Float32Array(FFT_N);
			for (let i = 0; i < FFT_N; i++) {
				windowed[i] = fullPcm[offset + i] * hann[i];
			}

			// Compute magnitudes (WASM or JS)
			let magnitudes: Float32Array;
			if (wasmAnalyser.usedWasm) {
				const wasmResult = wasmAnalyser.processFrame(fullPcm.subarray(offset, offset + FFT_N));
				if (wasmResult) {
					magnitudes = wasmResult;
				} else {
					// WASM failed for this frame, fall back to JS
					magnitudes = jsComputeMagnitudes(windowed);
				}
			} else {
				magnitudes = jsComputeMagnitudes(windowed);
			}

			// Compute spectral flux
			const flux = spectralFlux(magnitudes, prevMagnitudes);
			allFlux.push(flux);
			prevMagnitudes = new Float32Array(magnitudes);
			havePrevMagnitudes = true;
		}

		// Save carry buffer (last HOP_SAMPLES samples)
		carryBuffer = new Float32Array(fullPcm.subarray(fullPcm.length - HOP_SAMPLES));
		carryFilled = true;

		windowIndex++;
		if (onProgress) {
			onProgress(Math.min(1, (windowIndex * WINDOW_FRAMES) / (durationSeconds * SAMPLE_RATE)));
		}

		// Yield the event loop
		await new Promise<void>((r) => setTimeout(r, 0));

		windowStart += WINDOW_FRAMES / SAMPLE_RATE;
	}

	// Silence guard: if the input has essentially no energy OR no meaningful
	// onsets, the autocorrelation/grid stage would still emit a dense ~200 BPM
	// lattice from random noise floor. Return an empty grid in that case.
	if (allFlux.length === 0 || isEffectivelySilent(signalEnergy, durationSeconds)) {
		return { tempoBpm: 120, beatTimesMs: [], analyserVersion: 1 };
	}

	// Require at least 4 picked onsets before producing a beat grid -- below
	// that threshold tempo estimation is dominated by FFT round-off noise.
	const pickedOnsets = pickOnsets(allFlux, HOP_SECONDS);
	if (pickedOnsets.length < 4) {
		return { tempoBpm: 120, beatTimesMs: [], analyserVersion: 1 };
	}

	const tempoBpm = estimateTempo(allFlux, HOP_SECONDS);
	const beatTimesS = alignBeatGrid(tempoBpm, allFlux, HOP_SECONDS, durationSeconds);

	// Convert to milliseconds (sorted, non-negative integers)
	const beatTimesMs = beatTimesS.map((t) => Math.round(t * 1000)).filter((t) => t >= 0);
	beatTimesMs.sort((a, b) => a - b);

	return {
		tempoBpm,
		beatTimesMs,
		analyserVersion: 1
	};
}

/**
 * Pure-JS magnitude computation (used when WASM is unavailable).
 * Input: 1024 windowed samples. Output: 513 magnitude bins.
 */
function jsComputeMagnitudes(windowed: Float32Array): Float32Array {
	// In-place radix-2 FFT
	const re = new Float32Array(FFT_N);
	const im = new Float32Array(FFT_N);
	re.set(windowed);
	// im is already zero

	fftInPlace(re, im);

	// Compute magnitudes
	const magnitudes = new Float32Array(HALF_N + 1);
	for (let k = 0; k <= HALF_N; k++) {
		magnitudes[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
	}
	return magnitudes;
}

/**
 * In-place radix-2 decimation-in-time FFT.
 * re[] and im[] are modified in place.
 */
function fftInPlace(re: Float32Array, im: Float32Array): void {
	const N = re.length;
	const log2N = Math.log2(N);

	// Bit-reversal permutation
	for (let i = 1, j = 0; i < N; i++) {
		let bit = N >> 1;
		for (; j & bit; bit >>= 1) {
			j ^= bit;
		}
		j ^= bit;

		if (i < j) {
			let tmp = re[i];
			re[i] = re[j];
			re[j] = tmp;
			tmp = im[i];
			im[i] = im[j];
			im[j] = tmp;
		}
	}

	// Butterfly stages
	for (let stage = 0; stage < log2N; stage++) {
		const halfSize = 1 << stage;
		const stride = halfSize << 1;
		const angleStep = -Math.PI / halfSize;

		for (let k = 0; k < N; k += stride) {
			let twRe = 1;
			let twIm = 0;
			const cosStep = Math.cos(angleStep);
			const sinStep = Math.sin(angleStep);

			for (let j = 0; j < halfSize; j++) {
				const idx1 = k + j;
				const idx2 = k + j + halfSize;

				const tRe = re[idx2] * twRe - im[idx2] * twIm;
				const tIm = re[idx2] * twIm + im[idx2] * twRe;

				re[idx2] = re[idx1] - tRe;
				im[idx2] = im[idx1] - tIm;
				re[idx1] = re[idx1] + tRe;
				im[idx1] = im[idx1] + tIm;

				const newTwRe = twRe * cosStep - twIm * sinStep;
				const newTwIm = twRe * sinStep + twIm * cosStep;
				twRe = newTwRe;
				twIm = newTwIm;
			}
		}
	}
}
