/** Phase 41 — own-tab DOM capture event SAB ring.
 *
 *  Single-producer (main-thread CaptureDomTap), single-consumer (pipeline-worker
 *  CaptureSession). Header carries monotonic u32 WRITE_INDEX / READ_INDEX cursors
 *  with `Atomics.store` release semantics so the reader sees a complete record
 *  before it observes the writeIndex increment. DROP_COUNT is `Atomics.add`-ed
 *  by the writer when the ring is full; the reader does not block, and frames are
 *  dropped — never blocked — so a stalled drain never stalls the main thread.
 *
 *  Layout is defined by protocol.ts constants so all readers/writers agree.
 */

import type { CaptureEventLogEntry } from './event-log';
import {
	CAPTURE_EVENT_HEADER_BYTES,
	CAPTURE_EVENT_HEADER_FIELDS,
	CAPTURE_EVENT_HEADER_MAGIC,
	CAPTURE_EVENT_RECORD_BYTES,
	CAPTURE_EVENT_RECORD_STRING_CAPACITY,
	CAPTURE_EVENT_RECORD_STRING_OFFSET,
	CAPTURE_EVENT_RING_BYTES,
	CAPTURE_EVENT_RING_CAPACITY,
	CAPTURE_EVENT_SCHEMA_VERSION,
	CaptureEventHeaderIndex,
	CaptureEventModifier,
	CaptureEventType
} from '../../protocol';

/** Result of a writer attempt. `dropped: true` means the ring was full. */
export interface RingWriteResult {
	written: boolean;
	dropped: boolean;
}

/** Allocate + initialize a fresh ring SAB. Worker side only. */
export function allocateCaptureEventRing(generation: number): SharedArrayBuffer {
	const sab = new SharedArrayBuffer(CAPTURE_EVENT_RING_BYTES);
	const header = new Int32Array(sab, 0, CAPTURE_EVENT_HEADER_FIELDS);
	header[CaptureEventHeaderIndex.MAGIC] = CAPTURE_EVENT_HEADER_MAGIC;
	header[CaptureEventHeaderIndex.SCHEMA_VERSION] = CAPTURE_EVENT_SCHEMA_VERSION;
	header[CaptureEventHeaderIndex.CAPACITY] = CAPTURE_EVENT_RING_CAPACITY;
	header[CaptureEventHeaderIndex.RECORD_BYTES] = CAPTURE_EVENT_RECORD_BYTES;
	header[CaptureEventHeaderIndex.WRITE_INDEX] = 0;
	header[CaptureEventHeaderIndex.READ_INDEX] = 0;
	header[CaptureEventHeaderIndex.DROP_COUNT] = 0;
	header[CaptureEventHeaderIndex.GENERATION] = generation | 0;
	return sab;
}

/** Validate that a SAB looks like a capture event ring. Throws on schema mismatch. */
export function validateCaptureEventRing(sab: SharedArrayBuffer): void {
	if (sab.byteLength !== CAPTURE_EVENT_RING_BYTES) {
		throw new Error(
			`Capture event ring SAB has wrong size: ${sab.byteLength} (expected ${CAPTURE_EVENT_RING_BYTES})`
		);
	}
	const header = new Int32Array(sab, 0, CAPTURE_EVENT_HEADER_FIELDS);
	if (header[CaptureEventHeaderIndex.MAGIC] !== CAPTURE_EVENT_HEADER_MAGIC) {
		throw new Error('Capture event ring SAB magic mismatch');
	}
	if (header[CaptureEventHeaderIndex.SCHEMA_VERSION] !== CAPTURE_EVENT_SCHEMA_VERSION) {
		throw new Error(
			`Capture event ring schema mismatch: ${header[CaptureEventHeaderIndex.SCHEMA_VERSION]} (expected ${CAPTURE_EVENT_SCHEMA_VERSION})`
		);
	}
}

const STRING_CAPACITY = CAPTURE_EVENT_RECORD_STRING_CAPACITY;

/** Single-producer writer. Holds a reference to the SAB and pre-computes views. */
export class CaptureEventRingWriter {
	private readonly header: Int32Array;
	private readonly records: DataView;
	private readonly stringScratch: Uint8Array;
	private readonly textEncoder = new TextEncoder();

