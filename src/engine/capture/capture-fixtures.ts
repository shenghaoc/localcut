/**
 * Test fixtures for capture engine unit tests.
 *
 * All capture unit tests use mocked streams and handles — no media fixtures in CI.
 * Each mock is in-memory and scriptable to produce deterministic VFR sequences,
 * backpressure scenarios, and fault-injection patterns.
 */

export interface ScriptedVideoFrame {
	timestamp: number;
	duration: number | null;
	type: 'key' | 'delta';
	width: number;
	height: number;
}

export interface ScriptedAudioData {
	timestamp: number;
	duration: number | null;
	sampleRate: number;
	numberOfFrames: number;
	numberOfChannels: number;
}

function mockCloseable(orig: Record<string, unknown>): Record<string, unknown> {
	let closed = false;
	return new Proxy(orig, {
		get(target, prop) {
			if (prop === 'close') {
				return () => {
					if (closed) return; // real VideoFrame.close() is a silent no-op on subsequent calls
					closed = true;
				};
			}
			if (prop === 'closed') return closed;
			return Reflect.get(target, prop);
		}
	});
}

export function createMockVideoFrame(frame: ScriptedVideoFrame): VideoFrame {
	return mockCloseable({
		timestamp: frame.timestamp * 1_000_000,
		duration: frame.duration !== null ? frame.duration * 1_000_000 : null,
		type: frame.type,
		codedWidth: frame.width,
		codedHeight: frame.height,
		displayWidth: frame.width,
		displayHeight: frame.height,
		colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: true },
		format: 'NV12'
	}) as unknown as VideoFrame;
}

export function createMockAudioData(data: ScriptedAudioData): AudioData {
	return mockCloseable({
		timestamp: data.timestamp * 1_000_000,
		duration: data.duration !== null ? data.duration * 1_000_000 : null,
		sampleRate: data.sampleRate,
		numberOfFrames: data.numberOfFrames,
		numberOfChannels: data.numberOfChannels,
		format: 'f32-planar',
		allocationSize: () => data.numberOfFrames * data.numberOfChannels * 4,
		copyTo: () => {}
	}) as unknown as AudioData;
}

export interface MockSyncAccessHandle {
	write(buffer: ArrayBuffer): number;
	flush(): void;
	close(): void;
	getSize(): number;
	truncate(size: number): void;
	writes: ArrayBuffer[];
	closed: boolean;
}

export function createMockSyncAccessHandle(
	opts?: { killAfterWrites?: number; tornFinalWrite?: boolean }
): MockSyncAccessHandle {
	const writes: ArrayBuffer[] = [];
	let closed = false;
	let writeCount = 0;

	return {
		write(buffer: ArrayBuffer): number {
			if (closed) throw new DOMException('Handle closed', 'InvalidStateError');
			if (opts?.killAfterWrites !== undefined && writeCount >= opts.killAfterWrites) {
				throw new DOMException('Simulated kill', 'UnknownError');
			}
			writeCount++;
			const copy = new ArrayBuffer(buffer.byteLength);
			const src = new Uint8Array(buffer);
			const dst = new Uint8Array(copy);
			if (opts?.tornFinalWrite && writeCount === opts.killAfterWrites) {
				dst.set(src.slice(0, Math.floor(src.length / 2)));
			} else {
				dst.set(src);
			}
			writes.push(copy);
			return copy.byteLength;
		},
		flush(): void {
			if (closed) throw new DOMException('Handle closed', 'InvalidStateError');
		},
		close(): void { closed = true; },
		getSize(): number {
			return writes.reduce((sum, b) => sum + b.byteLength, 0);
		},
		truncate(_size: number): void {},
		writes,
		get closed() { return closed; }
	};
}

export interface MockMSTPReader {
	read(): Promise<{ done: boolean; value?: VideoFrame | AudioData }>;
	releaseLock(): void;
	cancel(): Promise<void>;
}

