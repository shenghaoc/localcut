import { describe, expect, it } from 'vitest';
import { encodeWavPcm16 } from './wav';

function ascii(view: DataView, offset: number, length: number): string {
	let out = '';
	for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
	return out;
}

describe('encodeWavPcm16', () => {
	it('writes a valid mono 48 kHz PCM16 RIFF header', () => {
		const pcm = new Float32Array([0, 0.5, -0.5, 1, -1]);
		const wav = encodeWavPcm16(pcm, 48000, 1);
		const view = new DataView(wav);
		expect(ascii(view, 0, 4)).toBe('RIFF');
		expect(ascii(view, 8, 4)).toBe('WAVE');
		expect(ascii(view, 12, 4)).toBe('fmt ');
		expect(view.getUint16(20, true)).toBe(1); // PCM
		expect(view.getUint16(22, true)).toBe(1); // channels
		expect(view.getUint32(24, true)).toBe(48000);
		expect(ascii(view, 36, 4)).toBe('data');
		expect(view.getUint32(40, true)).toBe(pcm.length * 2);
		expect(wav.byteLength).toBe(44 + pcm.length * 2);
	});

	it('round-trips samples within 16-bit quantization and clamps overs', () => {
		const pcm = new Float32Array([0, 0.25, -0.25, 1.5, -1.5]);
		const wav = encodeWavPcm16(pcm, 48000, 1);
		const samples = new Int16Array(wav, 44);
		expect(samples[0]).toBe(0);
		expect(samples[1]).toBe(Math.round(0.25 * 32767));
		expect(samples[2]).toBe(Math.round(-0.25 * 32768));
		expect(samples[3]).toBe(32767); // clamped
		expect(samples[4]).toBe(-32768); // clamped
	});

	it('rejects invalid rates and channel counts', () => {
		expect(() => encodeWavPcm16(new Float32Array(1), 0, 1)).toThrow();
		expect(() => encodeWavPcm16(new Float32Array(1), 48000, 0)).toThrow();
	});
});
