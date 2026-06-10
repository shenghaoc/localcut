import { describe, expect, it, vi } from 'vitest';
import { createPublishFrameTap, type TapWriter } from './publish-frame-tap';

class FakeFrame {
	closed = 0;
	readonly clones: FakeFrame[] = [];

	clone(): this {
		const clone = new FakeFrame();
		this.clones.push(clone);
		return clone as this;
	}

	close(): void {
		this.closed += 1;
	}
}

/** A writer whose writes resolve only when the test releases them. */
function manualWriter(): TapWriter<FakeFrame> & {
	written: FakeFrame[];
	releaseNext(): void;
	rejectNext(error: unknown): void;
	closeCalls: number;
} {
	const pendingResolvers: Array<{
		resolve: () => void;
		reject: (error: unknown) => void;
		frame: FakeFrame;
	}> = [];
	const written: FakeFrame[] = [];
	let closeCalls = 0;
	return {
		written,
		get closeCalls() {
			return closeCalls;
		},
		write(frame: FakeFrame) {
			return new Promise<void>((resolve, reject) => {
				pendingResolvers.push({ resolve, reject, frame });
			});
		},
		async close() {
			closeCalls += 1;
		},
		releaseNext() {
			const entry = pendingResolvers.shift();
			if (!entry) throw new Error('no pending write');
			// The generator consumes (closes) frames it accepts.
			entry.frame.close();
			written.push(entry.frame);
			entry.resolve();
		},
		rejectNext(error: unknown) {
			const entry = pendingResolvers.shift();
			if (!entry) throw new Error('no pending write');
			entry.reject(error);
		}
	};
}

async function settle() {
	await Promise.resolve();
	await Promise.resolve();
}

describe('createPublishFrameTap', () => {
	it('clones the program frame and leaves the original untouched', async () => {
		const writer = manualWriter();
		const tap = createPublishFrameTap<FakeFrame>(writer);
		const program = new FakeFrame();
		tap.push(program);
		writer.releaseNext();
		await settle();

		expect(program.closed).toBe(0);
		expect(program.clones).toHaveLength(1);
		expect(tap.stats()).toEqual({ framesDelivered: 1, framesDropped: 0 });
	});

	it('latest frame wins while a write is in flight', async () => {
		const writer = manualWriter();
		const tap = createPublishFrameTap<FakeFrame>(writer);
		const first = new FakeFrame();
		const second = new FakeFrame();
		const third = new FakeFrame();

		tap.push(first); // starts writing
		tap.push(second); // pending
		tap.push(third); // replaces second

		expect(second.clones[0].closed).toBe(1); // dropped clone closed exactly once
		expect(tap.stats().framesDropped).toBe(1);

		writer.releaseNext();
		await settle();
		writer.releaseNext();
		await settle();

		expect(writer.written).toHaveLength(2);
		expect(writer.written[1]).toBe(third.clones[0]);
		expect(tap.stats()).toEqual({ framesDelivered: 2, framesDropped: 1 });
	});

	it('stop closes the pending clone and the writer, exactly once', async () => {
		const writer = manualWriter();
		const tap = createPublishFrameTap<FakeFrame>(writer);
		const first = new FakeFrame();
		const second = new FakeFrame();
		tap.push(first);
		tap.push(second); // pending behind the in-flight write

		await tap.stop();
		await tap.stop(); // idempotent

		expect(second.clones[0].closed).toBe(1);
		expect(writer.closeCalls).toBe(1);

		// Pushes after stop are ignored — no clone is even taken.
		const late = new FakeFrame();
		tap.push(late);
		expect(late.clones).toHaveLength(0);
	});

	it('a rejected write closes that clone once and reports the error', async () => {
		const writer = manualWriter();
		const onError = vi.fn();
		const tap = createPublishFrameTap<FakeFrame>(writer, onError);
		const frame = new FakeFrame();
		tap.push(frame);
		writer.rejectNext(new Error('stream torn down'));
		await settle();

		expect(frame.clones[0].closed).toBe(1);
		expect(onError).toHaveBeenCalledTimes(1);
		expect(tap.stats().framesDelivered).toBe(0);

		// The tap is dead after an error; later frames are not cloned.
		const late = new FakeFrame();
		tap.push(late);
		expect(late.clones).toHaveLength(0);
	});

	it('a failing clone() surfaces as an error without touching the original', () => {
		const writer = manualWriter();
		const onError = vi.fn();
		const tap = createPublishFrameTap<FakeFrame>(writer, onError);
		const frame = new FakeFrame();
		vi.spyOn(frame, 'clone').mockImplementation(() => {
			throw new DOMException('source closed', 'InvalidStateError');
		});
		tap.push(frame);
		expect(onError).toHaveBeenCalledTimes(1);
		expect(frame.closed).toBe(0);
	});
});
