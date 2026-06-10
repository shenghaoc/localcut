/**
 * RNNoise feature extraction and synthesis DSP, ported to TypeScript from the
 * reference C used by the WebNN sample (github.com/miaobin/rnnoise, branch
 * `wasm_process`, itself based on xiph/rnnoise — BSD-3-Clause, see the model
 * manifest for provenance). The neural network itself runs through WebNN
 * (`rnnoise-graph.ts`); this module computes the 42 input features per 10 ms
 * frame and applies the predicted band gains (including the pitch filter)
 * to resynthesize audio.
 *
 * Runs only in the Audio Cleanup worker — never on the main thread and never
 * in the pipeline worker.
 */

import { RNNOISE_FEATURE_SIZE, RNNOISE_FRAME_SIZE, RNNOISE_GAINS_SIZE } from './model-manifest';

export const FRAME_SIZE = RNNOISE_FRAME_SIZE; // 480 samples @ 48 kHz (10 ms)
export const WINDOW_SIZE = 2 * FRAME_SIZE; // 960
export const FREQ_SIZE = FRAME_SIZE + 1; // 481
export const NB_BANDS = RNNOISE_GAINS_SIZE; // 22
export const NB_FEATURES = RNNOISE_FEATURE_SIZE; // 42

const PITCH_MIN_PERIOD = 60;
const PITCH_MAX_PERIOD = 768;
const PITCH_FRAME_SIZE = 960;
const PITCH_BUF_SIZE = PITCH_MAX_PERIOD + PITCH_FRAME_SIZE; // 1728

const CEPS_MEM = 8;
const NB_DELTA_CEPS = 6;

/** Opus band edges at 5 ms resolution, scaled ×4 for the 20 ms window. */
const EBAND_5MS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 34, 40, 48, 60, 78, 100];

// ── 960-point DFT via Bluestein's algorithm over a 2048-point radix-2 FFT ──
//
// The reference uses opus kiss_fft, whose forward transform is scaled by 1/N.
// Feature energies depend on that absolute scale, so it is preserved here.

const BLUESTEIN_N = WINDOW_SIZE; // 960
const BLUESTEIN_M = 2048; // next power of two ≥ 2·960−1

interface BluesteinTables {
	chirpRe: Float64Array; // e^{-iπn²/N}, n < N
	chirpIm: Float64Array;
	kernelRe: Float64Array; // FFT of the wrapped conjugate chirp
	kernelIm: Float64Array;
	scratchRe: Float64Array;
	scratchIm: Float64Array;
}

function fftRadix2(re: Float64Array, im: Float64Array, inverse: boolean): void {
	const n = re.length;
	// Bit-reversal permutation.
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			const tr = re[i]!;
			re[i] = re[j]!;
			re[j] = tr;
			const ti = im[i]!;
			im[i] = im[j]!;
			im[j] = ti;
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const angle = ((inverse ? 2 : -2) * Math.PI) / len;
		const wRe = Math.cos(angle);
		const wIm = Math.sin(angle);
		for (let i = 0; i < n; i += len) {
			let curRe = 1;
			let curIm = 0;
			const half = len >> 1;
			for (let j = 0; j < half; j++) {
				const aRe = re[i + j]!;
				const aIm = im[i + j]!;
				const bRe = re[i + j + half]! * curRe - im[i + j + half]! * curIm;
				const bIm = re[i + j + half]! * curIm + im[i + j + half]! * curRe;
				re[i + j] = aRe + bRe;
				im[i + j] = aIm + bIm;
				re[i + j + half] = aRe - bRe;
				im[i + j + half] = aIm - bIm;
				const nextRe = curRe * wRe - curIm * wIm;
				curIm = curRe * wIm + curIm * wRe;
				curRe = nextRe;
			}
		}
	}
	if (inverse) {
		for (let i = 0; i < n; i++) {
			re[i]! /= n;
			im[i]! /= n;
		}
	}
}

