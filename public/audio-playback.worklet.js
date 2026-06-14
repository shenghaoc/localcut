const RING_WRITE = 0;
const RING_READ = 1;
const RING_SAMPLE_RATE = 2;
const RING_CHANNELS = 3;
const RING_CAPACITY = 4;
const RING_GENERATION = 5;
const RING_STATE = 6;
const RING_HEADER_INTS = 8;

const CLOCK_AUDIO = 3;

const METER_PEAK_L = 0;
const METER_PEAK_R = 1;
const METER_RMS_L = 2;
const METER_RMS_R = 3;
const DENOISER_BYPASS_TRACKS_0_15 = 35;
const DENOISER_BYPASS_TRACKS_16_31 = 36;
const VOICE_CLEANUP_NORMALISE_GAIN_DB = 37;
const RNNOISE_FRAME_SIZE = 480;
const DENOISER_CROSSFADE_FRAMES = 480;
const MAX_AUDIO_RING_TRACKS = 32;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CHAIN_GATE_BYPASS = 17;
const CHAIN_GATE_THRESHOLD = 18;
const CHAIN_GATE_RANGE = 19;
const CHAIN_GATE_ATTACK = 20;
const CHAIN_GATE_HOLD = 21;
const CHAIN_GATE_RELEASE = 22;
const CHAIN_LIMITER_BYPASS = 30;
const CHAIN_LIMITER_CEILING = 31;
const CHAIN_LIMITER_ATTACK = 32;
const CHAIN_LIMITER_RELEASE = 33;

function decodeBase64Wasm(b64) {
	if (typeof atob === 'function') {
		const binary = atob(b64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
		return bytes;
	}
	const clean = b64.replace(/=+$/, '');
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
	let buffer = 0;
	let bits = 0;
	let offset = 0;
	for (let i = 0; i < clean.length; i += 1) {
		const value = BASE64_ALPHABET.indexOf(clean[i]);
		if (value < 0) continue;
		buffer = (buffer << 6) | value;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[offset++] = (buffer >> bits) & 0xff;
		}
	}
	return offset === out.length ? out : out.slice(0, offset);
}

class WorkletRnnoiseRing {
	constructor(module) {
		this.module = module;
		this.state = module.create();
		this.inputPtr = module.malloc(RNNOISE_FRAME_SIZE * 4);
		this.outputPtr = module.malloc(RNNOISE_FRAME_SIZE * 4);
		this.inputFrame = new Float32Array(RNNOISE_FRAME_SIZE);
		this.pending = new Float32Array(RNNOISE_FRAME_SIZE * 2);
		this.inputFill = 0;
		this.pendingRead = 0;
		// Match the export RnnoiseRing contract: every ring starts with one
		// frame of queued silence so live monitor and export latency agree.
		this.pendingWrite = RNNOISE_FRAME_SIZE;
	}

	destroy() {
		if (this.state) this.module.destroy(this.state);
		if (this.inputPtr) this.module.free(this.inputPtr);
		if (this.outputPtr) this.module.free(this.outputPtr);
		this.state = 0;
		this.inputPtr = 0;
		this.outputPtr = 0;
	}

	push(input) {
		const output = new Float32Array(input.length);
		for (let i = 0; i < input.length; i += 1) {
			output[i] = this.pushSample(input[i]);
		}
		return output;
	}

	pushSample(input) {
		this.inputFrame[this.inputFill++] = input * 32768;
		if (this.inputFill === RNNOISE_FRAME_SIZE) {
			this.processFrame();
			this.inputFill = 0;
		}
		return this.shiftPending();
	}

	processFrame() {
		const heap = new Float32Array(this.module.memory.buffer);
		heap.set(this.inputFrame, this.inputPtr / 4);
		this.module.processFrame(this.state, this.outputPtr, this.inputPtr);
		const processed = heap.subarray(this.outputPtr / 4, this.outputPtr / 4 + RNNOISE_FRAME_SIZE);
		for (let i = 0; i < processed.length; i += 1) {
			this.pending[this.pendingWrite % this.pending.length] = processed[i] / 32768;
			this.pendingWrite += 1;
		}
	}

	shiftPending() {
		if (this.pendingRead >= this.pendingWrite) return 0;
		const value = this.pending[this.pendingRead % this.pending.length] ?? 0;
		this.pendingRead += 1;
		return value;
	}
}

class WorkletGate {
	constructor() {
		this.envelope = 0;
		this.holdCounter = 0;
	}

