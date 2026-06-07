/** Main-thread Web Audio graph: worklet playback (Phase 5). */

import {
  initAudioRing,
  RingHeader,
  RingState,
  bumpRingGeneration,
  resetRingPointers,
  type AudioRingViews,
} from '../engine/audio-ring';
import { AUDIO_RING_BYTES } from '../engine/audio-ring';
import { ClockIndex, METER_BUFFER_BYTES } from '../protocol';

const WORKLET_URL = `${import.meta.env.BASE_URL}audio-playback.worklet.js`;

export class AudioEngine {
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private masterGainValue = 1;
  private ringSab: SharedArrayBuffer | null = null;
  private meterSab: SharedArrayBuffer | null = null;
  private ring: AudioRingViews | null = null;
  private clockView: Float64Array | null = null;
  private ready: Promise<{ audioSab: SharedArrayBuffer | null; meterSab: SharedArrayBuffer | null }> | null = null;

  async init(
    clockSab: SharedArrayBuffer,
    sampleRate = 48_000,
    channels = 2,
  ): Promise<{ audioSab: SharedArrayBuffer | null; meterSab: SharedArrayBuffer | null }> {
    if (this.ready) return this.ready;
    this.ready = this.setup(clockSab, sampleRate, channels);
    return this.ready;
  }

  getMeterSab(): SharedArrayBuffer | null {
    return this.meterSab;
  }

  setMasterGain(gain: number): void {
    const value = Number.isFinite(gain) ? Math.max(0, gain) : 1;
    this.masterGainValue = value;
    this.worklet?.port.postMessage({ type: 'master-gain', gain: value });
  }

  private async setup(
    clockSab: SharedArrayBuffer,
    sampleRate: number,
    channels: number,
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
          meterSab: this.meterSab,
        },
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
    if (this.context.state === 'suspended') await this.context.resume();
    bumpRingGeneration(this.ring);
    resetRingPointers(this.ring);
    Atomics.store(this.ring.header, RingHeader.STATE, RingState.PLAYING);
    this.worklet.port.postMessage({ type: 'seek', time: fromSeconds });
    // Phase 5 audio master clock: the audio worklet (audio thread) is the
    // authoritative AUDIO_CLOCK writer. We prime the anchor here so the worklet's
    // generation-sync (which reads clock[AUDIO_CLOCK] as its anchor) wins the race
    // if process() observes the bumped generation before the postMessage 'seek'
    // arrives. This is the established audio-clock priming, distinct from the
    // pipeline-worker transport clock the UI never writes.
    if (this.clockView) {
      this.clockView[ClockIndex.AUDIO_CLOCK] = fromSeconds;
      this.clockView[ClockIndex.CURRENT_TIME] = fromSeconds;
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
    if (this.clockView) {
      this.clockView[ClockIndex.AUDIO_CLOCK] = time;
      this.clockView[ClockIndex.CURRENT_TIME] = time;
    }
    if (Atomics.load(this.ring.header, RingHeader.STATE) === RingState.PLAYING) {
      if (this.context?.state === 'suspended') await this.context.resume();
    }
  }

  dispose(): void {
    if (this.ring) Atomics.store(this.ring.header, RingHeader.STATE, RingState.IDLE);
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