function buildBluesteinTables(): BluesteinTables {
	const n = BLUESTEIN_N;
	const m = BLUESTEIN_M;
	const chirpRe = new Float64Array(n);
	const chirpIm = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		// n² mod 2N keeps the angle argument small for precision.
		const k = (i * i) % (2 * n);
		const angle = (-Math.PI * k) / n;
		chirpRe[i] = Math.cos(angle);
		chirpIm[i] = Math.sin(angle);
	}
	const kernelRe = new Float64Array(m);
	const kernelIm = new Float64Array(m);
	// b(j) = conj(chirp(|j|)) wrapped at both ends of the length-M buffer.
	for (let i = 0; i < n; i++) {
		kernelRe[i] = chirpRe[i]!;
		kernelIm[i] = -chirpIm[i]!;
		if (i > 0) {
			kernelRe[m - i] = chirpRe[i]!;
			kernelIm[m - i] = -chirpIm[i]!;
		}
	}
	fftRadix2(kernelRe, kernelIm, false);
	return {
		chirpRe,
		chirpIm,
		kernelRe,
		kernelIm,
		scratchRe: new Float64Array(m),
		scratchIm: new Float64Array(m)
	};
}

let bluestein: BluesteinTables | null = null;

/** Unscaled 960-point complex DFT: X(k) = Σ x(n)·e^{-2πikn/N}. */
function dft960(
	re: Float64Array,
	im: Float64Array,
	outRe: Float64Array,
	outIm: Float64Array
): void {
	const tables = (bluestein ??= buildBluesteinTables());
	const n = BLUESTEIN_N;
	const m = BLUESTEIN_M;
	const { chirpRe, chirpIm, kernelRe, kernelIm, scratchRe, scratchIm } = tables;
	scratchRe.fill(0);
	scratchIm.fill(0);
	for (let i = 0; i < n; i++) {
		const xr = re[i]!;
		const xi = im[i]!;
		scratchRe[i] = xr * chirpRe[i]! - xi * chirpIm[i]!;
		scratchIm[i] = xr * chirpIm[i]! + xi * chirpRe[i]!;
	}
	fftRadix2(scratchRe, scratchIm, false);
	for (let i = 0; i < m; i++) {
		const ar = scratchRe[i]!;
		const ai = scratchIm[i]!;
		scratchRe[i] = ar * kernelRe[i]! - ai * kernelIm[i]!;
		scratchIm[i] = ar * kernelIm[i]! + ai * kernelRe[i]!;
	}
	fftRadix2(scratchRe, scratchIm, true);
	for (let i = 0; i < n; i++) {
		const cr = scratchRe[i]!;
		const ci = scratchIm[i]!;
		outRe[i] = cr * chirpRe[i]! - ci * chirpIm[i]!;
		outIm[i] = cr * chirpIm[i]! + ci * chirpRe[i]!;
	}
}

const dftInRe = new Float64Array(WINDOW_SIZE);
const dftInIm = new Float64Array(WINDOW_SIZE);
const dftOutRe = new Float64Array(WINDOW_SIZE);
const dftOutIm = new Float64Array(WINDOW_SIZE);

/** kiss_fft-compatible forward transform: spectrum[0..480] = DFT(x)/960. */
function forwardTransform(x: Float64Array, outRe: Float64Array, outIm: Float64Array): void {
	dftInRe.set(x);
	dftInIm.fill(0);
	dft960(dftInRe, dftInIm, dftOutRe, dftOutIm);
	for (let i = 0; i < FREQ_SIZE; i++) {
		outRe[i] = dftOutRe[i]! / WINDOW_SIZE;
		outIm[i] = dftOutIm[i]! / WINDOW_SIZE;
	}
}

/** Inverse of `forwardTransform` (real output), matching the C index-reversal trick. */
function inverseTransform(re: Float64Array, im: Float64Array, out: Float64Array): void {
	for (let i = 0; i < FREQ_SIZE; i++) {
		dftInRe[i] = re[i]!;
		dftInIm[i] = im[i]!;
	}
	for (let i = FREQ_SIZE; i < WINDOW_SIZE; i++) {
		dftInRe[i] = re[WINDOW_SIZE - i]!;
		dftInIm[i] = -im[WINDOW_SIZE - i]!;
	}
	dft960(dftInRe, dftInIm, dftOutRe, dftOutIm);
	out[0] = dftOutRe[0]!;
	for (let i = 1; i < WINDOW_SIZE; i++) {
		out[i] = dftOutRe[WINDOW_SIZE - i]!;
	}
}

// ── Window / DCT tables ──

const halfWindow = new Float64Array(FRAME_SIZE);
for (let i = 0; i < FRAME_SIZE; i++) {
	const s = Math.sin((0.5 * Math.PI * (i + 0.5)) / FRAME_SIZE);
	halfWindow[i] = Math.sin(0.5 * Math.PI * s * s);
}