	process(input, params, rate) {
		if (params.bypass) return input;
		const output = new Float32Array(input.length);
		const attackMs = Math.max(0.01, params.attackMs);
		const releaseMs = Math.max(0.01, params.releaseMs);
		const holdMs = Math.max(0, params.holdMs);
		const attackCoef = Math.exp(-1 / ((attackMs / 1000) * rate));
		const releaseCoef = Math.exp(-1 / ((releaseMs / 1000) * rate));
		const holdSamples = Math.round((holdMs / 1000) * rate);
		const rangeLinear = Math.pow(10, params.rangeDb / 20);
		const thresholdLinear = Math.pow(10, params.thresholdDb / 20);
		for (let i = 0; i < input.length; i += 1) {
			const target = Math.abs(input[i] ?? 0) > thresholdLinear ? 1 : rangeLinear;
			if (target > this.envelope) {
				this.envelope = attackCoef * this.envelope + (1 - attackCoef) * target;
				this.holdCounter = 0;
			} else if (this.holdCounter < holdSamples) {
				this.holdCounter += 1;
			} else {
				this.envelope = releaseCoef * this.envelope + (1 - releaseCoef) * target;
			}
			output[i] = (input[i] ?? 0) * this.envelope;
		}
		return output;
	}
}

class WorkletLimiter {
	constructor() {
		this.reset(240);
	}

	reset(lookaheadSamples) {
		const delayLen = Math.max(1, Math.round(lookaheadSamples));
		this.envelope = 1;
		this.delayLine = new Float32Array(delayLen);
		this.delayWritePos = 0;
		this.dequePos = new Float64Array(delayLen + 1);
		this.dequeVal = new Float32Array(delayLen + 1);
		this.dequeHead = 0;
		this.dequeTail = 0;
		this.sampleIndex = 0;
	}

	process(input, params, rate) {
		if (params.bypass) return input;
		const desiredDelay = Math.max(1, Math.round(0.005 * rate));
		if (this.delayLine.length !== desiredDelay) this.reset(desiredDelay);
		const output = new Float32Array(input.length);
		const ceilingLinear = Math.pow(10, params.ceilingDb / 20);
		const attackCoef = Math.exp(-1 / ((Math.max(1, params.attackUs) / 1_000_000) * rate));
		const releaseCoef = Math.exp(-1 / ((Math.max(1, params.releaseMs) / 1000) * rate));
		const delayLen = this.delayLine.length;
		const dequeCap = this.dequePos.length;
		for (let i = 0; i < input.length; i += 1) {
			const n = this.sampleIndex++;
			const sample = input[i] ?? 0;
			this.delayLine[this.delayWritePos] = sample;
			const v = Math.abs(sample);
			while (this.dequeHead !== this.dequeTail) {
				const backIdx = (this.dequeTail - 1 + dequeCap) % dequeCap;
				if (this.dequeVal[backIdx] <= v) this.dequeTail = backIdx;
				else break;
			}
			this.dequePos[this.dequeTail] = n;
			this.dequeVal[this.dequeTail] = v;
			this.dequeTail = (this.dequeTail + 1) % dequeCap;
			while (this.dequePos[this.dequeHead] <= n - delayLen) {
				this.dequeHead = (this.dequeHead + 1) % dequeCap;
			}
			const peak = this.dequeVal[this.dequeHead] || 0;
			const targetGain = peak > ceilingLinear ? ceilingLinear / peak : 1;
			if (targetGain < this.envelope) {
				this.envelope = attackCoef * this.envelope + (1 - attackCoef) * targetGain;
			} else {
				this.envelope = releaseCoef * this.envelope + (1 - releaseCoef) * targetGain;
			}
			const readPos = (this.delayWritePos + 1) % delayLen;
			output[i] = this.delayLine[readPos] * this.envelope;
			this.delayWritePos = readPos;
		}
		return output;
	}
}

