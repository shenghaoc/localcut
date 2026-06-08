import { describe, expect, it, vi } from 'vitest';
import { ThumbnailStore, thumbnailKey } from './thumbnail-store';

function makeEntry(width = 160, height = 90) {
	return { bitmap: { width, height, close: vi.fn() } as unknown as ImageBitmap, width, height };
}

describe('thumbnailKey', () => {
	it('buckets timestamps to the millisecond per source', () => {
		expect(thumbnailKey('a', 1.23456)).toBe('a:1.235');
		expect(thumbnailKey('a', 1.2351)).toBe('a:1.235');
		expect(thumbnailKey('b', -1)).toBe('b:0');
	});
});

describe('ThumbnailStore', () => {
	it('stores and retrieves by bucketed key', () => {
		const store = new ThumbnailStore();
		const entry = makeEntry();
		store.set('src', 1.2345, entry);
		expect(store.get('src', 1.2349)).toBe(entry); // same bucket
		expect(store.has('src', 1.2345)).toBe(true);
		expect(store.get('src', 9)).toBeNull();
	});

	it('closes the replaced bitmap when a key is overwritten', () => {
		const store = new ThumbnailStore();
		const first = makeEntry();
		const second = makeEntry();
		store.set('src', 1, first);
		store.set('src', 1, second);
		expect(first.bitmap.close).toHaveBeenCalledTimes(1);
		expect(second.bitmap.close).not.toHaveBeenCalled();
		expect(store.size).toBe(1);
	});

	it('evicts and closes the least-recently-used bitmap over budget', () => {
		const store = new ThumbnailStore(2);
		const a = makeEntry();
		const b = makeEntry();
		const c = makeEntry();
		store.set('src', 1, a);
		store.set('src', 2, b);
		store.get('src', 1); // touch a so b is the LRU
		store.set('src', 3, c);

		expect(store.size).toBe(2);
		expect(b.bitmap.close).toHaveBeenCalledTimes(1);
		expect(a.bitmap.close).not.toHaveBeenCalled();
		expect(c.bitmap.close).not.toHaveBeenCalled();
	});

	it('closes every bitmap for a source on clearSource', () => {
		const store = new ThumbnailStore();
		const a = makeEntry();
		const b = makeEntry();
		const other = makeEntry();
		store.set('src', 1, a);
		store.set('src', 2, b);
		store.set('keep', 1, other);
		store.clearSource('src');

		expect(a.bitmap.close).toHaveBeenCalledTimes(1);
		expect(b.bitmap.close).toHaveBeenCalledTimes(1);
		expect(other.bitmap.close).not.toHaveBeenCalled();
		expect(store.size).toBe(1);
	});

	it('closes every bitmap on clear', () => {
		const store = new ThumbnailStore();
		const a = makeEntry();
		const b = makeEntry();
		store.set('src', 1, a);
		store.set('src', 2, b);
		store.clear();
		expect(a.bitmap.close).toHaveBeenCalledTimes(1);
		expect(b.bitmap.close).toHaveBeenCalledTimes(1);
		expect(store.size).toBe(0);
	});
});