const dctTable = new Float64Array(NB_BANDS * NB_BANDS);
for (let i = 0; i < NB_BANDS; i++) {
	for (let j = 0; j < NB_BANDS; j++) {
		let value = Math.cos(((i + 0.5) * j * Math.PI) / NB_BANDS);
		if (j === 0) value *= Math.SQRT1_2;
		dctTable[i * NB_BANDS + j] = value;
	}
}

function dct(out: Float64Array | Float32Array, input: Float64Array): void {
	const scale = Math.sqrt(2 / NB_BANDS);
	for (let i = 0; i < NB_BANDS; i++) {
		let sum = 0;
		for (let j = 0; j < NB_BANDS; j++) {
			sum += input[j]! * dctTable[j * NB_BANDS + i]!;
		}
		out[i] = sum * scale;
	}
}

function applyWindow(x: Float64Array): void {
	for (let i = 0; i < FRAME_SIZE; i++) {
		x[i]! *= halfWindow[i]!;
		x[WINDOW_SIZE - 1 - i]! *= halfWindow[i]!;
	}
}

// ── Band energy / correlation / gain interpolation ──

function computeBandEnergy(bandE: Float64Array, re: Float64Array, im: Float64Array): void {
	bandE.fill(0);
	for (let i = 0; i < NB_BANDS - 1; i++) {
		const bandSize = (EBAND_5MS[i + 1]! - EBAND_5MS[i]!) << 2;
		const base = EBAND_5MS[i]! << 2;
		for (let j = 0; j < bandSize; j++) {
			const frac = j / bandSize;
			const tmp = re[base + j]! * re[base + j]! + im[base + j]! * im[base + j]!;
			bandE[i]! += (1 - frac) * tmp;
			bandE[i + 1]! += frac * tmp;
		}
	}
	bandE[0]! *= 2;
	bandE[NB_BANDS - 1]! *= 2;
}

function computeBandCorr(
	bandE: Float64Array,
	xRe: Float64Array,
	xIm: Float64Array,
	pRe: Float64Array,
	pIm: Float64Array
): void {
	bandE.fill(0);
	for (let i = 0; i < NB_BANDS - 1; i++) {
		const bandSize = (EBAND_5MS[i + 1]! - EBAND_5MS[i]!) << 2;
		const base = EBAND_5MS[i]! << 2;
		for (let j = 0; j < bandSize; j++) {
			const frac = j / bandSize;
			const tmp = xRe[base + j]! * pRe[base + j]! + xIm[base + j]! * pIm[base + j]!;
			bandE[i]! += (1 - frac) * tmp;
			bandE[i + 1]! += frac * tmp;
		}
	}
	bandE[0]! *= 2;
	bandE[NB_BANDS - 1]! *= 2;
}

function interpBandGain(g: Float64Array, bandE: Float64Array): void {
	g.fill(0);
	for (let i = 0; i < NB_BANDS - 1; i++) {
		const bandSize = (EBAND_5MS[i + 1]! - EBAND_5MS[i]!) << 2;
		const base = EBAND_5MS[i]! << 2;
		for (let j = 0; j < bandSize; j++) {
			const frac = j / bandSize;
			g[base + j] = (1 - frac) * bandE[i]! + frac * bandE[i + 1]!;
		}
	}
}

// ── Pitch analysis (port of pitch.c / celt_lpc.c, float build) ──

function celtInnerProd(
	x: Float64Array,
	xOff: number,
	y: Float64Array,
	yOff: number,
	n: number
): number {
	let sum = 0;
	for (let i = 0; i < n; i++) sum += x[xOff + i]! * y[yOff + i]!;
	return sum;
}

function celtPitchXcorr(
	x: Float64Array,
	xOff: number,
	y: Float64Array,
	yOff: number,
	xcorr: Float64Array,
	len: number,
	maxPitch: number
): void {
	for (let i = 0; i < maxPitch; i++) {
		xcorr[i] = celtInnerProd(x, xOff, y, yOff + i, len);
	}
}

function celtAutocorr(
	x: Float64Array,
	xOff: number,
	ac: Float64Array,
	lag: number,
	n: number
): void {
	const fastN = n - lag;
	celtPitchXcorr(x, xOff, x, xOff, ac, fastN, lag + 1);
	for (let k = 0; k <= lag; k++) {
		let d = 0;
		for (let i = k + fastN; i < n; i++) d += x[xOff + i]! * x[xOff + i - k]!;
		ac[k]! += d;
	}
}