class AudioPlaybackProcessor extends AudioWorkletProcessor {
	constructor(options) {
		super();
		const ringSab = options?.processorOptions?.ringSab;
		const clockSab = options?.processorOptions?.clockSab;
		const meterSab = options?.processorOptions?.meterSab;
		if (!ringSab || !clockSab) {
			this.initialized = false;
			return;
		}
		this.initialized = true;
		this.header = new Int32Array(ringSab, 0, RING_HEADER_INTS);
		this.channels = Math.max(1, Atomics.load(this.header, RING_CHANNELS));
		this.capacityFrames = Atomics.load(this.header, RING_CAPACITY) || 48_000;
		const pcmFloats = this.capacityFrames * this.channels;
		const pcmOffset = RING_HEADER_INTS * 4;
		this.pcm = new Float32Array(ringSab, pcmOffset, pcmFloats);
		const trackIdOffset = pcmOffset + pcmFloats * 4;
		this.trackIds = new Int32Array(ringSab, trackIdOffset, this.capacityFrames);
		this.trackPcm = new Float32Array(
			ringSab,
			trackIdOffset + this.capacityFrames * 4,
			this.capacityFrames * this.channels * MAX_AUDIO_RING_TRACKS
		);
		this.clock = new Float64Array(clockSab);
		this.meters = meterSab ? new Float32Array(meterSab) : null;
		this.generation = -1;
		this.timelineAnchor = 0;
		this.framesConsumed = 0;
		this.masterGain = 1;
		this.rnnoiseModule = null;
		this.rnnoiseLoading = false;
		this.rnnoiseByTrack = new Map();
		this.trackDenoiserGain = new Map();
		this.gate = new WorkletGate();
		this.limiter = new WorkletLimiter();
		// Per-quantum scratch buffers. Grown on demand and reused across process()
		// calls so the real-time audio thread does not allocate per render quantum
		// (which can trigger GC and cause audible dropouts).
		this.scratchInterleaved = new Float32Array(0);
		this.scratchDeltas = new Float32Array(0);
		this.port.onmessage = (event) => {
			if (event.data?.type === 'seek') {
				this.timelineAnchor = event.data.time;
				this.framesConsumed = 0;
				this.resetDenoisers();
			}
			if (event.data?.type === 'master-gain') {
				const gain = event.data.gain;
				this.masterGain = Number.isFinite(gain) ? Math.max(0, gain) : 1;
			}
			if (event.data?.type === 'voice-cleanup-wasm') {
				void this.loadRnnoise(event.data.bytes ?? event.data.b64);
			}
			if (event.data?.type === 'voice-cleanup-disable') {
				this.resetDenoisers();
			}
		};
	}

	async loadRnnoise(payload) {
		// Already loaded: re-post ready so a UI that reset its status (e.g. after
		// the user disabled all denoised tracks then re-enabled one) leaves the
		// "Loading RNNoise WASM…" state. Without this the panel can stick at
		// loading even though the module is usable.
		if (this.rnnoiseModule) {
			this.port.postMessage({ type: 'voice-cleanup-wasm-ready' });
			return;
		}
		if (this.rnnoiseLoading) {
			return;
		}
		this.rnnoiseLoading = true;
		try {
			const wasmBytes =
				typeof payload === 'string' ? decodeBase64Wasm(payload) : new Uint8Array(payload ?? []);
			if (wasmBytes.byteLength === 0) {
				throw new Error('RNNoise WASM payload is empty');
			}
			let memory = null;
			const imports = {
				a: {
					a: (requestedBytes) => {
						if (!memory) return 0;
						const needed = Math.ceil(
							Math.max(0, requestedBytes - memory.buffer.byteLength) / 65536
						);
						if (needed > 0) memory.grow(needed);
						return 1;
					},
					b: (dest, src, num) => {
						if (!memory) return dest;
						new Uint8Array(memory.buffer).copyWithin(dest, src, src + num);
						return dest;
					}
				}
			};
			const instanceResult = await WebAssembly.instantiate(wasmBytes, imports);
			const instance = instanceResult.instance;
			const exports = instance.exports;
			memory = exports.c;
			const constructors = exports.d;
			if (typeof constructors === 'function') constructors();
			this.rnnoiseModule = {
				memory,
				create: exports.f,
				malloc: exports.g,
				destroy: exports.h,
				free: exports.i,
				processFrame: exports.j
			};
			this.port.postMessage({ type: 'voice-cleanup-wasm-ready' });
		} catch (error) {
			this.port.postMessage({
				type: 'voice-cleanup-wasm-error',
				message: error instanceof Error ? error.message : String(error)
			});
		} finally {
			this.rnnoiseLoading = false;
		}
	}

	resetDenoisers() {
		for (const ring of this.rnnoiseByTrack.values()) ring.destroy();
		this.rnnoiseByTrack.clear();
		this.trackDenoiserGain.clear();
	}

