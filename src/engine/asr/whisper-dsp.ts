/**
 * Whisper-class DSP preprocessing (Phase 29). Pure TypeScript log-mel
 * spectrogram extraction. Unit-testable without WebNN, WebGPU, or DOM.
 *
 * Reference: OpenAI Whisper feature extractor
 *   - 25 ms Hann window, 10 ms stride
 *   - 80 mel filterbank bins, 0–8000 Hz
 *   - log scaling with floor, mean-variance normalisation
 */
export interface MelSpectrogramConfig {
	sampleRate: number;
	hopLength: number; // samples between frames (160 for 10 ms at 16 kHz)
	nFft: number; // FFT bin count (400 for 25 ms at 16 kHz)
	nMel: number; // mel filterbank bins (80)
}

export const DEFAULT_MEL_CONFIG: MelSpectrogramConfig = {
	sampleRate: 16000,
	hopLength: 160,
	nFft: 400,
	nMel: 80
};

export interface MelSpectrogram {
	/** melFeatures[frame][bin] — shape (nFrames, nMel) */
	data: Float32Array;
	nFrames: number;
	nMel: number;
}

/** Generate a Hann window of given length. */
export function hannWindow(length: number): Float32Array {
	const w = new Float32Array(length);
	for (let i = 0; i < length; i++) {
		w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
	}
	return w;
}

/** Compute the mel filterbank matrix (nMel × nFft/2+1). */
export function melFilterbank(
	nMel: number,
	nFft: number,
	sampleRate: number,
	fMin: number = 0,
	fMax: number | null = null
): Float32Array {
	const fMaxVal = fMax ?? sampleRate / 2;
	const nFreq = nFft / 2 + 1;
	const melMin = hzToMel(fMin);
	const melMax = hzToMel(fMaxVal);
	const melPoints = new Float32Array(nMel + 2);
	for (let i = 0; i < nMel + 2; i++) {
		melPoints[i] = melMin + (i * (melMax - melMin)) / (nMel + 1);
	}

	const fftFreqs = new Float32Array(nFreq);
	for (let i = 0; i < nFreq; i++) {
		fftFreqs[i] = (i * sampleRate) / nFft;
	}

	const filterbank = new Float32Array(nMel * nFreq);
	for (let m = 0; m < nMel; m++) {
		for (let k = 0; k < nFreq; k++) {
			const freq = fftFreqs[k];
			const mel = hzToMel(freq);
			const left = melPoints[m];
			const center = melPoints[m + 1];
			const right = melPoints[m + 2];

			let weight = 0;
			if (mel >= left && mel <= center) {
				weight = (mel - left) / (center - left);
			} else if (mel >= center && mel <= right) {
				weight = (right - mel) / (right - center);
			}
			filterbank[m * nFreq + k] = weight;
		}
	}
	return filterbank;
}

function hzToMel(hz: number): number {
	return 2595 * Math.log10(1 + hz / 700);
}

/** Compute power spectrum from real-valued PCM frame. */
export function powerSpectrum(frame: Float32Array, window: Float32Array, nFft: number): Float32Array {
	const n = frame.length;
	const real = new Float32Array(nFft);
	const imag = new Float32Array(nFft);
	for (let i = 0; i < n; i++) {
		real[i] = frame[i] * window[i];
	}
	// DFT (not FFT for simplicity — nFft=400 is small enough for a direct DFT
	// in unit-testable code; a real FFT would be used in production via wasm or
	// a future optimisation).
	dft(real, imag, nFft);
	const nFreq = nFft / 2 + 1;
	const power = new Float32Array(nFreq);
	for (let i = 0; i < nFreq; i++) {
		power[i] = (real[i] * real[i] + imag[i] * imag[i]) / nFft;
	}
	return power;
}

const dftTrigCache = new Map<number, { cos: Float32Array; sin: Float32Array }>();

function dftTrigTables(n: number): { cos: Float32Array; sin: Float32Array } {
	let tables = dftTrigCache.get(n);
	if (!tables) {
		const cos = new Float32Array(n);
		const sin = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const angle = (-2 * Math.PI * i) / n;
			cos[i] = Math.cos(angle);
			sin[i] = Math.sin(angle);
		}
		tables = { cos, sin };
		dftTrigCache.set(n, tables);
	}
	return tables;
}

/** DFT (O(n²)) with cached sine/cosine tables. For nFft=400
 *  the tables are ~3.2 KB and eliminate all trig calls from the inner loop. */