function celtLpc(lpc: Float64Array, ac: Float64Array, p: number): void {
	lpc.fill(0, 0, p);
	let error = ac[0]!;
	if (ac[0] === 0) return;
	for (let i = 0; i < p; i++) {
		let rr = 0;
		for (let j = 0; j < i; j++) rr += lpc[j]! * ac[i - j]!;
		rr += ac[i + 1]!;
		const r = -rr / error;
		lpc[i] = r;
		for (let j = 0; j < (i + 1) >> 1; j++) {
			const tmp1 = lpc[j]!;
			const tmp2 = lpc[i - 1 - j]!;
			lpc[j] = tmp1 + r * tmp2;
			lpc[i - 1 - j] = tmp2 + r * tmp1;
		}
		error -= r * r * error;
		if (error < 0.001 * ac[0]!) break;
	}
}

function celtFir5(x: Float64Array, num: Float64Array, y: Float64Array, n: number): void {
	const num0 = num[0]!;
	const num1 = num[1]!;
	const num2 = num[2]!;
	const num3 = num[3]!;
	const num4 = num[4]!;
	let mem0 = 0;
	let mem1 = 0;
	let mem2 = 0;
	let mem3 = 0;
	let mem4 = 0;
	for (let i = 0; i < n; i++) {
		let sum = x[i]!;
		sum += num0 * mem0 + num1 * mem1 + num2 * mem2 + num3 * mem3 + num4 * mem4;
		mem4 = mem3;
		mem3 = mem2;
		mem2 = mem1;
		mem1 = mem0;
		mem0 = x[i]!;
		y[i] = sum;
	}
}

function pitchDownsample(x: Float64Array, xLp: Float64Array, len: number): void {
	const half = len >> 1;
	for (let i = 1; i < half; i++) {
		xLp[i] = 0.5 * (0.5 * (x[2 * i - 1]! + x[2 * i + 1]!) + x[2 * i]!);
	}
	xLp[0] = 0.5 * (0.5 * x[1]! + x[0]!);

	const ac = new Float64Array(5);
	celtAutocorr(xLp, 0, ac, 4, half);

	ac[0]! *= 1.0001; // noise floor −40 dB
	for (let i = 1; i <= 4; i++) {
		ac[i]! -= ac[i]! * (0.008 * i) * (0.008 * i); // lag windowing
	}

	const lpc = new Float64Array(4);
	celtLpc(lpc, ac, 4);
	let tmp = 1;
	for (let i = 0; i < 4; i++) {
		tmp *= 0.9;
		lpc[i]! *= tmp;
	}
	// Add a zero.
	const c1 = 0.8;
	const lpc2 = new Float64Array(5);
	lpc2[0] = lpc[0]! + 0.8;
	lpc2[1] = lpc[1]! + c1 * lpc[0]!;
	lpc2[2] = lpc[2]! + c1 * lpc[1]!;
	lpc2[3] = lpc[3]! + c1 * lpc[2]!;
	lpc2[4] = c1 * lpc[3]!;
	celtFir5(xLp, lpc2, xLp, half);
}

function findBestPitch(
	xcorr: Float64Array,
	y: Float64Array,
	yOff: number,
	len: number,
	maxPitch: number,
	bestPitch: Int32Array
): void {
	let Syy = 1;
	const bestNum = [-1, -1];
	const bestDen = [0, 0];
	bestPitch[0] = 0;
	bestPitch[1] = 1;
	for (let j = 0; j < len; j++) Syy += y[yOff + j]! * y[yOff + j]!;
	for (let i = 0; i < maxPitch; i++) {
		if (xcorr[i]! > 0) {
			let xcorr16 = xcorr[i]!;
			// Avoid both underflow and overflow when squaring (per the C float path).
			xcorr16 *= 1e-12;
			const num = xcorr16 * xcorr16;
			if (num * bestDen[1]! > bestNum[1]! * Syy) {
				if (num * bestDen[0]! > bestNum[0]! * Syy) {
					bestNum[1] = bestNum[0]!;
					bestDen[1] = bestDen[0]!;
					bestPitch[1] = bestPitch[0]!;
					bestNum[0] = num;
					bestDen[0] = Syy;
					bestPitch[0] = i;
				} else {
					bestNum[1] = num;
					bestDen[1] = Syy;
					bestPitch[1] = i;
				}
			}
		}
		Syy += y[yOff + i + len]! * y[yOff + i + len]! - y[yOff + i]! * y[yOff + i]!;
		Syy = Math.max(1, Syy);
	}
}

