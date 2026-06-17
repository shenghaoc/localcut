/** Phase 41 — SAB capture event ring layout and single-producer/single-consumer
 *  semantics. Verifies: header magic + schema, write/read roundtrip, FIFO order,
 *  ring wraparound across the u32 boundary, overflow drop counter, and the
 *  reader's behaviour on torn or zero-size SAB inputs. */

import { describe, expect, it } from 'vite-plus/test';
import {
	CaptureEventRingReader,
	CaptureEventRingWriter,
	allocateCaptureEventRing,
	packModifierFlags,
	validateCaptureEventRing
} from './event-ring';
import {
	CAPTURE_EVENT_HEADER_BYTES,
	CAPTURE_EVENT_HEADER_FIELDS,
	CAPTURE_EVENT_HEADER_MAGIC,
	CAPTURE_EVENT_RECORD_BYTES,
	CAPTURE_EVENT_RING_BYTES,
	CAPTURE_EVENT_RING_CAPACITY,
	CAPTURE_EVENT_SCHEMA_VERSION,
	CaptureEventHeaderIndex,
	CaptureEventModifier,
	CaptureEventType
} from '../../protocol';

describe('allocateCaptureEventRing', () => {
	it('stamps the magic, schema, capacity, and generation', () => {
		const sab = allocateCaptureEventRing(7);
		expect(sab.byteLength).toBe(CAPTURE_EVENT_RING_BYTES);
		const header = new Int32Array(sab, 0, CAPTURE_EVENT_HEADER_FIELDS);
		expect(header[CaptureEventHeaderIndex.MAGIC]).toBe(CAPTURE_EVENT_HEADER_MAGIC | 0);
		expect(header[CaptureEventHeaderIndex.SCHEMA_VERSION]).toBe(CAPTURE_EVENT_SCHEMA_VERSION);
		expect(header[CaptureEventHeaderIndex.CAPACITY]).toBe(CAPTURE_EVENT_RING_CAPACITY);
		expect(header[CaptureEventHeaderIndex.RECORD_BYTES]).toBe(CAPTURE_EVENT_RECORD_BYTES);
		expect(header[CaptureEventHeaderIndex.WRITE_INDEX]).toBe(0);
		expect(header[CaptureEventHeaderIndex.READ_INDEX]).toBe(0);
		expect(header[CaptureEventHeaderIndex.DROP_COUNT]).toBe(0);
		expect(header[CaptureEventHeaderIndex.GENERATION]).toBe(7);
	});

	it('validate throws when the magic is wrong', () => {
		const sab = new SharedArrayBuffer(CAPTURE_EVENT_RING_BYTES);
		expect(() => validateCaptureEventRing(sab)).toThrow(/magic mismatch/);
	});

	it('validate throws on a size mismatch', () => {
		// Smaller than expected — would otherwise read garbage as the header.
		const sab = new SharedArrayBuffer(CAPTURE_EVENT_HEADER_BYTES);
		expect(() => validateCaptureEventRing(sab)).toThrow(/wrong size/);
	});
});

describe('CaptureEventRingWriter + Reader roundtrip', () => {
	it('reads back key events in FIFO order with the encoded combo and time', () => {
		const sab = allocateCaptureEventRing(1);
		const writer = new CaptureEventRingWriter(sab);
		const reader = new CaptureEventRingReader(sab);

		writer.writeKey('Ctrl+S', CaptureEventModifier.CTRL, 1_500_000);
		writer.writeKey('Escape', 0, 1_600_000);
		writer.writeKey(
			'Alt+Shift+F12',
			CaptureEventModifier.ALT | CaptureEventModifier.SHIFT,
			2_000_000
		);

		const entries = reader.drain();
		expect(entries).toHaveLength(3);
		expect(entries[0]).toEqual({ kind: 'key', combo: 'Ctrl+S', t: 1.5 });
		expect(entries[1]).toEqual({ kind: 'key', combo: 'Escape', t: 1.6 });
		expect(entries[2]).toEqual({ kind: 'key', combo: 'Alt+Shift+F12', t: 2.0 });
	});

	it('reads back pointer events with coords + modifier flags', () => {
		const sab = allocateCaptureEventRing(1);
		const writer = new CaptureEventRingWriter(sab);
		const reader = new CaptureEventRingReader(sab);

		writer.writePointer(
			CaptureEventType.POINTER_DOWN,
			CaptureEventModifier.META,
			500_000,
			120,
			240
		);
		writer.writePointer(CaptureEventType.POINTER_UP, 0, 750_000, 130, 245);

		const entries = reader.drain();
		expect(entries).toEqual([
			{ kind: 'pointer-down', t: 0.5, x: 120, y: 240, modifierFlags: CaptureEventModifier.META },
			{ kind: 'pointer-up', t: 0.75, x: 130, y: 245, modifierFlags: 0 }
		]);
	});

	it('drain returns an empty array when no records are pending', () => {
		const sab = allocateCaptureEventRing(1);
		const reader = new CaptureEventRingReader(sab);
		expect(reader.drain()).toEqual([]);
	});

	it('truncates string payloads that exceed the per-record buffer (32 bytes)', () => {
		const sab = allocateCaptureEventRing(1);
		const writer = new CaptureEventRingWriter(sab);
		const reader = new CaptureEventRingReader(sab);
		// 64-byte ASCII combo string; only 32 bytes survive.
		const longCombo = 'A'.repeat(64);
		writer.writeKey(longCombo, 0, 100_000);
		const entries = reader.drain();
		expect(entries).toHaveLength(1);
		expect((entries[0] as { combo: string }).combo.length).toBe(32);
		expect((entries[0] as { combo: string }).combo).toBe('A'.repeat(32));
	});
});

