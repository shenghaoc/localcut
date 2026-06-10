/** Main-thread Web Audio graph: worklet playback (Phase 5). */

import {
	initAudioRing,
	RingHeader,
	RingState,
	bumpRingGeneration,
	resetRingPointers,
	type AudioRingViews
} from '../engine/audio-ring';
import { AUDIO_RING_BYTES } from '../engine/audio-ring';
import { ClockIndex, METER_BUFFER_BYTES } from '../protocol';

const WORKLET_URL = `${import.meta.env.BASE_URL}audio-playback.worklet.js`;

export class AudioEngine {
	private context: AudioContext | null = null;
	private worklet: AudioWorkletNode | null = null;
	private streamTap: MediaStreamAudioDestinationNode | null = null;
	private masterGainValue = 1;
	private ringSab: SharedArrayBuffer | null = null;
	private meterSab: SharedArrayBuffer | null = null;
	private ring: AudioRingViews | null = null;
	private clockView: Float64Array | null = null;
	private ready: Promise<{
		audioSab: SharedArrayBuffer | null;
		meterSab: SharedArrayBuffer | null;
	}> | null = null;

	async init(
		clockSab: SharedArrayBuffer,
		sampleRate = 48_000,
		channels = 2
	): Promise<{ audioSab: SharedArrayBuffer | null; meterSab: SharedArrayBuffer | null }> {
		if (this.ready) {
			try {
				return await this.ready;
			} catch {
				// Previous attempt failed — discard the cached rejection and re-init.
				this.ready = null;
			}
		}
		this.ready = this.setup(clockSab, sampleRate, channels);
		return this.ready;
	}

	getMeterSab(): SharedArrayBuffer | null {
		return this.meterSab;
	}

	/**
	 * Phase 47 (R4.4): master-bus tap for WHIP publish. The worklet applies the
	 * master gain internally, so its output IS the program-monitor mix; fanning
	 * it out to a `MediaStreamAudioDestinationNode` leaves the speaker path
	 * (worklet → destination) untouched. Returns null until the graph exists.
	 */
	createStreamTap(): MediaStreamTrack | null {
		if (!this.context || !this.worklet) return null;
		if (!this.streamTap) {
			this.streamTap = this.context.createMediaStreamDestination();
			this.worklet.connect(this.streamTap);
		}
		return this.streamTap.stream.getAudioTracks()[0] ?? null;
	}

	removeStreamTap(): void {
		if (!this.streamTap) return;
		try {
			this.worklet?.disconnect(this.streamTap);
		} catch {
			// The worklet may already be disconnected/disposed.
		}
		for (const track of this.streamTap.stream.getTracks()) track.stop();
		this.streamTap = null;
	}

	setMasterGain(gain: number): void {
		const value = Number.isFinite(gain) ? Math.max(0, gain) : 1;
		this.masterGainValue = value;
		this.worklet?.port.postMessage({ type: 'master-gain', gain: value });
	}

	private async setup(
		clockSab: SharedArrayBuffer,
		sampleRate: number,
		channels: number
	): Promise<{ audioSab: SharedArrayBuffer | null; meterSab: SharedArrayBuffer | null }> {
		this.clockView = new Float64Array(clockSab);
		this.ringSab = new SharedArrayBuffer(AUDIO_RING_BYTES);
		this.ring = initAudioRing(this.ringSab, sampleRate, channels);
		this.meterSab = new SharedArrayBuffer(METER_BUFFER_BYTES);

		try {
			this.context = new AudioContext({ sampleRate });
			await this.context.audioWorklet.addModule(WORKLET_URL);

			this.worklet = new AudioWorkletNode(this.context, 'audio-playback', {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [channels],
				processorOptions: {
					ringSab: this.ringSab,
					clockSab,
					meterSab: this.meterSab
				}
			});

			this.worklet.connect(this.context.destination);
			this.worklet.port.postMessage({ type: 'master-gain', gain: this.masterGainValue });
			return { audioSab: this.ringSab, meterSab: this.meterSab };
		} catch (error) {
			this.dispose();
			throw error;
		}
	}

	async play(fromSeconds: number): Promise<void> {
		if (!this.context || !this.ring || !this.worklet) return;
		if (this.context.state === 'suspended') {
			try {
				await this.context.resume();
			} catch (err) {
				console.error('AudioContext resume failed', err);
				return;
			}
		}
		bumpRingGeneration(this.ring);
		resetRingPointers(this.ring);
		Atomics.store(this.ring.header, RingHeader.STATE, RingState.PLAYING);
		this.worklet.port.postMessage({ type: 'seek', time: fromSeconds });
		// Prime ONLY the audio-clock anchor (index 3), never the transport clock
		// (CURRENT_TIME/index 0). The audio worklet (audio thread) reads AUDIO_CLOCK as
		// its generation-sync anchor and could otherwise race the postMessage 'seek';
		// the pipeline worker owns CURRENT_TIME. This keeps the main thread off the
		// transport clock entirely.
		if (this.clockView) {
			this.clockView[ClockIndex.AUDIO_CLOCK] = fromSeconds;
		}
	}

	pause(): void {
		if (!this.ring) return;
		Atomics.store(this.ring.header, RingHeader.STATE, RingState.PAUSED);
		void this.context?.suspend();
	}

	async seek(time: number): Promise<void> {
		if (!this.ring || !this.worklet) return;
		bumpRingGeneration(this.ring);
		resetRingPointers(this.ring);
		this.worklet.port.postMessage({ type: 'seek', time });
		// Anchor only (index 3); the pipeline worker owns CURRENT_TIME — on a paused
		// seek its writeTransport writes the playhead. See play() for the rationale.
		if (this.clockView) {
			this.clockView[ClockIndex.AUDIO_CLOCK] = time;
		}
		if (Atomics.load(this.ring.header, RingHeader.STATE) === RingState.PLAYING) {
			if (this.context?.state === 'suspended') await this.context.resume();
		}
	}

	dispose(): void {
		if (this.ring) Atomics.store(this.ring.header, RingHeader.STATE, RingState.IDLE);
		this.removeStreamTap();
		this.worklet?.disconnect();
		void this.context?.close();
		this.context = null;
		this.worklet = null;
		this.ring = null;
		this.ringSab = null;
		this.meterSab = null;
		this.clockView = null;
		this.ready = null;
	}
}