function pitchSearch(
	xLp: Float64Array,
	xLpOff: number,
	y: Float64Array,
	len: number,
	maxPitch: number
): number {
	const lag = len + maxPitch;
	const halfLen = len >> 1;
	const quarterLen = len >> 2;
	const halfMax = maxPitch >> 1;
	const quarterMax = maxPitch >> 2;

	const xLp4 = new Float64Array(quarterLen);
	const yLp4 = new Float64Array(lag >> 2);
	for (let j = 0; j < quarterLen; j++) xLp4[j] = xLp[xLpOff + 2 * j]!;
	for (let j = 0; j < yLp4.length; j++) yLp4[j] = y[2 * j]!;

	const xcorr = new Float64Array(halfMax);
	const bestPitch = new Int32Array(2);

	// Coarse search with 4× decimation.
	celtPitchXcorr(xLp4, 0, yLp4, 0, xcorr, quarterLen, quarterMax);
	findBestPitch(xcorr, yLp4, 0, quarterLen, quarterMax, bestPitch);

	// Finer search with 2× decimation.
	for (let i = 0; i < halfMax; i++) {
		xcorr[i] = 0;
		if (Math.abs(i - 2 * bestPitch[0]!) > 2 && Math.abs(i - 2 * bestPitch[1]!) > 2) continue;
		const sum = celtInnerProd(xLp, xLpOff, y, i, halfLen);
		xcorr[i] = Math.max(-1, sum);
	}
	findBestPitch(xcorr, y, 0, halfLen, halfMax, bestPitch);

	// Refine by pseudo-interpolation.
	let offset = 0;
	if (bestPitch[0]! > 0 && bestPitch[0]! < halfMax - 1) {
		const a = xcorr[bestPitch[0]! - 1]!;
		const b = xcorr[bestPitch[0]!]!;
		const c = xcorr[bestPitch[0]! + 1]!;
		if (c - a > 0.7 * (b - a)) offset = 1;
		else if (a - c > 0.7 * (b - c)) offset = -1;
	}
	return 2 * bestPitch[0]! - offset;
}

function computePitchGain(xy: number, xx: number, yy: number): number {
	return xy / Math.sqrt(1 + xx * yy);
}

const SECOND_CHECK = [0, 0, 3, 2, 3, 2, 5, 2, 3, 2, 3, 2, 5, 2, 3, 2];

interface RemoveDoublingResult {
	period: number;
	gain: number;
}

function removeDoubling(
	x: Float64Array,
	maxPeriodIn: number,
	minPeriodIn: number,
	nIn: number,
	t0In: number,
	prevPeriodIn: number,
	prevGain: number
): RemoveDoublingResult {
	const minPeriod0 = minPeriodIn;
	const maxPeriod = maxPeriodIn >> 1;
	const minPeriod = minPeriodIn >> 1;
	let t0 = t0In >> 1;
	const prevPeriod = prevPeriodIn >> 1;
	const n = nIn >> 1;
	const xOff = maxPeriod;
	if (t0 >= maxPeriod) t0 = maxPeriod - 1;

	let T = t0;
	const yyLookup = new Float64Array(maxPeriod + 1);
	const xx = celtInnerProd(x, xOff, x, xOff, n);
	let xy = celtInnerProd(x, xOff, x, xOff - t0, n);
	yyLookup[0] = xx;
	let yy = xx;
	for (let i = 1; i <= maxPeriod; i++) {
		yy = yy + x[xOff - i]! * x[xOff - i]! - x[xOff + n - i]! * x[xOff + n - i]!;
		yyLookup[i] = Math.max(0, yy);
	}
	yy = yyLookup[t0]!;
	let bestXy = xy;
	let bestYy = yy;
	const g0 = computePitchGain(xy, xx, yy);
	let g = g0;
	// Look for any pitch at T/k.
	for (let k = 2; k <= 15; k++) {
		const t1 = Math.floor((2 * t0 + k) / (2 * k));
		if (t1 < minPeriod) break;
		let t1b: number;
		if (k === 2) {
			t1b = t1 + t0 > maxPeriod ? t0 : t0 + t1;
		} else {
			t1b = Math.floor((2 * SECOND_CHECK[k]! * t0 + k) / (2 * k));
		}
		xy = celtInnerProd(x, xOff, x, xOff - t1, n);
		const xy2 = celtInnerProd(x, xOff, x, xOff - t1b, n);
		xy = 0.5 * (xy + xy2);
		yy = 0.5 * (yyLookup[t1]! + yyLookup[t1b]!);
		const g1 = computePitchGain(xy, xx, yy);
		let cont = 0;
		if (Math.abs(t1 - prevPeriod) <= 1) cont = prevGain;
		else if (Math.abs(t1 - prevPeriod) <= 2 && 5 * k * k < t0) cont = 0.5 * prevGain;
		let thresh = Math.max(0.3, 0.7 * g0 - cont);
		// Bias against very short periods to avoid false positives.
		if (t1 < 3 * minPeriod) thresh = Math.max(0.4, 0.85 * g0 - cont);
		else if (t1 < 2 * minPeriod) thresh = Math.max(0.5, 0.9 * g0 - cont);
		if (g1 > thresh) {
			bestXy = xy;
			bestYy = yy;
			T = t1;
			g = g1;
		}
	}
	bestXy = Math.max(0, bestXy);
	let pg = bestYy <= bestXy ? 1 : bestXy / (bestYy + 1);

	const xcorr = new Float64Array(3);
	for (let k = 0; k < 3; k++) {
		xcorr[k] = celtInnerProd(x, xOff, x, xOff - (T + k - 1), n);
	}
	let offset = 0;
	if (xcorr[2]! - xcorr[0]! > 0.7 * (xcorr[1]! - xcorr[0]!)) offset = 1;
	else if (xcorr[0]! - xcorr[2]! > 0.7 * (xcorr[1]! - xcorr[2]!)) offset = -1;
	if (pg > g) pg = g;
	let period = 2 * T + offset;
	if (period < minPeriod0) period = minPeriod0;
	return { period, gain: pg };
}