	constructor(sab: SharedArrayBuffer) {
		validateCaptureEventRing(sab);
		this.header = new Int32Array(sab, 0, CAPTURE_EVENT_HEADER_FIELDS);
		this.records = new DataView(sab, CAPTURE_EVENT_HEADER_BYTES);
		this.stringScratch = new Uint8Array(sab, CAPTURE_EVENT_HEADER_BYTES);
	}

	/** Write a key event. Returns whether it was written or dropped. */
	writeKey(combo: string, modifierFlags: number, tUs: number): RingWriteResult {
		return this.write(CaptureEventType.KEY, modifierFlags, tUs, 0, 0, combo);
	}

	/** Write a pointer event (down/up) at clientX/clientY with modifier flags held. */
	writePointer(
		type: typeof CaptureEventType.POINTER_DOWN | typeof CaptureEventType.POINTER_UP,
		modifierFlags: number,
		tUs: number,
		clientX: number,
		clientY: number
	): RingWriteResult {
		return this.write(type, modifierFlags, tUs, clientX | 0, clientY | 0, '');
	}

	/** Current drop counter — useful for status reporting. */
	dropCount(): number {
		return Atomics.load(this.header, CaptureEventHeaderIndex.DROP_COUNT) >>> 0;
	}

	private write(
		type: number,
		modifierFlags: number,
		tUs: number,
		x: number,
		y: number,
		stringPayload: string
	): RingWriteResult {
		const capacity = CAPTURE_EVENT_RING_CAPACITY;
		const writeIndex = Atomics.load(this.header, CaptureEventHeaderIndex.WRITE_INDEX) >>> 0;
		const readIndex = Atomics.load(this.header, CaptureEventHeaderIndex.READ_INDEX) >>> 0;
		if ((writeIndex - readIndex) >>> 0 >= capacity) {
			Atomics.add(this.header, CaptureEventHeaderIndex.DROP_COUNT, 1);
			return { written: false, dropped: true };
		}

		const slot = writeIndex & (capacity - 1);
		const recordOffset = slot * CAPTURE_EVENT_RECORD_BYTES;
		this.records.setUint32(recordOffset + 0, type >>> 0, true);
		this.records.setUint32(recordOffset + 4, modifierFlags >>> 0, true);
		// tUs as BigUint64 — microseconds since session epoch; fits 9e6 years.
		this.records.setBigUint64(recordOffset + 8, BigInt(Math.max(0, Math.floor(tUs))), true);
		this.records.setInt32(recordOffset + 16, x | 0, true);
		this.records.setInt32(recordOffset + 20, y | 0, true);
		this.records.setUint32(recordOffset + 24, 0, true); // reserved (sequence)

		let stringLen = 0;
		if (stringPayload.length > 0) {
			// We tried `encodeInto(stringPayload, scratchSlice)` to avoid the encode
			// allocation, but Chromium's TextEncoder.encodeInto rejects shared-backed
			// Uint8Arrays with the same "must not be shared" TypeError that
			// TextDecoder.decode does. So we encode into a fresh non-shared array
			// (one Uint8Array allocation per recorded shortcut) and `set` the bytes
			// into the SAB-backed scratch — the encoder allocation is the price of
			// the SAB destination.
			const encoded = this.textEncoder.encode(stringPayload);
			stringLen = Math.min(encoded.length, STRING_CAPACITY);
			this.stringScratch.set(
				encoded.subarray(0, stringLen),
				recordOffset + CAPTURE_EVENT_RECORD_STRING_OFFSET
			);
		}
		this.records.setUint32(recordOffset + 28, stringLen >>> 0, true);

		// Release-store: any reader that observes the new writeIndex also sees the
		// completed record above (Atomics.store provides the necessary fence).
		Atomics.store(this.header, CaptureEventHeaderIndex.WRITE_INDEX, (writeIndex + 1) | 0);
		return { written: true, dropped: false };
	}
}

