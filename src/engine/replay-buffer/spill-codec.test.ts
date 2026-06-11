import { describe, expect, it } from 'vite-plus/test';
import { decodeSpillBuffer, encodeSpillBuffer } from './spill';
import type { RingBufferEntry } from './ring-buffer';
import type { SpillRange } from '../../protocol';

function range(entries: RingBufferEntry[]): SpillRange {
	const last = entries[entries.length - 1];
	return {
		startTimestamp: entries[0]?.timestamp ?? 0,
		endTimestamp: last ? last.timestamp + last.duration : 0,
		opfsFileName: 'replay-spill-test.bin',
		byteCount: entries.reduce((sum, e) => sum + e.byteSize, 0),
		entryCount: entries.length,
		hasKeyframe: entries.some((e) => e.isKeyframe)
	};
}

describe('spill binary codec', () => {
	it('round-trips entries with their chunk bytes intact', () => {
		const entries: RingBufferEntry[] = [
			{
				type: 'video',
				timestamp: 12.345,
				duration: 1 / 30,
				byteSize: 5,
				isKeyframe: true,
				data: new Uint8Array([10, 20, 30, 40, 50])
			},
			{
				type: 'audio',
				timestamp: 12.351,
				duration: 0.021,
				byteSize: 3,
				isKeyframe: false,
				data: new Uint8Array([7, 8, 9])
			},
			{
				type: 'video',
				timestamp: 12.378,
				duration: 1 / 30,
				byteSize: 0,
				isKeyframe: false,
				data: new Uint8Array(0)
			}
		];
		const decoded = decodeSpillBuffer(encodeSpillBuffer(entries, range(entries)));
		expect(decoded).toHaveLength(3);
		decoded.forEach((entry, i) => {
			expect(entry.type).toBe(entries[i].type);
			expect(entry.timestamp).toBeCloseTo(entries[i].timestamp, 9);
			expect(entry.duration).toBeCloseTo(entries[i].duration, 9);
			expect(entry.isKeyframe).toBe(entries[i].isKeyframe);
			expect(entry.byteSize).toBe(entries[i].data.byteLength);
			expect([...entry.data]).toEqual([...entries[i].data]);
		});
	});

	it('round-trips an empty entry list', () => {
		expect(decodeSpillBuffer(encodeSpillBuffer([], range([])))).toEqual([]);
	});

	it('survives large payloads without truncation', () => {
		const data = new Uint8Array(64 * 1024);
		for (let i = 0; i < data.length; i++) data[i] = i % 251;
		const entries: RingBufferEntry[] = [
			{ type: 'video', timestamp: 0, duration: 0.04, byteSize: data.length, isKeyframe: true, data }
		];
		const decoded = decodeSpillBuffer(encodeSpillBuffer(entries, range(entries)));
		expect(decoded[0].data.byteLength).toBe(data.length);
		expect(decoded[0].data[63 * 1024]).toBe((63 * 1024) % 251);
	});
});