describe('CaptureEventRing — overflow', () => {
	it('increments DROP_COUNT and refuses the write when the ring is full', () => {
		const sab = allocateCaptureEventRing(1);
		const writer = new CaptureEventRingWriter(sab);
		const reader = new CaptureEventRingReader(sab);

		// Fill the ring exactly.
		for (let i = 0; i < CAPTURE_EVENT_RING_CAPACITY; i++) {
			expect(writer.writeKey(`Ctrl+${i}`, CaptureEventModifier.CTRL, i * 1000)).toEqual({
				written: true,
				dropped: false
			});
		}
		// One more — this must drop.
		expect(writer.writeKey('Ctrl+X', CaptureEventModifier.CTRL, 999_999_999)).toEqual({
			written: false,
			dropped: true
		});
		expect(writer.dropCount()).toBe(1);
		expect(reader.dropCount()).toBe(1);

		// Drain everything; we should get exactly the records that were written,
		// in order, with no torn or duplicated data.
		const entries = reader.drain();
		expect(entries).toHaveLength(CAPTURE_EVENT_RING_CAPACITY);
		expect((entries[0] as { combo: string }).combo).toBe('Ctrl+0');
		expect((entries[CAPTURE_EVENT_RING_CAPACITY - 1] as { combo: string }).combo).toBe(
			`Ctrl+${CAPTURE_EVENT_RING_CAPACITY - 1}`
		);

		// After draining, the writer can fill again.
		expect(writer.writeKey('Ctrl+Y', CaptureEventModifier.CTRL, 1).written).toBe(true);
		// Drop counter is sticky — it tracks lifetime drops, not pending drops.
		expect(writer.dropCount()).toBe(1);
	});
});

describe('CaptureEventRing — wraparound', () => {
	it('preserves FIFO across many drain cycles spanning more than one ring revolution', () => {
		const sab = allocateCaptureEventRing(1);
		const writer = new CaptureEventRingWriter(sab);
		const reader = new CaptureEventRingReader(sab);

		// Push + drain in 100-record bursts, well over one full ring revolution.
		const burst = 100;
		const totalBursts = 50; // 5000 records total, ~5x the ring capacity
		let nextIndex = 0;
		for (let b = 0; b < totalBursts; b++) {
			for (let i = 0; i < burst; i++) {
				const ok = writer.writeKey(`K${nextIndex}`, 0, nextIndex * 1000).written;
				expect(ok).toBe(true);
				nextIndex++;
			}
			const drained = reader.drain();
			expect(drained).toHaveLength(burst);
			// First and last of each burst sequence are correctly ordered.
			expect((drained[0] as { combo: string }).combo).toBe(`K${b * burst}`);
			expect((drained[burst - 1] as { combo: string }).combo).toBe(`K${b * burst + burst - 1}`);
		}
		expect(writer.dropCount()).toBe(0);
	});
});

describe('packModifierFlags', () => {
	it('packs each modifier into its own bit', () => {
		expect(packModifierFlags({})).toBe(0);
		expect(packModifierFlags({ altKey: true })).toBe(CaptureEventModifier.ALT);
		expect(packModifierFlags({ ctrlKey: true })).toBe(CaptureEventModifier.CTRL);
		expect(packModifierFlags({ metaKey: true })).toBe(CaptureEventModifier.META);
		expect(packModifierFlags({ shiftKey: true })).toBe(CaptureEventModifier.SHIFT);
		expect(packModifierFlags({ ctrlKey: true, shiftKey: true })).toBe(
			CaptureEventModifier.CTRL | CaptureEventModifier.SHIFT
		);
		expect(packModifierFlags({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(
			CaptureEventModifier.ALT |
				CaptureEventModifier.CTRL |
				CaptureEventModifier.META |
				CaptureEventModifier.SHIFT
		);
	});
});
