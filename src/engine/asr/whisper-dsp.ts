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

/** Generate a periodic Hann window (matches `torch.hann_window`, periodic=True). */
export function hannWindow(length: number): Float32Array {
	const w = new Float32Array(length);
	for (let i = 0; i < length; i++) {
		w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
	}
	return w;
}

// Slaney mel scale (librosa htk=False — what Whisper's mel filters use).
const MEL_F_SP = 200 / 3;
const MEL_MIN_LOG_HZ = 1000;
const MEL_MIN_LOG_MEL = MEL_MIN_LOG_HZ / MEL_F_SP;
const MEL_LOGSTEP = Math.log(6.4) / 27;

function hzToMel(hz: number): number {
	return hz < MEL_MIN_LOG_HZ
		? hz / MEL_F_SP
		: MEL_MIN_LOG_MEL + Math.log(hz / MEL_MIN_LOG_HZ) / MEL_LOGSTEP;
}

function melToHz(mel: number): number {
	return mel < MEL_MIN_LOG_MEL
		? MEL_F_SP * mel
		: MEL_MIN_LOG_HZ * Math.exp(MEL_LOGSTEP * (mel - MEL_MIN_LOG_MEL));
}

/**
 * Slaney-normalized triangular mel filterbank (nMel × nFft/2+1) — matches
 * librosa.filters.mel (htk=False, norm='slaney'), which is what OpenAI Whisper's
 * `mel_filters` are built with. Triangles are formed in Hz over the FFT bin
 * frequencies and area-normalized so each band integrates to ~1.
 */
export function melFilterbank(
	nMel: number,
	nFft: number,
	sampleRate: number,
	fMin: number = 0,
	fMax: number | null = null
): Float32Array {
	const fMaxVal = fMax ?? sampleRate / 2;
	const nFreq = nFft / 2 + 1;
	const fftFreqs = new Float32Array(nFreq);
	for (let k = 0; k < nFreq; k++) fftFreqs[k] = (k * sampleRate) / nFft;

	const melMin = hzToMel(fMin);
	const melMax = hzToMel(fMaxVal);
	const hzPoints = new Float32Array(nMel + 2);
	for (let i = 0; i < nMel + 2; i++) {
		hzPoints[i] = melToHz(melMin + (i * (melMax - melMin)) / (nMel + 1));
	}

	const filterbank = new Float32Array(nMel * nFreq);
	for (let m = 0; m < nMel; m++) {
		const lower = hzPoints[m];
		const center = hzPoints[m + 1];
		const upper = hzPoints[m + 2];
		const enorm = 2 / (upper - lower);
		for (let k = 0; k < nFreq; k++) {
			const f = fftFreqs[k];
			const down = (f - lower) / (center - lower);
			const up = (upper - f) / (upper - center);
			filterbank[m * nFreq + k] = Math.max(0, Math.min(down, up)) * enorm;
		}
	}
	return filterbank;
}

