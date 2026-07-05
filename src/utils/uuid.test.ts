import { describe, expect, it, vi } from 'vite-plus/test';
import { generateId } from './uuid';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FALLBACK_RE = /^\d{13}-[0-9a-f]{8}$/;

describe('generateId', () => {
	it('returns a UUID v4 string (non-empty)', () => {
		const id = generateId();
		expect(typeof id).toBe('string');
		expect(id.length).toBeGreaterThan(0);
	});

	it('uses crypto.randomUUID when available', () => {
		const mock = vi.fn().mockReturnValue('550e8400-e29b-41d4-a716-446655440000');
		vi.stubGlobal('crypto', { randomUUID: mock, getRandomValues: vi.fn() });
		expect(generateId()).toBe('550e8400-e29b-41d4-a716-446655440000');
		expect(mock).toHaveBeenCalledOnce();
		vi.unstubAllGlobals();
	});

	it('falls back to getRandomValues and produces a valid UUID v4', () => {
		vi.stubGlobal('crypto', {
			getRandomValues: (buf: Uint8Array) => {
				// Fill with predictable bytes so we can verify the version/variant bits.
				for (let i = 0; i < buf.length; i++) buf[i] = 0xab;
			}
		});
		const id = generateId();
		expect(id).toMatch(UUID_V4_RE);
		vi.unstubAllGlobals();
	});

	it('getRandomValues path sets version nibble to 4', () => {
		vi.stubGlobal('crypto', {
			getRandomValues: (buf: Uint8Array) => {
				for (let i = 0; i < buf.length; i++) buf[i] = 0xff;
			}
		});
		const id = generateId();
		// The 13th character (index of version nibble in the 8-4-4-4-12 format) must be '4'.
		expect(id[14]).toBe('4');
		vi.unstubAllGlobals();
	});

	it('getRandomValues path sets variant bits to 8/9/a/b', () => {
		vi.stubGlobal('crypto', {
			getRandomValues: (buf: Uint8Array) => {
				for (let i = 0; i < buf.length; i++) buf[i] = 0xff;
			}
		});
		const id = generateId();
		// The 19th character is the variant high nibble.
		expect('89ab').toContain(id[19]);
		vi.unstubAllGlobals();
	});

	it('falls back to Date.now + Math.random when crypto is unavailable', () => {
		vi.stubGlobal('crypto', undefined);
		const id = generateId();
		expect(id).toMatch(FALLBACK_RE);
		vi.unstubAllGlobals();
	});

	it('fallback always produces exactly 8 hex chars after the timestamp', () => {
		// Simulate Math.random returning 0 — the padEnd must still produce 8 chars.
		vi.stubGlobal('crypto', undefined);
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
		const id = generateId();
		const [, hex] = id.split('-');
		expect(hex).toHaveLength(8);
		expect(hex).toBe('00000000');
		randomSpy.mockRestore();
		vi.unstubAllGlobals();
	});

	it('produces unique IDs across multiple calls', () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateId()));
		// All 100 should be distinct.
		expect(ids.size).toBe(100);
	});
});
