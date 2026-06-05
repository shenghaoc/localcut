/** Main-thread Web Audio graph: worklet playback + per-track gain/mute/solo (Phase 5). */

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
import workletUrl from './audio-playback.worklet.ts?url';

export interface AudioTrackMix {
  trackId: string;
  gain: number;
  muted: boolean;
  solo: boolean;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private masterGain: GainNode | null = null;
  private readonly trackGains = new Map<string, GainNode>();
  private ringSab: SharedArrayBuffer | null = null;
  private ring: AudioRingViews | null = null;
  private clockView: Float64Array | null = null;
  private mixState = new Map<string, AudioTrackMix>();
  private soloTrackId: string | null = null;
  private ready: Promise<void> | null = null;

  async init(clockSab: SharedArrayBuffer, sampleRate = 48_000, channels = 2): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.setup(clockSab, sampleRate, channels);
    return this.ready;
  }

  private async setup(clockSab: SharedArrayBuffer, sampleRate: number, channels: number): Promise<void> {
    this.clockView = new Float64Array(clockSab);
    this.ringSab = new SharedArrayBuffer(AUDIO_RING_BYTES);
    this.ring = initAudioRing(this.ringSab, sampleRate, channels);

    this.context = new AudioContext({ sampleRate });
    await this.context.audioWorklet.addModule(workletUrl);

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
  }

  getRingBuffer(): SharedArrayBuffer | null {
    return this.ringSab;
  }

  syncTracks(tracks: AudioTrackMix[]): void {
    for (const track of tracks) {
      this.mixState.set(track.trackId, { ...track });
      this.ensureTrackGain(track.trackId);
    }
    this.applyMix();
  }

  private ensureTrackGain(trackId: string): GainNode {
    let node = this.trackGains.get(trackId);
    if (!node) {
      if (!this.context || !this.masterGain) throw new Error('AudioEngine not initialized');
      node = this.context.createGain();
      node.connect(this.masterGain);
      this.trackGains.set(trackId, node);
    }
    return node;
  }

  setTrackGain(trackId: string, gain: number): void {
    const mix = this.mixState.get(trackId) ?? { trackId, gain: 1, muted: false, solo: false };
    mix.gain = Math.max(0, gain);
    this.mixState.set(trackId, mix);
    this.applyMix();
  }

  setTrackMute(trackId: string, muted: boolean): void {
    const mix = this.mixState.get(trackId) ?? { trackId, gain: 1, muted: false, solo: false };
    mix.muted = muted;
    this.mixState.set(trackId, mix);
    this.applyMix();
  }

  setTrackSolo(trackId: string, solo: boolean): void {
    const mix = this.mixState.get(trackId) ?? { trackId, gain: 1, muted: false, solo: false };
    mix.solo = solo;
    this.mixState.set(trackId, mix);
    this.soloTrackId = solo ? trackId : this.soloTrackId === trackId ? null : this.soloTrackId;
    if (solo) {
      for (const [id, state] of this.mixState) {
        if (id !== trackId) state.solo = false;
      }
    }
    this.applyMix();
  }

  private applyMix(): void {
    const anySolo = [...this.mixState.values()].some((t) => t.solo);
    for (const [trackId, mix] of this.mixState) {
      const node = this.ensureTrackGain(trackId);
      const audible = !mix.muted && (!anySolo || mix.solo);
      node.gain.value = audible ? mix.gain : 0;
    }
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
    for (const node of this.trackGains.values()) node.disconnect();
    this.trackGains.clear();
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