/** Compute power spectrum from real-valued PCM frame. */
export function powerSpectrum(
	frame: Float32Array,
	window: Float32Array,
	nFft: number
): Float32Array {
	const n = frame.length;
	const real = new Float32Array(nFft);
	const imag = new Float32Array(nFft);
	for (let i = 0; i < n; i++) {
		real[i] = frame[i] * window[i];
	}
	// Keep this direct DFT intentionally conservative. A previous mixed-radix
	// rewrite was faster but changed real-world Whisper output quality; ASR
	// correctness matters more than this local preprocessing speed.
	dft(real, imag, nFft);
	const nFreq = nFft / 2 + 1;
	const power = new Float32Array(nFreq);
	for (let i = 0; i < nFreq; i++) {
		// |STFT|² (matches torch.stft magnitudes — no 1/N scaling).
		power[i] = real[i] * real[i] + imag[i] * imag[i];
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

const melStaticCache = new Map<string, { window: Float32Array; filterbank: Float32Array }>();

function getMelStatics(config: MelSpectrogramConfig): {
	window: Float32Array;
	filterbank: Float32Array;
} {
	const key = `${config.nFft}-${config.nMel}-${config.sampleRate}`;
	let statics = melStaticCache.get(key);
	if (!statics) {
		statics = {
			window: hannWindow(config.nFft),
			filterbank: melFilterbank(config.nMel, config.nFft, config.sampleRate)
		};
		melStaticCache.set(key, statics);
	}
	return statics;
}

/** DFT (O(n²)) with cached sine/cosine tables. */
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

/** Reflect-pad a signal by `pad` samples each side (numpy 'reflect' / torch center). */
export function reflectPad(pcm: Float32Array, pad: number): Float32Array {
	const n = pcm.length;
	if (n === 0) return new Float32Array(2 * pad);
	const out = new Float32Array(n + 2 * pad);
	out.set(pcm, pad);
	for (let i = 0; i < pad; i++) {
		out[pad - 1 - i] = pcm[Math.min(i + 1, n - 1)];
		out[pad + n + i] = pcm[Math.max(n - 2 - i, 0)];
	}
	return out;
}

/**
 * Extract the log-mel spectrogram exactly as OpenAI Whisper does: reflect-center
 * the audio, STFT with a periodic Hann window, apply the slaney mel filterbank,
 * and take `log10` with a 1e-10 floor. Frame count matches `len / hop` (the
 * centered STFT drops its trailing frame).
 */
export function extractMelSpectrogram(
	pcm: Float32Array,
	config: MelSpectrogramConfig = DEFAULT_MEL_CONFIG
): MelSpectrogram {
	const { hopLength, nFft, nMel } = config;
	const nFreq = nFft / 2 + 1;
	const { window, filterbank } = getMelStatics(config);

	const padded = reflectPad(pcm, nFft / 2);
	const nFrames = Math.max(1, Math.floor((padded.length - nFft) / hopLength)); // drop trailing frame

	const melData = new Float32Array(nFrames * nMel);
	for (let frame = 0; frame < nFrames; frame++) {
		const start = frame * hopLength;
		const frameData = padded.subarray(start, start + nFft);
		const power = powerSpectrum(frameData, window, nFft);
		for (let m = 0; m < nMel; m++) {
			let sum = 0;
			for (let k = 0; k < nFreq; k++) sum += power[k] * filterbank[m * nFreq + k];
			melData[frame * nMel + m] = Math.log10(Math.max(sum, 1e-10));
		}
	}

	return { data: melData, nFrames, nMel };
}

/**
 * Whisper's log-mel normalisation: clamp to `[max − 8, max]`, then `(x + 4) / 4`,
 * giving roughly `[-1, 1]` features the encoder was trained on.
 */
export function normaliseMelSpectrogram(mel: MelSpectrogram): Float32Array {
	const { data } = mel;
	let maxVal = -Infinity;
	for (let i = 0; i < data.length; i++) if (data[i] > maxVal) maxVal = data[i];
	const floor = maxVal - 8;
	const normalised = new Float32Array(data.length);
	for (let i = 0; i < data.length; i++) {
		normalised[i] = (Math.max(data[i], floor) + 4) / 4;
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
	if (sampleRate !== config.sampleRate) {
		config = { ...config, sampleRate };
	}
	const maxChunkSamples = 30 * config.sampleRate;
	const overlapSamples = 3 * config.sampleRate;
	const chunks: ChunkedMelSpectrogram[] = [];

	let start = 0;
	let chunkIndex = 0;
	while (start < pcm.length) {
		const end = Math.min(start + maxChunkSamples, pcm.length);
		const chunkPcm = pcm.slice(start, end);
		const mel = extractMelSpectrogram(chunkPcm, config);
		const normalised = normaliseMelSpectrogram(mel);
		chunks.push({
			data: normalised,
			nFrames: mel.nFrames,
			startFrame: Math.floor((chunkIndex * (maxChunkSamples - overlapSamples)) / config.hopLength)
		});
		const advance = maxChunkSamples - overlapSamples;
		if (advance <= 0 || end >= pcm.length) break;
		start += advance;
		chunkIndex++;
	}
	return chunks;
}

export class AudioContractError extends Error {
	constructor(reason: string) {
		super(`ASR audio contract violated: ${reason}`);
		this.name = 'AudioContractError';
	}
}

/**
 * Validates the audio contract and returns 16 kHz mono PCM. The pipeline worker
 * already resamples each extracted window to the requested rate, so a rate
 * mismatch here is a programming error, not a recoverable condition.
 */
export function prepareMonoPcm(
	pcm: Float32Array,
	channels: number,
	sampleRate: number,
	expectedSampleRate = 16000
): Float32Array {
	if (sampleRate !== expectedSampleRate) {
		throw new AudioContractError(`expected ${expectedSampleRate} Hz PCM, got ${sampleRate} Hz`);
	}
	if (!Number.isInteger(channels) || channels < 1) {
		throw new AudioContractError(`channel count must be a positive integer, got ${channels}`);
	}
	return downmixToMono(pcm, channels);
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