/** Single-consumer reader. Worker side. Drains all pending records as
 *  CaptureEventLogEntry, with the session-relative time (seconds) the writer encoded. */
export class CaptureEventRingReader {
	private readonly header: Int32Array;
	private readonly records: DataView;
	private readonly textDecoder = new TextDecoder('utf-8', { fatal: false });
	private readonly stringView: Uint8Array;

	constructor(sab: SharedArrayBuffer) {
		validateCaptureEventRing(sab);
		this.header = new Int32Array(sab, 0, CAPTURE_EVENT_HEADER_FIELDS);
		this.records = new DataView(sab, CAPTURE_EVENT_HEADER_BYTES);
		this.stringView = new Uint8Array(sab, CAPTURE_EVENT_HEADER_BYTES);
	}

	/** Drain all records since the last call. */
	drain(): CaptureEventLogEntry[] {
		const capacity = CAPTURE_EVENT_RING_CAPACITY;
		const writeIndex = Atomics.load(this.header, CaptureEventHeaderIndex.WRITE_INDEX) >>> 0;
		const readIndex = Atomics.load(this.header, CaptureEventHeaderIndex.READ_INDEX) >>> 0;
		const pending = (writeIndex - readIndex) >>> 0;
		if (pending === 0) return [];

		const out: CaptureEventLogEntry[] = [];
		for (let i = 0; i < pending; i++) {
			const slot = ((readIndex + i) >>> 0) & (capacity - 1);
			const recordOffset = slot * CAPTURE_EVENT_RECORD_BYTES;
			const entry = this.readRecord(recordOffset);
			if (entry) out.push(entry);
		}

		Atomics.store(this.header, CaptureEventHeaderIndex.READ_INDEX, (readIndex + pending) | 0);
		return out;
	}

	/** Snapshot the drop counter; main and worker can both query for telemetry. */
	dropCount(): number {
		return Atomics.load(this.header, CaptureEventHeaderIndex.DROP_COUNT) >>> 0;
	}

	private readRecord(recordOffset: number): CaptureEventLogEntry | null {
		const type = this.records.getUint32(recordOffset + 0, true);
		const modifierFlags = this.records.getUint32(recordOffset + 4, true);
		const tUsBig = this.records.getBigUint64(recordOffset + 8, true);
		const x = this.records.getInt32(recordOffset + 16, true);
		const y = this.records.getInt32(recordOffset + 20, true);
		const stringLen = this.records.getUint32(recordOffset + 28, true);
		const tS = Number(tUsBig) / 1_000_000;

		if (type === CaptureEventType.KEY) {
			// Browsers' `TextDecoder.decode` rejects buffers backed by SharedArrayBuffer
			// with a "must not be shared" TypeError, so we copy the slice into a plain
			// Uint8Array first. Node's TextDecoder doesn't enforce this so the unit
			// tests passed; Chromium does.
			const sharedBytes = this.stringView.subarray(
				recordOffset + CAPTURE_EVENT_RECORD_STRING_OFFSET,
				recordOffset + CAPTURE_EVENT_RECORD_STRING_OFFSET + Math.min(stringLen, STRING_CAPACITY)
			);
			const bytes = new Uint8Array(sharedBytes.length);
			bytes.set(sharedBytes);
			const combo = this.textDecoder.decode(bytes);
			return { kind: 'key', combo, t: tS };
		}
		if (type === CaptureEventType.POINTER_DOWN || type === CaptureEventType.POINTER_UP) {
			return {
				kind: type === CaptureEventType.POINTER_DOWN ? 'pointer-down' : 'pointer-up',
				t: tS,
				x,
				y,
				modifierFlags
			};
		}
		return null;
	}
}

/** Pack KeyboardEvent / PointerEvent modifier state into the flags layout. */
export function packModifierFlags(event: {
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
}): number {
	let flags = 0;
	if (event.altKey) flags |= CaptureEventModifier.ALT;
	if (event.ctrlKey) flags |= CaptureEventModifier.CTRL;
	if (event.metaKey) flags |= CaptureEventModifier.META;
	if (event.shiftKey) flags |= CaptureEventModifier.SHIFT;
	return flags;
}