// ── Per-frame spectra carried from feature extraction to gain application ──

/** Spectra and band data saved per frame for the post-processing pitch filter. */
export interface FrameSpectra {
	xRe: Float64Array; // FREQ_SIZE
	xIm: Float64Array;
	pRe: Float64Array;
	pIm: Float64Array;
	ex: Float64Array; // NB_BANDS
	ep: Float64Array;
	exp: Float64Array;
}

export function createFrameSpectra(): FrameSpectra {
	return {
		xRe: new Float64Array(FREQ_SIZE),
		xIm: new Float64Array(FREQ_SIZE),
		pRe: new Float64Array(FREQ_SIZE),
		pIm: new Float64Array(FREQ_SIZE),
		ex: new Float64Array(NB_BANDS),
		ep: new Float64Array(NB_BANDS),
		exp: new Float64Array(NB_BANDS)
	};
}

// ── DenoiseState (streaming; carried across frames and chunks) ──

export class RnnoiseDsp {
	private readonly analysisMem = new Float64Array(FRAME_SIZE);
	private readonly synthesisMem = new Float64Array(FRAME_SIZE);
	private readonly pitchBuf = new Float64Array(PITCH_BUF_SIZE);
	private readonly cepstralMem: Float64Array[] = Array.from(
		{ length: CEPS_MEM },
		() => new Float64Array(NB_BANDS)
	);
	private memid = 0;
	private lastGain = 0;
	private lastPeriod = 0;
	private readonly memHpX = new Float64Array(2);
	private readonly lastg = new Float64Array(NB_BANDS);

	// Reused scratch buffers (single-threaded worker; no reentrancy).
	private readonly windowBuf = new Float64Array(WINDOW_SIZE);
	private readonly hpBuf = new Float64Array(FRAME_SIZE);
	private readonly pitchDownBuf = new Float64Array(PITCH_BUF_SIZE >> 1);
	private readonly synthBuf = new Float64Array(WINDOW_SIZE);
	private readonly bandBuf = new Float64Array(NB_BANDS);
	private readonly freqBuf = new Float64Array(FREQ_SIZE);
	private readonly ly = new Float64Array(NB_BANDS);

	reset(): void {
		this.analysisMem.fill(0);
		this.synthesisMem.fill(0);
		this.pitchBuf.fill(0);
		for (const row of this.cepstralMem) row.fill(0);
		this.memid = 0;
		this.lastGain = 0;
		this.lastPeriod = 0;
		this.memHpX.fill(0);
		this.lastg.fill(0);
	}

	/** High-pass biquad matching the C `b_hp`/`a_hp` coefficients (state carried). */
	private biquadHp(out: Float64Array, input: Float32Array): void {
		const b0 = -2;
		const b1 = 1;
		const a0 = -1.99599;
		const a1 = 0.996;
		let mem0 = this.memHpX[0]!;
		let mem1 = this.memHpX[1]!;
		for (let i = 0; i < FRAME_SIZE; i++) {
			// Input is float [-1,1]; the model was trained on int16-scale floats.
			const xi = input[i]! * 32768;
			const yi = xi + mem0;
			mem0 = mem1 + (b0 * xi - a0 * yi);
			mem1 = b1 * xi - a1 * yi;
			out[i] = yi;
		}
		this.memHpX[0] = mem0;
		this.memHpX[1] = mem1;
	}

