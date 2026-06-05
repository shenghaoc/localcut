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
import { ClockIndex } from '../protocol';

const WORKLET_URL = '/audio-playback.worklet.js';

export class AudioEngine {
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private masterGain: GainNode | null = null;
  private ringSab: SharedArrayBuffer | null = null;
  private ring: AudioRingViews | null = null;
  private clockView: Float64Array | null = null;
  private ready: Promise<SharedArrayBuffer | null> | null = null;

  async init(clockSab: SharedArrayBuffer, sampleRate = 48_000, channels = 2): Promise<SharedArrayBuffer | null> {
    if (this.ready) return this.ready;
    this.ready = this.setup(clockSab, sampleRate, channels);
    return this.ready;
  }

  private async setup(clockSab: SharedArrayBuffer, sampleRate: number, channels: number): Promise<SharedArrayBuffer | null> {
    this.clockView = new Float64Array(clockSab);
    this.ringSab = new SharedArrayBuffer(AUDIO_RING_BYTES);
    this.ring = initAudioRing(this.ringSab, sampleRate, channels);

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
        },
      });

      this.masterGain = this.context.createGain();
      this.worklet.connect(this.masterGain);
      this.masterGain.connect(this.context.destination);
      return this.ringSab;
    } catch (error) {
      this.dispose();
      this.ready = null;
      throw error;
    }
  }

  getRingBuffer(): SharedArrayBuffer | null {
    return this.ringSab;
  }

  async play(fromSeconds: number): Promise<void> {
    if (!this.context || !this.ring || !this.worklet) return;
    if (this.context.state === 'suspended') await this.context.resume();
    bumpRingGeneration(this.ring);
    resetRingPointers(this.ring);
    Atomics.store(this.ring.header, RingHeader.STATE, RingState.PLAYING);
    this.worklet.port.postMessage({ type: 'seek', time: fromSeconds });
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
    this.masterGain?.disconnect();
    void this.context?.close();
    this.context = null;
    this.worklet = null;
    this.masterGain = null;
    this.ring = null;
    this.ringSab = null;
    this.clockView = null;
    this.ready = null;
  }
}
