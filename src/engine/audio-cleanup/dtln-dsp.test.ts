import { describe, expect, it } from 'vite-plus/test';
import {
	DTLN_BLOCK_LEN,
	DTLN_BLOCK_SHIFT,
	DTLN_FREQ_BINS,
	DtlnDsp,
	type DtlnFrameData
} from './dtln-dsp';

function fft(re: Float32Array, im: Float32Array, n: number, inverse: boolean): void {
	let j = 0;
	for (let i = 0; i < n - 1; i++) {
		if (i < j) {
			const tmpRe = re[i]!;
			re[i] = re[j]!;
			re[j] = tmpRe;
			const tmpIm = im[i]!;
			im[i] = im[j]!;
			im[j] = tmpIm;
		}
		let k = n >> 1;
		while (k <= j) {
			j -= k;
			k >>= 1;
		}
		j += k;
	}

	const dir = inverse ? 1 : -1;
	for (let stage = 1; stage < n; stage <<= 1) {
		const angle = (dir * Math.PI) / stage;
		const wRe = Math.cos(angle);
		const wIm = Math.sin(angle);
		for (let group = 0; group < n; group += stage << 1) {
			let tRe = 1;
			let tIm = 0;
			for (let pair = 0; pair < stage; pair++) {
				const a = group + pair;
				const b = a + stage;
				const uRe = re[a]!;
				const uIm = im[a]!;
				const bRe = re[b]!;
				const bIm = im[b]!;
				const vRe = bRe * tRe - bIm * tIm;
				const vIm = bRe * tIm + bIm * tRe;
				re[a] = uRe + vRe;
				im[a] = uIm + vIm;
				re[b] = uRe - vRe;
				im[b] = uIm - vIm;
				const nextTRe = tRe * wRe - tIm * wIm;
				tIm = tRe * wIm + tIm * wRe;
				tRe = nextTRe;
			}
		}
	}

	if (inverse) {
		const invN = 1 / n;
		for (let i = 0; i < n; i++) {
			re[i] *= invN;
			im[i] *= invN;
		}
	}
}

class ReferenceDtlnDsp {
	private readonly inBuffer = new Float32Array(DTLN_BLOCK_LEN);
	private readonly outBuffer = new Float32Array(DTLN_BLOCK_LEN);
	private readonly fftRe = new Float32Array(DTLN_BLOCK_LEN);
	private readonly fftIm = new Float32Array(DTLN_BLOCK_LEN);

	forwardStep(newSamples: Float32Array): DtlnFrameData {
		this.inBuffer.copyWithin(0, DTLN_BLOCK_SHIFT);
		this.inBuffer.set(newSamples, DTLN_BLOCK_LEN - DTLN_BLOCK_SHIFT);

		this.fftRe.set(this.inBuffer);
		this.fftIm.fill(0);
		fft(this.fftRe, this.fftIm, DTLN_BLOCK_LEN, false);

		const magnitude = new Float32Array(DTLN_FREQ_BINS);
		const phase = new Float32Array(DTLN_FREQ_BINS);
		for (let i = 0; i < DTLN_FREQ_BINS; i++) {
			const re = this.fftRe[i]!;
			const im = this.fftIm[i]!;
			magnitude[i] = Math.sqrt(re * re + im * im);
			phase[i] = Math.atan2(im, re);
		}
		return { magnitude, phase };
	}

	applyMaskAndIfft(mask: Float32Array, frame: DtlnFrameData): Float32Array {
		for (let i = 0; i < DTLN_FREQ_BINS; i++) {
			const mag = frame.magnitude[i]! * mask[i]!;
			this.fftRe[i] = mag * Math.cos(frame.phase[i]!);
			this.fftIm[i] = mag * Math.sin(frame.phase[i]!);
		}
		for (let i = DTLN_FREQ_BINS; i < DTLN_BLOCK_LEN; i++) {
			const mirror = DTLN_BLOCK_LEN - i;
			this.fftRe[i] = this.fftRe[mirror]!;
			this.fftIm[i] = -this.fftIm[mirror]!;
		}
		fft(this.fftRe, this.fftIm, DTLN_BLOCK_LEN, true);
		return this.fftRe.slice(0, DTLN_BLOCK_LEN);
	}

	overlapAdd(enhanced: Float32Array): Float32Array {
		this.outBuffer.copyWithin(0, DTLN_BLOCK_SHIFT);
		this.outBuffer.fill(0, DTLN_BLOCK_LEN - DTLN_BLOCK_SHIFT);
		for (let i = 0; i < DTLN_BLOCK_LEN; i++) {
			this.outBuffer[i] += enhanced[i]!;
		}
		return this.outBuffer.slice(0, DTLN_BLOCK_SHIFT);
	}

	flushOverlapAdd(): Float32Array {
		const tailFrames = DTLN_BLOCK_LEN / DTLN_BLOCK_SHIFT - 1;
		const out = new Float32Array(tailFrames * DTLN_BLOCK_SHIFT);
		for (let i = 0; i < tailFrames; i++) {
			this.outBuffer.copyWithin(0, DTLN_BLOCK_SHIFT);
			this.outBuffer.fill(0, DTLN_BLOCK_LEN - DTLN_BLOCK_SHIFT);
			out.set(this.outBuffer.subarray(0, DTLN_BLOCK_SHIFT), i * DTLN_BLOCK_SHIFT);
		}
		return out;
	}
}

function makeFrame(seed: number): Float32Array {
	const frame = new Float32Array(DTLN_BLOCK_SHIFT);
	for (let i = 0; i < frame.length; i++) {
		frame[i] =
			Math.sin((2 * Math.PI * (seed + 3) * i) / frame.length) +
			0.25 * Math.cos((2 * Math.PI * (seed + 7) * i) / frame.length);
	}
	return frame;
}

function makeMask(seed: number): Float32Array {
	const mask = new Float32Array(DTLN_FREQ_BINS);
	for (let i = 0; i < mask.length; i++) {
		mask[i] = 0.3 + ((i + seed) % 17) / 20;
	}
	return mask;
}

describe('DtlnDsp', () => {
	it('matches the pre-reuse reference output bit-for-bit across multiple frames', () => {
		const actual = new DtlnDsp();
		const reference = new ReferenceDtlnDsp();

		for (let seed = 0; seed < 4; seed++) {
			const samples = makeFrame(seed);
			const actualFrame = actual.forwardStep(samples);
			const referenceFrame = reference.forwardStep(samples);
			expect(actualFrame.magnitude).toEqual(referenceFrame.magnitude);
			expect(actualFrame.phase).toEqual(referenceFrame.phase);

			const mask = makeMask(seed);
			const actualEstimated = actual.applyMaskAndIfft(mask, actualFrame);
			const referenceEstimated = reference.applyMaskAndIfft(mask, referenceFrame);
			expect(actualEstimated).toEqual(referenceEstimated);

			const actualOverlap = actual.overlapAdd(actualEstimated);
			const referenceOverlap = reference.overlapAdd(referenceEstimated);
			expect(actualOverlap).toEqual(referenceOverlap);
		}

		expect(actual.flushOverlapAdd()).toEqual(reference.flushOverlapAdd());
	});
});