	private frameAnalysis(spectra: FrameSpectra, input: Float64Array): void {
		const x = this.windowBuf;
		x.set(this.analysisMem);
		for (let i = 0; i < FRAME_SIZE; i++) x[FRAME_SIZE + i] = input[i]!;
		this.analysisMem.set(input.subarray(0, FRAME_SIZE));
		applyWindow(x);
		forwardTransform(x, spectra.xRe, spectra.xIm);
		computeBandEnergy(spectra.ex, spectra.xRe, spectra.xIm);
	}

	/**
	 * Extracts the 42 features for one 480-sample frame and fills `spectra` for
	 * the later gain application. Returns true when the frame is silent (the
	 * features are zeroed and cepstral state is left untouched, per the C code).
	 */
	preProcessFrame(input: Float32Array, features: Float32Array, spectra: FrameSpectra): boolean {
		const x = this.hpBuf;
		this.biquadHp(x, input);
		this.frameAnalysis(spectra, x);

		// Slide the pitch buffer and append the high-passed frame.
		this.pitchBuf.copyWithin(0, FRAME_SIZE);
		this.pitchBuf.set(x.subarray(0, FRAME_SIZE), PITCH_BUF_SIZE - FRAME_SIZE);

		const pitchDown = this.pitchDownBuf;
		pitchDownsample(this.pitchBuf, pitchDown, PITCH_BUF_SIZE);
		let pitchIndex = pitchSearch(
			pitchDown,
			PITCH_MAX_PERIOD >> 1,
			pitchDown,
			PITCH_FRAME_SIZE,
			PITCH_MAX_PERIOD - 3 * PITCH_MIN_PERIOD
		);
		pitchIndex = PITCH_MAX_PERIOD - pitchIndex;
		const doubling = removeDoubling(
			pitchDown,
			PITCH_MAX_PERIOD,
			PITCH_MIN_PERIOD,
			PITCH_FRAME_SIZE,
			pitchIndex,
			this.lastPeriod,
			this.lastGain
		);
		pitchIndex = doubling.period;
		this.lastPeriod = doubling.period;
		this.lastGain = doubling.gain;

		const p = this.windowBuf;
		for (let i = 0; i < WINDOW_SIZE; i++) {
			p[i] = this.pitchBuf[PITCH_BUF_SIZE - WINDOW_SIZE - pitchIndex + i]!;
		}
		applyWindow(p);
		forwardTransform(p, spectra.pRe, spectra.pIm);
		computeBandEnergy(spectra.ep, spectra.pRe, spectra.pIm);
		computeBandCorr(spectra.exp, spectra.xRe, spectra.xIm, spectra.pRe, spectra.pIm);
		for (let i = 0; i < NB_BANDS; i++) {
			spectra.exp[i]! /= Math.sqrt(0.001 + spectra.ex[i]! * spectra.ep[i]!);
		}
		const tmp = this.bandBuf;
		dct(tmp, spectra.exp);
		for (let i = 0; i < NB_DELTA_CEPS; i++) {
			features[NB_BANDS + 2 * NB_DELTA_CEPS + i] = tmp[i]!;
		}
		features[NB_BANDS + 2 * NB_DELTA_CEPS]! -= 1.3;
		features[NB_BANDS + 2 * NB_DELTA_CEPS + 1]! -= 0.9;
		features[NB_BANDS + 3 * NB_DELTA_CEPS] = 0.01 * (pitchIndex - 300);

		let logMax = -2;
		let follow = -2;
		let energy = 0;
		const ly = this.ly;
		for (let i = 0; i < NB_BANDS; i++) {
			let value = Math.log10(1e-2 + spectra.ex[i]!);
			value = Math.max(logMax - 7, Math.max(follow - 1.5, value));
			logMax = Math.max(logMax, value);
			follow = Math.max(follow - 1.5, value);
			ly[i] = value;
			energy += spectra.ex[i]!;
		}
		if (energy < 0.04) {
			// No meaningful audio: zero the features and avoid touching the state.
			features.fill(0, 0, NB_FEATURES);
			return true;
		}
		dct(features, ly);
		features[0]! -= 12;
		features[1]! -= 4;
		const ceps0 = this.cepstralMem[this.memid]!;
		const ceps1 = this.cepstralMem[(this.memid + CEPS_MEM - 1) % CEPS_MEM]!;
		const ceps2 = this.cepstralMem[(this.memid + CEPS_MEM - 2) % CEPS_MEM]!;
		for (let i = 0; i < NB_BANDS; i++) ceps0[i] = features[i]!;
		this.memid = (this.memid + 1) % CEPS_MEM;
		for (let i = 0; i < NB_DELTA_CEPS; i++) {
			features[i] = ceps0[i]! + ceps1[i]! + ceps2[i]!;
			features[NB_BANDS + i] = ceps0[i]! - ceps2[i]!;
			features[NB_BANDS + NB_DELTA_CEPS + i] = ceps0[i]! - 2 * ceps1[i]! + ceps2[i]!;
		}
		// Spectral variability.
		let specVariability = 0;
		for (let i = 0; i < CEPS_MEM; i++) {
			let minDist = 1e15;
			for (let j = 0; j < CEPS_MEM; j++) {
				if (j === i) continue;
				let dist = 0;
				for (let k = 0; k < NB_BANDS; k++) {
					const diff = this.cepstralMem[i]![k]! - this.cepstralMem[j]![k]!;
					dist += diff * diff;
				}
				minDist = Math.min(minDist, dist);
			}
			specVariability += minDist;
		}
		features[NB_BANDS + 3 * NB_DELTA_CEPS + 1] = specVariability / CEPS_MEM - 2.1;
		return false;
	}