	isDenoiserEnabledForTrack(trackIndex) {
		if (!this.rnnoiseModule || !this.meters || trackIndex < 0 || trackIndex >= 32) return false;
		const mask =
			trackIndex < 16
				? Math.round(this.meters[DENOISER_BYPASS_TRACKS_0_15] ?? 0)
				: Math.round(this.meters[DENOISER_BYPASS_TRACKS_16_31] ?? 0);
		return (mask & (1 << (trackIndex % 16))) !== 0;
	}

	ringForTrack(trackIndex) {
		let ring = this.rnnoiseByTrack.get(trackIndex);
		if (!ring && this.rnnoiseModule) {
			ring = new WorkletRnnoiseRing(this.rnnoiseModule);
			this.rnnoiseByTrack.set(trackIndex, ring);
		}
		return ring ?? null;
	}

	denoiseFrame(trackIndex, dryMono) {
		const enabled = this.isDenoiserEnabledForTrack(trackIndex);
		let gain = this.trackDenoiserGain.get(trackIndex) ?? (enabled ? 1 : 0);
		const target = enabled ? 1 : 0;
		if (gain !== target) {
			const step = 1 / DENOISER_CROSSFADE_FRAMES;
			gain = target > gain ? Math.min(target, gain + step) : Math.max(target, gain - step);
			this.trackDenoiserGain.set(trackIndex, gain);
		}
		if (!enabled && gain <= 0) return dryMono;
		const ring = this.ringForTrack(trackIndex);
		if (!ring) return dryMono;
		const denoised = ring.pushSample(dryMono);
		return dryMono * (1 - gain) + denoised * gain;
	}

	readGateParams() {
		const sab = this.meters;
		return {
			bypass: !sab || (sab[CHAIN_GATE_BYPASS] ?? 1) >= 0.5,
			thresholdDb: sab?.[CHAIN_GATE_THRESHOLD] ?? -40,
			rangeDb: sab?.[CHAIN_GATE_RANGE] ?? -80,
			attackMs: sab?.[CHAIN_GATE_ATTACK] ?? 0.1,
			holdMs: sab?.[CHAIN_GATE_HOLD] ?? 20,
			releaseMs: sab?.[CHAIN_GATE_RELEASE] ?? 50
		};
	}

	readLimiterParams() {
		const sab = this.meters;
		return {
			bypass: !sab || (sab[CHAIN_LIMITER_BYPASS] ?? 1) >= 0.5,
			ceilingDb: sab?.[CHAIN_LIMITER_CEILING] ?? -1,
			attackUs: sab?.[CHAIN_LIMITER_ATTACK] ?? 100,
			releaseMs: sab?.[CHAIN_LIMITER_RELEASE] ?? 50
		};
	}

	applyVoiceCleanupInserts(interleaved, rate) {
		let processed = this.gate.process(interleaved, this.readGateParams(), rate);
		const gainDb = this.meters?.[VOICE_CLEANUP_NORMALISE_GAIN_DB] ?? 0;
		if (Number.isFinite(gainDb) && gainDb !== 0) {
			const gain = Math.pow(10, gainDb / 20);
			for (let i = 0; i < processed.length; i += 1) {
				processed[i] = Math.max(-1, Math.min(1, (processed[i] ?? 0) * gain));
			}
		}
		processed = this.limiter.process(processed, this.readLimiterParams(), rate);
		return processed;
	}

	syncGeneration() {
		if (!this.initialized) return;
		const gen = Atomics.load(this.header, RING_GENERATION);
		if (gen === this.generation) return;
		this.generation = gen;
		this.framesConsumed = 0;
		this.timelineAnchor = this.clock[CLOCK_AUDIO];
		Atomics.store(this.header, RING_READ, 0);
	}