function dft(real: Float32Array, imag: Float32Array, n: number): void {
	const resultReal = new Float32Array(n);
	const resultImag = new Float32Array(n);

	const { cos: cosTable, sin: sinTable } = dftTrigTables(n);

	for (let k = 0; k < n; k++) {
		let sumReal = 0;
		let sumImag = 0;
		for (let t = 0; t < n; t++) {
			const idx = (k * t) % n;
			const c = cosTable[idx];
			const s = sinTable[idx];
			sumReal += real[t] * c + imag[t] * s;
			sumImag += -real[t] * s + imag[t] * c;
		}
		resultReal[k] = sumReal;
		resultImag[k] = sumImag;
	}
	real.set(resultReal);
	imag.set(resultImag);
}

/** Extract log-mel spectrogram from mono audio PCM at 16 kHz. */
export function extractMelSpectrogram(
	pcm: Float32Array,
	config: MelSpectrogramConfig = DEFAULT_MEL_CONFIG
): MelSpectrogram {
	const { hopLength, nFft, nMel, sampleRate } = config;
	const nFreq = nFft / 2 + 1;
	const nFrames = Math.max(1, Math.floor((pcm.length - nFft) / hopLength) + 1);
	const window = hannWindow(nFft);
	const filterbank = melFilterbank(nMel, nFft, sampleRate);

	const melData = new Float32Array(nFrames * nMel);

	for (let frame = 0; frame < nFrames; frame++) {
		const start = frame * hopLength;
		const frameData = pcm.slice(start, start + nFft);
		const power = powerSpectrum(frameData, window, nFft);

		// Apply mel filterbank
		for (let m = 0; m < nMel; m++) {
			let sum = 0;
			for (let k = 0; k < nFreq; k++) {
				sum += power[k] * Math.max(0, filterbank[m * nFreq + k]);
			}
			melData[frame * nMel + m] = Math.max(Math.log(sum + 1e-10), 0);
		}
	}

	return { data: melData, nFrames, nMel };
}

/** Apply mean-variance normalisation across all frames (Whisper-style). */
export function normaliseMelSpectrogram(mel: MelSpectrogram): Float32Array {
	const { data } = mel;
	const normalised = new Float32Array(data.length);

	// Global mean and std
	let sum = 0;
	for (let i = 0; i < data.length; i++) sum += data[i];
	const mean = sum / data.length;

	let sqSum = 0;
	for (let i = 0; i < data.length; i++) sqSum += (data[i] - mean) ** 2;
	const std = Math.sqrt(sqSum / data.length) || 1;

	for (let i = 0; i < data.length; i++) {
		normalised[i] = (data[i] - mean) / (std * 2);
	}

	return normalised;
}

/**
 * Split PCM into 30-second chunks with 3-second overlap for seamless
 * transcription across boundaries. Returns spectrograms for each chunk.
 */
export interface ChunkedMelSpectrogram {
	data: Float32Array;
	/** Number of mel frames in this chunk. */
	nFrames: number;
	startFrame: number;
}

export function chunkAndExtractMel(
	pcm: Float32Array,
	sampleRate: number,
	config: MelSpectrogramConfig = DEFAULT_MEL_CONFIG
): ChunkedMelSpectrogram[] {
	const maxChunkSamples = 30 * sampleRate;
	const overlapSamples = 3 * sampleRate;
	const chunks: ChunkedMelSpectrogram[] = [];

	let start = 0;
	let chunkIndex = 0;
	while (start < pcm.length) {
		const end = Math.min(start + maxChunkSamples, pcm.length);
		const chunkPcm = pcm.slice(start, end);
		const mel = extractMelSpectrogram(chunkPcm, config);
		chunks.push({
			data: mel.data,
			nFrames: mel.nFrames,
			startFrame: Math.floor(chunkIndex * (maxChunkSamples - overlapSamples) / config.hopLength)
		});
		if (end === pcm.length) break;
		start = end - overlapSamples;
		if (start >= pcm.length) break;
		chunkIndex++;
	}
	return chunks;
}

/** Downmix multi-channel PCM to mono (equal-power). */
export function downmixToMono(pcm: Float32Array, channels: number): Float32Array {
	if (channels <= 1) return new Float32Array(pcm);
	const frames = pcm.length / channels;
	const mono = new Float32Array(frames);
	const scale = 1 / Math.sqrt(channels);
	for (let i = 0; i < frames; i++) {
		let sum = 0;
		for (let c = 0; c < channels; c++) {
			sum += pcm[i * channels + c];
		}
		mono[i] = sum * scale;
	}
	return mono;
}
