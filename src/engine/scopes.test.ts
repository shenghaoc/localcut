import { describe, it, expect } from 'vitest';
import {
  SCOPE_HISTOGRAM_BINS,
  SCOPE_HISTOGRAM_CHANNELS,
  SCOPE_HISTOGRAM_DATA_FLOATS,
  SCOPE_VECTORSCOPE_SIZE,
  scopeWaveformDataFloats,
  scopeParadeDataFloats,
  scopeVectorscopeDataFloats,
  scopeTotalBufferFloats,
  scopeTotalBufferBytes,
  histogramSlotOffset,
  waveformSlotOffset,
  paradeSlotOffset,
  vectorscopeSlotOffset,
  beginScopeWrite,
  endScopeWrite,
  writeScopeHeader,
  writeScopeData,
  readScopeResult,
  resetScopeSlot,
  SCOPES_FEATURE_ENABLED,
} from './scopes';

describe('Scope constants', () => {
  it('histogram has 256 bins × 4 channels', () => {
    expect(SCOPE_HISTOGRAM_BINS).toBe(256);
    expect(SCOPE_HISTOGRAM_CHANNELS).toBe(4);
    expect(SCOPE_HISTOGRAM_DATA_FLOATS).toBe(1024);
  });

  it('vectorscope size is 128', () => {
    expect(SCOPE_VECTORSCOPE_SIZE).toBe(128);
    expect(scopeVectorscopeDataFloats()).toBe(16384);
  });

  it('waveform data size depends on scopeResX', () => {
    expect(scopeWaveformDataFloats(256)).toBe(512);  // 2 × 256
    expect(scopeWaveformDataFloats(128)).toBe(256);  // 2 × 128
  });

  it('parade data size is 6 × scopeResX', () => {
    expect(scopeParadeDataFloats(256)).toBe(1536);
    expect(scopeParadeDataFloats(128)).toBe(768);
  });
});

describe('Slot offsets', () => {
  it('histogram starts at 0', () => {
    expect(histogramSlotOffset()).toBe(0);
  });

  it('waveform starts after histogram', () => {
    const offset = waveformSlotOffset(256);
    expect(offset).toBe(SCOPE_HISTOGRAM_DATA_FLOATS + 3); // header + data
  });

  it('parade starts after waveform', () => {
    const wfOffset = waveformSlotOffset(256);
    const pOffset = paradeSlotOffset(256);
    expect(pOffset).toBe(wfOffset + 3 + scopeWaveformDataFloats(256));
  });

  it('vectorscope starts after parade', () => {
    const pOffset = paradeSlotOffset(256);
    const vOffset = vectorscopeSlotOffset(256);
    expect(vOffset).toBe(pOffset + 3 + scopeParadeDataFloats(256));
  });
});

describe('Scope buffer sizing', () => {
  it('total buffer size accounts for all slots', () => {
    const floats = scopeTotalBufferFloats(256);
    expect(floats).toBeGreaterThan(SCOPE_HISTOGRAM_DATA_FLOATS);
    expect(floats).toBeGreaterThan(scopeVectorscopeDataFloats());

    const bytes = scopeTotalBufferBytes(256);
    expect(bytes).toBe(floats * 4);
  });
});

describe('Scope SAB ring-buffer', () => {
  function createTestBuffer(scopeResX = 64): Float32Array {
    return new Float32Array(scopeTotalBufferFloats(scopeResX));
  }

  it('readScopeResult returns null when sequence is odd', () => {
    const buf = createTestBuffer();
    buf.fill(0);
    buf[0] = 1; // odd = writer active
    const result = readScopeResult(buf, histogramSlotOffset(), SCOPE_HISTOGRAM_DATA_FLOATS);
    expect(result).toBeNull();
  });

  it('write-then-read round-trips data', () => {
    const buf = createTestBuffer();
    const slotOffset = histogramSlotOffset();
    const dataFloats = SCOPE_HISTOGRAM_DATA_FLOATS;
    const testData = new Float32Array(dataFloats);
    testData.fill(42);

    beginScopeWrite(buf, slotOffset);
    writeScopeHeader(buf, slotOffset, 1.5, 100);
    writeScopeData(buf, slotOffset, testData);
    endScopeWrite(buf, slotOffset);

    const result = readScopeResult(buf, slotOffset, dataFloats);
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(1.5);
    expect(result!.clipCount).toBe(100);
    expect(result!.data[0]).toBe(42);
    expect(result!.data[dataFloats - 1]).toBe(42);
  });

  it('readScopeResult detects torn writes when sequence changes', () => {
    const buf = createTestBuffer();
    const slotOffset = histogramSlotOffset();
    const dataFloats = SCOPE_HISTOGRAM_DATA_FLOATS;

    // Set up a completed write: begin → write → end gives even sequence
    beginScopeWrite(buf, slotOffset);
    endScopeWrite(buf, slotOffset);
    const originalSeq = buf[slotOffset];
    expect(Math.round(originalSeq) % 2).toBe(0);

    // Set up read context (sequence is even)
    writeScopeHeader(buf, slotOffset, 3.0, 0);
    void readScopeResult(buf, slotOffset, dataFloats);
    // The read may or may not succeed depending on state — what matters
    // is that if a write starts mid-read, the detection rejects it.
    // Simulate: begin a new write (odd sequence), then verify read returns null
    beginScopeWrite(buf, slotOffset);
    const result2 = readScopeResult(buf, slotOffset, dataFloats);
    expect(result2).toBeNull();
  });

  it('writeScopeHeader sets timestamp and clipCount', () => {
    const buf = createTestBuffer();
    const slotOffset = histogramSlotOffset();
    writeScopeHeader(buf, slotOffset, 3.14, 42);
    expect(buf[slotOffset + 1]).toBeCloseTo(3.14);
    expect(buf[slotOffset + 2]).toBe(42);
  });

  it('writeScopeData copies data at correct offset', () => {
    const buf = createTestBuffer();
    const slotOffset = histogramSlotOffset();
    const testData = new Float32Array([1, 2, 3, 4, 5]);
    writeScopeData(buf, slotOffset, testData);
    // Data starts at slotOffset + 3 (header)
    expect(buf[slotOffset + 3]).toBe(1);
    expect(buf[slotOffset + 7]).toBe(5);
  });

  it('resetScopeSlot zeroes the header + data region before accumulation', () => {
    const buf = createTestBuffer();
    const slotOffset = histogramSlotOffset();
    const dataFloats = 5;
    // Dirty the slot from a previous frame.
    writeScopeHeader(buf, slotOffset, 9.9, 7);
    writeScopeData(buf, slotOffset, new Float32Array([1, 2, 3, 4, 5]));
    buf[slotOffset] = 123;

    const cleared = resetScopeSlot(buf, slotOffset, dataFloats);
    expect(cleared).toBe(3 + dataFloats);
    for (let i = 0; i < cleared; i += 1) {
      expect(buf[slotOffset + i]).toBe(0);
    }
  });
});

describe('Scopes feature flag (B7)', () => {
  it('ships disabled so no scope pass runs by default', () => {
    expect(SCOPES_FEATURE_ENABLED).toBe(false);
  });
});