	process(_inputs, outputs) {
		if (!this.initialized) return false;
		this.syncGeneration();
		const output = outputs[0];
		if (!output || output.length === 0) return true;

		const state = Atomics.load(this.header, RING_STATE);
		if (state !== 1) {
			return true;
		}

		const outChannels = output.length;
		const frames = output[0]?.length ?? 0;
		const write = Atomics.load(this.header, RING_WRITE);
		let read = Atomics.load(this.header, RING_READ);
		const rate = Atomics.load(this.header, RING_SAMPLE_RATE) || sampleRate;
		let peakL = 0;
		let peakR = 0;
		let sumSqL = 0;
		let sumSqR = 0;
		const interleavedLen = frames * outChannels;
		if (this.scratchInterleaved.length < interleavedLen) {
			this.scratchInterleaved = new Float32Array(interleavedLen);
		}
		const interleaved = this.scratchInterleaved;
		if (this.scratchDeltas.length < outChannels) {
			this.scratchDeltas = new Float32Array(outChannels);
		}
		const deltas = this.scratchDeltas;

		for (let frame = 0; frame < frames; frame += 1) {
			if (((write - read) | 0) <= 0) {
				for (let ch = 0; ch < outChannels; ch += 1) {
					output[ch][frame] = 0;
					interleaved[frame * outChannels + ch] = 0;
				}
				continue;
			}
			const ringFrame = ((read % this.capacityFrames) + this.capacityFrames) % this.capacityFrames;
			const src = ringFrame * this.channels;
			const trackIndex = Atomics.load(this.trackIds, ringFrame);
			for (let ch = 0; ch < outChannels; ch += 1) deltas[ch] = 0;
			for (
				let denoiseTrackIndex = 0;
				denoiseTrackIndex < MAX_AUDIO_RING_TRACKS;
				denoiseTrackIndex += 1
			) {
				if (!this.isDenoiserEnabledForTrack(denoiseTrackIndex)) continue;
				const stemBase =
					ringFrame * MAX_AUDIO_RING_TRACKS * this.channels + denoiseTrackIndex * this.channels;
				let dryMono = 0;
				let absSum = 0;
				for (let ch = 0; ch < this.channels; ch += 1) {
					const stemSample = this.trackPcm[stemBase + ch] ?? 0;
					dryMono += stemSample;
					absSum += Math.abs(stemSample);
				}
				if (absSum <= 1e-9) continue;
				dryMono /= this.channels;
				const denoisedMono = this.denoiseFrame(denoiseTrackIndex, dryMono);
				for (let ch = 0; ch < outChannels; ch += 1) {
					const srcCh = Math.min(ch, this.channels - 1);
					const stemSample = this.trackPcm[stemBase + srcCh] ?? 0;
					const ratio = Math.abs(dryMono) > 1e-9 ? stemSample / dryMono : stemSample / absSum;
					deltas[ch] += denoisedMono * ratio - stemSample;
				}
			}
			if (trackIndex >= 0 && !this.trackPcm) {
				// Legacy ring layout fallback; current ring uses per-track stems.
				let dryMono = 0;
				for (let ch = 0; ch < this.channels; ch += 1) dryMono += this.pcm[src + ch] ?? 0;
				dryMono /= this.channels;
				const denoisedMono = this.denoiseFrame(trackIndex, dryMono);
				for (let ch = 0; ch < outChannels; ch += 1) deltas[ch] += denoisedMono - dryMono;
			}
			for (let ch = 0; ch < outChannels; ch += 1) {
				const srcCh = Math.min(ch, this.channels - 1);
				const sample = ((this.pcm[src + srcCh] ?? 0) + (deltas[ch] ?? 0)) * this.masterGain;
				interleaved[frame * outChannels + ch] = sample;
			}
			read += 1;
			this.framesConsumed += 1;
		}

		const processed = this.applyVoiceCleanupInserts(interleaved, rate);
		for (let frame = 0; frame < frames; frame += 1) {
			for (let ch = 0; ch < outChannels; ch += 1) {
				const sample = processed[frame * outChannels + ch] ?? 0;
				output[ch][frame] = sample;
				const abs = Math.abs(sample);
				if (ch === 0) {
					peakL = Math.max(peakL, abs);
					sumSqL += sample * sample;
				} else if (ch === 1) {
					peakR = Math.max(peakR, abs);
					sumSqR += sample * sample;
				}
			}
		}

		if (this.meters && frames > 0) {
			this.meters[METER_PEAK_L] = peakL;
			this.meters[METER_PEAK_R] = outChannels > 1 ? peakR : peakL;
			this.meters[METER_RMS_L] = Math.sqrt(sumSqL / frames);
			this.meters[METER_RMS_R] =
				outChannels > 1 ? Math.sqrt(sumSqR / frames) : this.meters[METER_RMS_L];
		}

		Atomics.store(this.header, RING_READ, read);
		const seconds = this.timelineAnchor + this.framesConsumed / rate;
		this.clock[CLOCK_AUDIO] = seconds;
		this.clock[0] = seconds;
		return true;
	}
}

registerProcessor('audio-playback', AudioPlaybackProcessor);