	private pitchFilter(spectra: FrameSpectra, g: Float64Array): void {
		const r = this.bandBuf;
		for (let i = 0; i < NB_BANDS; i++) {
			const exp = spectra.exp[i]!;
			const gain = g[i]!;
			let value: number;
			if (exp > gain) value = 1;
			else {
				value = (exp * exp * (1 - gain * gain)) / (0.001 + gain * gain * (1 - exp * exp));
				value = Math.sqrt(Math.min(1, Math.max(0, value)));
			}
			r[i] = value * Math.sqrt(spectra.ex[i]! / (1e-8 + spectra.ep[i]!));
		}
		const rf = this.freqBuf;
		interpBandGain(rf, r);
		for (let i = 0; i < FREQ_SIZE; i++) {
			spectra.xRe[i]! += rf[i]! * spectra.pRe[i]!;
			spectra.xIm[i]! += rf[i]! * spectra.pIm[i]!;
		}
		const newE = this.bandBuf;
		computeBandEnergy(newE, spectra.xRe, spectra.xIm);
		const norm = new Float64Array(NB_BANDS);
		for (let i = 0; i < NB_BANDS; i++) {
			norm[i] = Math.sqrt(spectra.ex[i]! / (1e-8 + newE[i]!));
		}
		const normf = this.freqBuf;
		interpBandGain(normf, norm);
		for (let i = 0; i < FREQ_SIZE; i++) {
			spectra.xRe[i]! *= normf[i]!;
			spectra.xIm[i]! *= normf[i]!;
		}
	}

	/**
	 * Applies the model's band gains to a saved frame spectrum and synthesizes
	 * 480 output samples (float [-1,1], clamped like the reference).
	 */
	postProcessFrame(gains: Float32Array, spectra: FrameSpectra, out: Float32Array): void {
		const g = new Float64Array(NB_BANDS);
		for (let i = 0; i < NB_BANDS; i++) g[i] = gains[i]!;
		this.pitchFilter(spectra, g);
		for (let i = 0; i < NB_BANDS; i++) {
			const alpha = 0.6;
			g[i] = Math.max(g[i]!, alpha * this.lastg[i]!);
			this.lastg[i] = g[i]!;
		}
		const gf = this.freqBuf;
		interpBandGain(gf, g);
		for (let i = 0; i < FREQ_SIZE; i++) {
			spectra.xRe[i]! *= gf[i]!;
			spectra.xIm[i]! *= gf[i]!;
		}
		const x = this.synthBuf;
		inverseTransform(spectra.xRe, spectra.xIm, x);
		applyWindow(x);
		for (let i = 0; i < FRAME_SIZE; i++) {
			const sample = x[i]! + this.synthesisMem[i]!;
			out[i] = Math.min(32767, Math.max(-32768, sample)) / 32768;
		}
		this.synthesisMem.set(x.subarray(FRAME_SIZE));
	}
}