export function createMockMSTPReader<T extends VideoFrame | AudioData>(
	frames: T[],
	opts?: { delayMs?: number; errorAfter?: number }
): ReadableStreamDefaultReader<T> {
	let index = 0;
	let cancelled = false;

	return {
		async read(): Promise<{ done: boolean; value?: T }> {
			if (cancelled) return { done: true, value: undefined };
			if (opts?.errorAfter !== undefined && index >= opts.errorAfter) {
				throw new DOMException('Simulated reader error', 'UnknownError');
			}
			if (opts?.delayMs) {
				await new Promise((r) => setTimeout(r, opts.delayMs));
			}
			if (index >= frames.length) {
				return { done: true, value: undefined };
			}
			return { done: false, value: frames[index++] };
		},
		releaseLock(): void {},
		cancel(): Promise<void> {
			cancelled = true;
			return Promise.resolve();
		}
	} as unknown as ReadableStreamDefaultReader<T>;
}

export interface SpyEncoder {
	configuredConfig: VideoEncoderConfig | AudioEncoderConfig | null;
	encodedChunks: (EncodedVideoChunk | EncodedAudioChunk)[];
	encodeQueueSizeValue: number;
	flushCalled: boolean;
	closeCalled: boolean;
	errorCallback: ((err: DOMException) => void) | null;
	triggerError(err: DOMException): void;
}

export function createSpyVideoEncoder(): VideoEncoder & SpyEncoder {
	const spy: SpyEncoder = {
		configuredConfig: null,
		encodedChunks: [],
		encodeQueueSizeValue: 0,
		flushCalled: false,
		closeCalled: false,
		errorCallback: null,
		triggerError(err: DOMException): void {
			if (spy.errorCallback) spy.errorCallback(err);
		}
	};

	const encoder = {
		get encodeQueueSize() { return spy.encodeQueueSizeValue; },
		get state() { return spy.closeCalled ? 'closed' : (spy.configuredConfig ? 'configured' : 'unconfigured'); },
		configure(config: VideoEncoderConfig): void {
			spy.configuredConfig = config;
		},
		encode(frame: VideoFrame, _options?: VideoEncoderEncodeOptions): void {
			frame.close();
		},
		async flush(): Promise<void> {
			spy.flushCalled = true;
		},
		close(): void {
			spy.closeCalled = true;
		},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => true
	} as unknown as VideoEncoder & SpyEncoder;

	Object.assign(encoder, spy);
	return encoder;
}

export function createSpyAudioEncoder(): AudioEncoder & SpyEncoder {
	const spy: SpyEncoder = {
		configuredConfig: null,
		encodedChunks: [],
		encodeQueueSizeValue: 0,
		flushCalled: false,
		closeCalled: false,
		errorCallback: null,
		triggerError(err: DOMException): void {
			if (spy.errorCallback) spy.errorCallback(err);
		}
	};

	const encoder = {
		get encodeQueueSize() { return spy.encodeQueueSizeValue; },
		get state() { return spy.closeCalled ? 'closed' : (spy.configuredConfig ? 'configured' : 'unconfigured'); },
		configure(config: AudioEncoderConfig): void {
			spy.configuredConfig = config;
		},
		encode(data: AudioData): void {
			data.close();
		},
		async flush(): Promise<void> {
			spy.flushCalled = true;
		},
		close(): void {
			spy.closeCalled = true;
		},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => true
	} as unknown as AudioEncoder & SpyEncoder;

	Object.assign(encoder, spy);
	return encoder;
}

export function buildVfrFrameSequence(count: number, baseTs = 0, baseDelta = 33_333): ScriptedVideoFrame[] {
	const frames: ScriptedVideoFrame[] = [];
	for (let i = 0; i < count; i++) {
		const ts = baseTs + i * baseDelta;
		const delta = i % 30 === 0 ? baseDelta * 4 : baseDelta; // occasional long hold
		frames.push({
			timestamp: ts,
			duration: delta,
			type: i % 30 === 0 ? 'key' : 'delta',
			width: 1920,
			height: 1080
		});
	}
	return frames;
}
