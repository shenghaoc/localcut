/// <reference lib="webworker" />

/**
 * Pulls interleaved PCM from the shared ring buffer and writes the authoritative
 * audio clock into the transport SAB (index 3).
 */

const RING_WRITE = 0;
const RING_READ = 1;
const RING_SAMPLE_RATE = 2;
const RING_CHANNELS = 3;
const RING_CAPACITY = 4;
const RING_GENERATION = 5;
const RING_STATE = 6;
const RING_HEADER_INTS = 8;

const CLOCK_AUDIO = 3;

class AudioPlaybackProcessor extends AudioWorkletProcessor {
  private header: Int32Array;
  private pcm: Float32Array;
  private clock: Float64Array;
  private capacityFrames: number;
  private channels: number;
  private generation = -1;
  private timelineAnchor = 0;
  private framesConsumed = 0;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const ringSab = options.processorOptions?.ringSab as SharedArrayBuffer;
    const clockSab = options.processorOptions?.clockSab as SharedArrayBuffer;
    this.header = new Int32Array(ringSab, 0, RING_HEADER_INTS);
    this.channels = Math.max(1, Atomics.load(this.header, RING_CHANNELS));
    this.capacityFrames = Atomics.load(this.header, RING_CAPACITY) || 48_000;
    const pcmFloats = this.capacityFrames * this.channels;
    this.pcm = new Float32Array(ringSab, RING_HEADER_INTS * 4, pcmFloats);
    this.clock = new Float64Array(clockSab);
    this.port.onmessage = (event: MessageEvent<{ type: 'seek'; time: number }>) => {
      if (event.data?.type === 'seek') {
        this.timelineAnchor = event.data.time;
        this.framesConsumed = 0;
      }
    };
  }

  private syncGeneration(): void {
    const gen = Atomics.load(this.header, RING_GENERATION);
    if (gen === this.generation) return;
    this.generation = gen;
    this.framesConsumed = 0;
    this.timelineAnchor = this.clock[CLOCK_AUDIO];
    Atomics.store(this.header, RING_READ, 0);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
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
    const available = (write - read) | 0;
    const rate = Atomics.load(this.header, RING_SAMPLE_RATE) || sampleRate;

    for (let frame = 0; frame < frames; frame += 1) {
      if (((write - read) | 0) <= 0) {
        for (let ch = 0; ch < outChannels; ch += 1) output[ch]![frame] = 0;
        continue;
      }
      const ringFrame = ((read % this.capacityFrames) + this.capacityFrames) % this.capacityFrames;
      const src = ringFrame * this.channels;
      for (let ch = 0; ch < outChannels; ch += 1) {
        const srcCh = Math.min(ch, this.channels - 1);
        output[ch]![frame] = this.pcm[src + srcCh] ?? 0;
      }
      read += 1;
      this.framesConsumed += 1;
    }

    Atomics.store(this.header, RING_READ, read);
    const seconds = this.timelineAnchor + this.framesConsumed / rate;
    this.clock[CLOCK_AUDIO] = seconds;
    this.clock[0] = seconds;
    return true;
  }
}

registerProcessor('audio-playback', AudioPlaybackProcessor);
